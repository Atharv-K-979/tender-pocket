#!/usr/bin/env python3
"""Run one profile at one tier (Part 5).

    python3 orchestrator/run.py --profile MIX --tier 1000 --repeat 1 --run-type BENCHMARK [--approved-reset]

Per repeat:
  1 pre-flight (target not EC2-1; PostgreSQL datasource; no recent restart; scheduler idle; outside
    forbidden windows and the next 6-hourly sync; mock AI reachable; safety env names) — a failed
    check aborts a BENCHMARK run (DEBUG may continue past timing checks, never past safety ones)
  2 reset to the tier dump (only with --approved-reset; G6)  3 before-snapshot
  4 start monitors (EC2-2 agent over SSH + generator monitor)
  5 k6: 3 min warm-up (tagged phase=warmup, excluded) + 15 min steady, one process, 17 VUs
  6 stop monitors, fetch CSVs  7 after-snapshot + drift  8 container logs for the window
  9 manifest.json  10 validity evaluation
--generator-on-target runs everything on EC2-2 (loud warning; recorded in the manifest).
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import os
import shlex
import shutil
import subprocess
import sys
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from common.config import ConfigError, assert_total_vus, dump_json, load_config, load_profile, profile_vu_slots  # noqa: E402
from common.remote import remote_from_cfg  # noqa: E402
from common.safety import IST  # noqa: E402
from orchestrator import logs as logmod  # noqa: E402
from orchestrator import preflight as pf  # noqa: E402
from orchestrator import validity  # noqa: E402
from seeder import drift_check  # noqa: E402
from seeder.db import Db  # noqa: E402

SAFETY_CHECK_PREFIXES = ("target_not_ec2_1", "env_", "mock_ai_reachable", "backend_postgresql")


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def both_tz(d: dt.datetime) -> dict:
    return {"utc": d.isoformat(), "ist": d.astimezone(IST).isoformat()}


def _render_module():
    import importlib.util
    spec = importlib.util.spec_from_file_location("render_config", ROOT / "k6" / "render_config.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def banner(msg: str) -> None:
    line = "!" * 78
    print(f"\n{line}\n{msg}\n{line}\n", flush=True)


def git_head() -> str:
    try:
        return subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:  # noqa: BLE001
        return "unknown"


def k6_version(k6: str) -> str:
    try:
        return subprocess.run([k6, "version"], capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:  # noqa: BLE001
        return "unknown"


def image_facts(remote, containers: dict) -> dict:
    out = {}
    for role, name in containers.items():
        t = remote.text(f"docker inspect --format '{{{{.Image}}}}|{{{{.Config.Image}}}}' {shlex.quote(name)} 2>/dev/null", check=False).strip()
        img_id, ref = (t.split("|") + ["", ""])[:2]
        created = remote.text(f"docker image inspect --format '{{{{.Created}}}}|{{{{json .Config.Labels}}}}' {shlex.quote(img_id)} 2>/dev/null",
                              check=False).strip() if img_id else ""
        out[role] = {"container": name, "image": ref, "image_id": img_id[:19], "image_created_and_labels": created}
    return out


def generator_cpu(path: Path) -> list[tuple[str, float]]:
    if not path.exists():
        return []
    with open(path, newline="") as fh:
        return [(r["ts"], float(r["host_cpu_pct"] or 0)) for r in csv.DictReader(fh)]


def fetch_remote_dir(remote, remote_dir: str, local_dir: Path) -> None:
    local_dir.mkdir(parents=True, exist_ok=True)
    parent, base = os.path.dirname(remote_dir.rstrip("/")), os.path.basename(remote_dir.rstrip("/"))
    res = remote.run(f"tar -C {shlex.quote(parent)} -czf - {shlex.quote(base)}", check=False, timeout=600)
    if res.returncode == 0 and res.stdout:
        with tarfile.open(fileobj=io.BytesIO(res.stdout), mode="r:gz") as tf:
            for m in tf.getmembers():
                if m.isfile() and not m.name.startswith("/") and ".." not in m.name:
                    m.name = os.path.basename(m.name)
                    tf.extract(m, local_dir)


def run_once(args, cfg: dict, profile: dict, rep: int) -> dict:
    run_type = args.run_type.upper()
    env = cfg["env"]
    containers = env.get("containers", {})
    workdir = (env.get("remote") or {}).get("workdir", "/var/tmp/tp-loadtest")
    remote = remote_from_cfg(cfg, local=args.generator_on_target)
    started = utcnow()
    run_id = f"{started.strftime('%Y%m%dT%H%M%SZ')}_{args.profile}_{args.tier}_r{rep}"
    base = ROOT / (cfg["run"]["debug_results_dir"] if run_type == "DEBUG" else cfg["run"]["results_dir"])
    out = base / run_id
    out.mkdir(parents=True, exist_ok=True)
    dur = cfg["run"]["durations"]
    planned_min = dur["warmup_minutes"] + dur["steady_minutes"] + 10
    anomalies: list[str] = []
    if args.generator_on_target:
        anomalies.append("generator-on-target: k6/browsers share CPU and memory with the system under test")

    # 1 pre-flight
    requires_ai = bool(profile.get("requires_mock_ai"))
    pre = pf.run_preflight(cfg, remote, planned_min, requires_ai, allow_unknown_sync=args.allow_unknown_sync)
    dump_json(pre, out / "preflight.json")
    for ch in pre["checks"]:
        print(f"  [{'ok' if ch['ok'] else 'FAIL'}] {ch['check']}: {ch['detail']}")
    failed = [ch for ch in pre["checks"] if not ch["ok"]]
    safety_failed = [ch for ch in failed if ch["check"].startswith(SAFETY_CHECK_PREFIXES)]
    if safety_failed or (failed and run_type == "BENCHMARK"):
        print(f"PRE-FLIGHT FAILED — run {run_id} not started", file=sys.stderr)
        return {"run_id": run_id, "status": "preflight_failed", "out": str(out)}
    if failed:
        anomalies += [f"DEBUG run continued past failed pre-flight check {ch['check']}" for ch in failed]
    if args.dry_run:
        print(f"dry-run: pre-flight passed; would run {run_id}")
        return {"run_id": run_id, "status": "dry_run", "out": str(out)}

    # 2 reset
    reset_info = None
    if args.approved_reset:
        rseed = f"{workdir}/seeder"
        remote.run(f"mkdir -p {shlex.quote(rseed)} {shlex.quote(workdir)}/state", check=False)
        for f in ("_pg_common.sh", "reset.sh", "dump_tier.sh", "backup.sh", "restore_backup.sh"):
            remote.put(str(ROOT / "seeder" / f), f"{rseed}/{f}")
        cmd = (f"PG_CONTAINER={shlex.quote(containers.get('postgres', 'tender-pocket-postgres'))} bash {rseed}/reset.sh "
               f"--tier {int(args.tier)} --approved --workdir {shlex.quote(workdir)} "
               f"--truncate-changelog {'yes' if cfg['seed'].get('truncate_changelog_on_reset', True) else 'no'}")
        r = remote.run(cmd, check=False, timeout=3600)
        reset_info = {"rc": r.returncode, "stdout": (r.stdout or b"").decode()[-3000:], "stderr": (r.stderr or b"").decode()[-2000:]}
        print(reset_info["stdout"])
        if r.returncode != 0:
            print("RESET FAILED — aborting", file=sys.stderr)
            dump_json(reset_info, out / "reset.json")
            return {"run_id": run_id, "status": "reset_failed", "out": str(out)}
    else:
        anomalies.append("no reset before this run (--approved-reset not given): data may carry drift from earlier runs")

    db = Db(cfg, remote=remote)
    before = drift_check.snapshot(db)
    dump_json(before, out / "snapshot_before.json")
    if before["row_counts"].get("tenders", 0) < int(args.tier):
        anomalies.append(f"tenders rows {before['row_counts'].get('tenders')} < tier {args.tier}: wrong tier loaded?")

    # render config
    rmod = _render_module()
    rc = rmod.render(cfg, args.profile, int(args.tier), run_type, run_id, rmod.DEFAULT_FIXTURES,
                     pre["facts"]["target"]["resolved"], args.limit_vus,
                     ai_mode="mock (simulated provider latency)" if pre["facts"].get("mock_ai_reachable") else "mock-unreachable")
    dump_json(rc, out / "run_config.json")

    # 4 monitors
    mon = cfg["monitors"]
    total_s = dur["warmup_minutes"] * 60 + dur["steady_minutes"] * 60 + 300
    rmon = f"{workdir}/{mon['agent'].get('remote_dir', 'monitor')}"
    remote.run(f"mkdir -p {shlex.quote(rmon)}", check=False)
    remote.put(str(ROOT / "orchestrator" / "monitors" / "agent.py"), f"{rmon}/agent.py")
    agent_dir = f"{rmon}/{run_id}"
    agent_cmd = (f"nohup python3 {rmon}/agent.py --out {shlex.quote(agent_dir)} --interval {mon['interval_seconds']} "
                 f"--duration {int(total_s)} --pg-container {shlex.quote(containers.get('postgres', 'tender-pocket-postgres'))} "
                 f"--containers {shlex.quote(','.join(mon['agent']['containers']))} "
                 f"--pg-tables {shlex.quote(','.join(mon['agent']['pg_tables']))} > {shlex.quote(agent_dir)}.log 2>&1 &")
    remote.run(f"mkdir -p {shlex.quote(agent_dir)} && {agent_cmd}", check=False)
    gen = subprocess.Popen([sys.executable, str(ROOT / "orchestrator" / "monitors" / "generator.py"), "--out", str(out / "generator.csv"),
                            "--interval", str(mon["interval_seconds"]), "--duration", str(int(total_s)),
                            "--names", ",".join(mon["generator"]["process_names"])])

    # 5 k6
    k6 = args.k6 or shutil.which("k6") or "k6"
    k6env = dict(os.environ, LT_RUN_CONFIG=str(out / "run_config.json"), LT_PASSWORD=str(env.get("test_user_password", "")),
                 LT_OUT_DIR=str(out), K6_BROWSER_HEADLESS="true")
    k6_start = utcnow()
    with open(out / "k6.log", "w") as logf:
        proc = subprocess.run([k6, "run", "--quiet", "--out", f"json={out / 'raw.jsonl.gz'}", str(ROOT / "k6" / "main.js")],
                              env=k6env, cwd=str(ROOT), stdout=logf, stderr=subprocess.STDOUT)
    k6_end = utcnow()
    if proc.returncode not in (0, 99):        # 99 = thresholds crossed (report-only, G7)
        anomalies.append(f"k6 exited with code {proc.returncode} (see k6.log)")
    steady_start = k6_start + dt.timedelta(seconds=5 + dur["warmup_minutes"] * 60)
    steady_end = min(k6_end, steady_start + dt.timedelta(minutes=dur["steady_minutes"]))

    # 6 stop monitors
    remote.run(f"touch {shlex.quote(agent_dir)}/STOP", check=False)
    gen.terminate()
    time.sleep(mon["interval_seconds"] * 2)
    fetch_remote_dir(remote, agent_dir, out / "agent")

    # 7 drift
    after = drift_check.snapshot(db)
    dump_json(after, out / "snapshot_after.json")
    drift = drift_check.diff(before, after)
    dump_json(drift, out / "drift.json")
    (out / "drift.txt").write_text(drift_check.render(drift))

    # 8 logs
    since = (k6_start - dt.timedelta(seconds=60)).isoformat()
    until = (k6_end + dt.timedelta(seconds=60)).isoformat()
    paths = logmod.collect(remote, containers, since, until, out / "logs")
    scan = logmod.scan(paths, mon.get("log_patterns", {}))
    dump_json(scan, out / "log_findings.json")
    post_inspect = remote.text("docker inspect --format '{{.Name}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.ExitCode}}' "
                               + " ".join(shlex.quote(x) for x in containers.values()), check=False)
    restarts = []
    pre_c = pre["facts"].get("containers", {})
    for line in post_inspect.splitlines():
        p = line.strip().lstrip("/").split("|")
        if len(p) == 5 and p[0] in pre_c and (p[1] != pre_c[p[0]]["started_at"] or int(p[2] or 0) != pre_c[p[0]]["restart_count"]):
            role = next((r for r, n in containers.items() if n == p[0]), p[0])
            fnd = scan.get(role, {})
            restarts.append(validity.RestartEvent(
                container=p[0], at=p[1][:19] + "+00:00", oom_killed=p[3] == "true", exit_code=int(p[4] or 0),
                oom_in_logs=bool((fnd.get("oom") or {}).get("count")),
                autoupdate_exit=bool((fnd.get("autoupdate") or {}).get("count")) and int(p[4] or 0) == 0))
    for role, fnd in scan.items():
        for k, v in fnd.items():
            if v["count"]:
                anomalies.append(f"log {role}.{k}: {v['count']} line(s), first {v['first_ts']}")

    # 9 manifest  10 validity
    sched_count = (scan.get("backend", {}).get("scheduler") or {}).get("count", 0)
    slots = profile_vu_slots(profile) if not args.limit_vus else profile_vu_slots(profile)[: args.limit_vus]
    facts = validity.RunFacts(
        run_type=run_type, vu_total=len(slots), expected_vus=int(cfg["run"]["total_vus"]),
        window_start=steady_start.isoformat(), window_end=steady_end.isoformat(),
        k6_start=k6_start.isoformat(), k6_end=k6_end.isoformat(),
        generator_cpu=generator_cpu(out / "generator.csv"), restarts=restarts,
        scheduler_lines=["x"] * int(sched_count), datasource=pre["facts"].get("datasource", "unknown"),
        forbidden_windows_hit=pf.in_forbidden_window(k6_start, k6_end, cfg["safety"].get("forbidden_windows_ist", [])),
        requires_mock_ai=requires_ai, mock_ai_reachable=bool(pre["facts"].get("mock_ai_reachable")))
    verdict = validity.evaluate(facts)
    summary = {}
    if (out / "summary.json").exists():
        summary = json.loads((out / "summary.json").read_text()).get("meta", {})
    manifest = {
        "run_id": run_id, "run_type": run_type, "profile": args.profile, "tier": int(args.tier), "repeat": rep,
        "fixture_tenders": json.loads(rmod.DEFAULT_FIXTURES.read_text()).get("fixture_tenders") if rmod.DEFAULT_FIXTURES.exists() else None,
        "vu_mix": [{"username": s["username"], "role": s["role"], "kind": s["kind"], "behaviour": s["behaviour"]} for s in rc["profile"]["slots"]],
        "vu_total": len(rc["profile"]["slots"]), "browser_vus": sum(1 for s in rc["profile"]["slots"] if s["kind"] == "browser"),
        "screen_time": cfg["screen_time"], "profile_overrides": profile.get("screen_time_overrides") or {},
        "durations": dur, "times": {"k6_start": both_tz(k6_start), "steady_start": both_tz(steady_start),
                                    "steady_end": both_tz(steady_end), "k6_end": both_tz(k6_end)},
        "k6_exit_code": proc.returncode, "k6_version": k6_version(k6), "poll_mode": summary.get("poll_mode", "unknown"),
        "app": {"commit": (env.get("target") or {}).get("app_commit", "UNKNOWN — set target.app_commit in env.yaml"),
                "images": image_facts(remote, containers)},
        "loadtest_commit": git_head(),
        "instance_type": {"target": (env.get("target_host") or {}).get("instance_type"),
                          "generator": (env.get("generator") or {}).get("instance_type")},
        "generator_host": (env.get("generator") or {}).get("host_label"),
        "generator_on_target": bool(args.generator_on_target),
        "ai_mode": rc["ai_mode"], "reset": reset_info, "preflight_ok": not failed,
        "anomalies": anomalies, "validity": verdict,
        "drift_summary": drift_check.render(drift),
    }
    dump_json(manifest, out / "manifest.json")
    print(f"\nrun {run_id}: valid={verdict['valid']} broken_by_load={verdict['broken_by_load']}")
    for r in verdict["reasons"]:
        print(f"  - {r}")
    print(f"results: {out}")
    return {"run_id": run_id, "status": "done", "out": str(out), "valid": verdict["valid"]}


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profile", required=True)
    ap.add_argument("--tier", type=int, required=True)
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--run-type", default="BENCHMARK", choices=["BENCHMARK", "DEBUG"])
    ap.add_argument("--approved-reset", action="store_true", help="reset the DB to the tier dump before each repeat (G6)")
    ap.add_argument("--generator-on-target", action="store_true", help="run k6/monitors on EC2-2 itself (NOT recommended)")
    ap.add_argument("--allow-unknown-sync", action="store_true", help="proceed when no [Scheduler] end line is found")
    ap.add_argument("--limit-vus", type=int, default=None, help="DEBUG only: first N slots of the profile")
    ap.add_argument("--k6", default=None, help="path to the k6 binary")
    ap.add_argument("--dry-run", action="store_true", help="pre-flight only")
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    cfg = load_config()
    profile = load_profile(args.profile)
    try:
        if args.run_type == "BENCHMARK":
            if args.limit_vus:
                raise ConfigError("--limit-vus is DEBUG-only (G1)")
            assert_total_vus(profile, "BENCHMARK", int(cfg["run"]["total_vus"]))
    except ConfigError as exc:
        print(f"ABORT: {exc}", file=sys.stderr)
        return 2
    if args.generator_on_target:
        banner("WARNING: --generator-on-target — the load generator runs ON EC2-2.\n"
               "k6 and Chromium compete with the application for CPU/RAM; results are flagged in the manifest.")
        time.sleep(5)
    rc = 0
    for rep in range(1, args.repeat + 1):
        res = run_once(args, cfg, profile, rep)
        if res["status"] not in ("done", "dry_run"):
            rc = 1
            break
    return rc


if __name__ == "__main__":
    sys.exit(main())
