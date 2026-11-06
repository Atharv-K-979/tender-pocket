#!/usr/bin/env python3
"""Per-run summaries + cumulative breaking-point matrix (service × tier) (Part 5).

    python3 report/build_report.py [--results results] [--out results/report] [--include-debug] [--include-invalid]

Reads every results/<run_id>/manifest.json + raw.jsonl.gz (k6 JSON output). Uses only the
steady window (phase=steady), excludes expected 4xx (RBAC probes), classifies each service
with config/slo.yaml and writes:
  report.md            per-run table, per-profile matrices, breaking points, poll-overrun markers
  runs.csv             one row per run × service
  matrix_<PROFILE>.csv service × tier cell states
  charts/p95_<PROFILE>.svg  latency (p95) vs tier per service
Invalid runs (manifest.validity.valid == false) are listed but excluded from the matrix.
Every Track B number is labelled "simulated provider latency" (mock AI).
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from common.config import load_config  # noqa: E402
from report import classify as C  # noqa: E402
from report.svg import line_chart  # noqa: E402

CHECK_SERVICE = [("pagination", "S2"), ("dashboard_list", "S1"), ("detail_tender", "S5"), ("approvals_pending", "S8"),
                 ("review_", "S9"), ("journey_", "S13"), ("rbac_", "S16")]


def check_to_service(check: str) -> str:
    for prefix, svc in CHECK_SERVICE:
        if check.startswith(prefix):
            return svc
    return "S0"


def parse_raw(path: Path, stats: dict[str, C.ServiceStats]) -> dict:
    """Stream k6 JSON lines; fill per-service stats from steady-phase points."""
    extra = defaultdict(float)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if '"Point"' not in line:
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            m = o.get("metric")
            d = o.get("data") or {}
            tags = d.get("tags") or {}
            if tags.get("phase", "steady") != "steady":
                continue
            v = d.get("value", 0)
            if m == "http_req_duration":
                svc = tags.get("service", "S0")
                st = stats.setdefault(svc, C.ServiceStats(svc))
                try:
                    status = int(tags.get("status") or 0)
                except ValueError:
                    status = 0
                st.add_request(float(v), status, tags.get("expected", "ok"), str(tags.get("error_code", "")))
            elif m == "lt_correctness_ok":
                svc = check_to_service(tags.get("check", ""))
                st = stats.setdefault(svc, C.ServiceStats(svc))
                st.correctness_checks += 1
                if not v:
                    st.correctness_failures += 1
            elif m == "lt_pagination_ok":
                st = stats.setdefault("S2", C.ServiceStats("S2"))
                st.pagination_checks += 1
                if not v:
                    st.pagination_failures += 1
            elif m in ("lt_spec_upload_ok", "lt_bidpack_ok"):
                svc = "S18" if m == "lt_spec_upload_ok" else "S19"
                st = stats.setdefault(svc, C.ServiceStats(svc))
                st.trackb_attempts += 1
                if not v:
                    st.trackb_failures += 1
            elif m == "lt_spec_upload_stuck":
                stats.setdefault("S18", C.ServiceStats("S18")).stuck_jobs += int(v)
            elif m in ("lt_probe_lost_updates", "lt_probe_double_approvals", "lt_probe_duplicate_pending", "lt_probe_runs",
                       "lt_poll_overruns", "lt_poll_ticks", "lt_pool_exhausted", "lt_denied_request_attempts"):
                extra[m] += v
                if m in ("lt_probe_lost_updates", "lt_probe_double_approvals") and v:
                    st = stats.setdefault("S15", C.ServiceStats("S15"))
                    st.correctness_failures += int(v)
            elif m.startswith("lt_spec_durations_") or m in ("lt_bidpack_ms", "lt_spec_api_attempts", "lt_spec_tokens_total"):
                extra[f"{m}_sum"] += v
                extra[f"{m}_n"] += 1
    return dict(extra)


def system_broken_reasons(manifest: dict, findings: dict) -> list[str]:
    r = []
    if (manifest.get("validity") or {}).get("broken_by_load"):
        r.append("container crash/OOM under load")
    be = findings.get("backend") or {}
    if (be.get("hikari_timeout") or {}).get("count"):
        r.append("connection-pool exhaustion")
    if (be.get("sqlite") or {}).get("count"):
        r.append("SQLite fallback")
    return r


def load_runs(results: Path, include_debug: bool) -> list[Path]:
    dirs = [p.parent for p in results.glob("*/manifest.json")]
    if include_debug:
        dirs += [p.parent for p in (results / "debug").glob("*/manifest.json")]
    return sorted(dirs)


def fmt_ms(v):
    return "–" if v is None else (f"{v / 1000:.2f}s" if v >= 1000 else f"{v:.0f}ms")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", default=str(ROOT / "results"))
    ap.add_argument("--out", default=None)
    ap.add_argument("--include-debug", action="store_true")
    ap.add_argument("--include-invalid", action="store_true", help="also classify invalid runs in the matrix (marked)")
    args = ap.parse_args(argv)
    cfg = load_config(require_env=False)
    slo, services = cfg["slo"], cfg["services"].get("services", {})
    results = Path(args.results)
    out = Path(args.out) if args.out else results / "report" / dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    (out / "charts").mkdir(parents=True, exist_ok=True)

    run_rows, per_run = [], []
    cells: dict[str, dict[str, dict[int, list[str]]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    medians: dict[str, dict[str, dict[int, list[float]]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    p95s: dict[str, dict[str, dict[int, list[float]]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for rd in load_runs(results, args.include_debug):
        man = json.loads((rd / "manifest.json").read_text())
        raw = rd / "raw.jsonl.gz"
        if not raw.exists():
            raw = rd / "raw.jsonl"
        stats: dict[str, C.ServiceStats] = {}
        extra = parse_raw(raw, stats) if raw.exists() else {}
        findings = json.loads((rd / "log_findings.json").read_text()) if (rd / "log_findings.json").exists() else {}
        sysb = system_broken_reasons(man, findings)
        valid = (man.get("validity") or {}).get("valid", False)
        restart = bool((man.get("validity") or {}).get("broken_by_load"))
        svc_states = {}
        for svc, st in sorted(stats.items(), key=lambda kv: int(kv[0][1:]) if kv[0][1:].isdigit() else 0):
            if svc == "S0":
                continue
            s = st.summary()
            state, why = C.classify(s, slo, sysb, restart)
            svc_states[svc] = (state, why, s)
            run_rows.append({"run_id": man["run_id"], "profile": man["profile"], "tier": man["tier"], "repeat": man.get("repeat"),
                             "valid": valid, "service": svc, "state": state, "why": "; ".join(why), **{k: s[k] for k in
                             ("n", "p50_ms", "p95_ms", "p99_ms", "error_rate", "http5xx_rate", "timeouts", "correctness_failures",
                              "expected_4xx_excluded", "pagination_ok", "trackb_failure_rate", "stuck_jobs")}})
            if valid or args.include_invalid:
                cells[man["profile"]][svc][int(man["tier"])].append(state)
                if s["p50_ms"] is not None:
                    medians[man["profile"]][svc][int(man["tier"])].append(s["p50_ms"])
                if s["p95_ms"] is not None:
                    p95s[man["profile"]][svc][int(man["tier"])].append(s["p95_ms"])
        per_run.append((man, svc_states, extra, valid, sysb))

    with open(out / "runs.csv", "w", newline="") as fh:
        cols = ["run_id", "profile", "tier", "repeat", "valid", "service", "state", "why", "n", "p50_ms", "p95_ms", "p99_ms",
                "error_rate", "http5xx_rate", "timeouts", "correctness_failures", "expected_4xx_excluded", "pagination_ok",
                "trackb_failure_rate", "stuck_jobs"]
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in run_rows:
            w.writerow(r)

    bp_cfg = slo.get("breaking_point", {})
    po_cfg = slo.get("poll_overrun_marker", {})
    md = ["# Tender Pocket load test — breaking-point report", "",
          f"Generated {dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')}. Steady window only (warm-up excluded); "
          "expected RBAC 4xx excluded from error rates. Tier N = N proportional tenders + a fixed fixture block "
          "(see docs/loadtest/seed-design.md). **Track B (S18) figures use the mock AI: simulated provider latency.**", "",
          "Legend: **Healthy** meets slo.yaml healthy criteria · **Degraded** misses them · **Broken** meets a Broken rule "
          "· **Broken?** Broken in some repeats only · n/a too few samples. Matrix cells show the state and the median of the repeats' p95. Criteria marked PROPOSED in config/slo.yaml are not approved.", ""]
    md += ["## Runs", "", "| run | profile | tier | rep | valid | VUs | poll mode | AI mode | anomalies / invalid reasons |", "|---|---|---|---|---|---|---|---|---|"]
    for man, _, extra, valid, sysb in per_run:
        reasons = (man.get("validity") or {}).get("reasons") or []
        md.append(f"| {man['run_id']} | {man['profile']} | {man['tier']} | {man.get('repeat')} | {'yes' if valid else '**no**'} | "
                  f"{man.get('vu_total')} | {man.get('poll_mode')} | {man.get('ai_mode')} | "
                  f"{'; '.join(reasons + sysb + (man.get('anomalies') or [])[:3]) or '–'} |")
    md.append("")
    for profile in sorted(cells):
        tiers = sorted({t for svc in cells[profile].values() for t in svc})
        md += [f"## Matrix — {profile}", "", "| service | " + " | ".join(f"{t:,}" for t in tiers) + " | breaking point |",
               "|---|" + "---|" * (len(tiers) + 1)]
        with open(out / f"matrix_{profile}.csv", "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["service", "title"] + tiers + ["breaking_point", "status", "note"])
            for svc in sorted(cells[profile], key=lambda s: int(s[1:]) if s[1:].isdigit() else 0):
                row = cells[profile][svc]
                agg = [C.aggregate_cell(row.get(t, [])) if t in row else "" for t in tiers]
                bp = C.breaking_point({t: row[t] for t in row}, int(bp_cfg.get("min_repeats_broken", 2)), bool(bp_cfg.get("confirm_next_tier", True)))
                title = (services.get(svc) or {}).get("title", "")
                w.writerow([svc, title] + agg + [bp["tier"] or "", bp["status"], bp["note"]])
                p95row = [fmt_ms(sorted(p95s[profile][svc][t])[len(p95s[profile][svc][t]) // 2]) if p95s[profile][svc].get(t) else "" for t in tiers]
                md.append(f"| {svc} {title} | " + " | ".join(f"{a} ({p})" if a else "" for a, p in zip(agg, p95row))
                          + f" | {bp['tier'] or '–'} ({bp['status']}) |")
        md.append("")
        po_lines = []
        for svc in po_cfg.get("services", []):
            meds = {t: (sorted(v)[len(v) // 2] if v else None) for t, v in medians[profile].get(svc, {}).items()}
            t = C.poll_overrun_tier(meds, float(po_cfg.get("median_ms_gt", 1500)))
            if not meds:
                po_lines.append(f"{svc}: not measured")
                continue
            po_lines.append(f"{svc}: {('first tier with median > 1.5 s = ' + f'{t:,}') if t else 'median ≤ 1.5 s at all measured tiers'}")
        md += ["Poll-overrun marker (median > poll interval → in-flight requests pile up, 10 §0): " + "; ".join(po_lines), ""]
        series = {svc: [(t, sorted(v)[len(v) // 2]) for t, v in sorted(p95s[profile][svc].items()) if v]
                  for svc in p95s[profile] if svc in ("S1", "S2", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12", "S18", "S19")}
        (out / "charts" / f"p95_{profile}.svg").write_text(
            line_chart(f"{profile}: p95 latency vs tier", series, hlines=[(2000, "S1/S2 p95 SLO"), (60000, "Broken p95")]))
        md += [f"![p95 {profile}](charts/p95_{profile}.svg)", ""]

    md += ["## Per-run detail", ""]
    for man, svc_states, extra, valid, _ in per_run:
        md += [f"### {man['run_id']} ({'valid' if valid else 'INVALID'})", "",
               "| service | state | n | p50 | p95 | p99 | errors | 5xx | timeouts | why |", "|---|---|---|---|---|---|---|---|---|---|"]
        for svc, (state, why, s) in svc_states.items():
            md.append(f"| {svc} | {state} | {s['n']} | {fmt_ms(s['p50_ms'])} | {fmt_ms(s['p95_ms'])} | {fmt_ms(s['p99_ms'])} | "
                      f"{(s['error_rate'] or 0):.2%} | {(s['http5xx_rate'] or 0):.2%} | {s['timeouts']} | {'; '.join(why)} |")
        ex = {k: v for k, v in extra.items() if not k.endswith("_n")}
        if ex:
            md.append("")
            md.append("Counters: " + ", ".join(f"{k}={v:g}" for k, v in sorted(ex.items()) if not k.endswith("_sum")))
            spec = [(k[:-4], extra[k] / extra[k[:-4] + "_n"]) for k in extra if k.endswith("_sum") and extra.get(k[:-4] + "_n")]
            if spec:
                md.append("Track B means (simulated provider latency): " + ", ".join(f"{k}={v:,.0f}" for k, v in spec))
        md.append("")
    (out / "report.md").write_text("\n".join(md))
    print(f"report -> {out / 'report.md'} ({len(per_run)} runs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
