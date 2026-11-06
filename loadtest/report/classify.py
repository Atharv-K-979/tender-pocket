"""Service classification and breaking-point logic (pure; unit-tested in tests/test_report.py).

States: Healthy / Degraded / Broken / n/a. Rules come from config/slo.yaml:
  Healthy  — every configured healthy criterion met (S1–S2 approved; others PROPOSED placeholders)
  Broken   — error rate > 1 %, any timeout, p95 > 60 s, correctness failure (PROPOSED);
             S18–S19: failure > 5 %, stuck job, OOM/restart; system-wide Broken on container
             crash, pool exhaustion or SQLite fallback
  Degraded — neither
Expected 4xx (tag expected != ok, e.g. RBAC 403 probes) never count as errors.
Breaking point = first tier Broken in all (≥ min_repeats) repeats AND still Broken at the next tier.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

STATES = ("Healthy", "Degraded", "Broken", "n/a")


def percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    k = max(0, min(len(sorted_vals) - 1, math.ceil(p / 100.0 * len(sorted_vals)) - 1))
    return sorted_vals[k]


@dataclass
class ServiceStats:
    service: str
    durations: list[float] = field(default_factory=list)
    errors: int = 0
    http5xx: int = 0
    timeouts: int = 0
    expected_excluded: int = 0
    correctness_checks: int = 0
    correctness_failures: int = 0
    pagination_checks: int = 0
    pagination_failures: int = 0
    trackb_attempts: int = 0
    trackb_failures: int = 0
    stuck_jobs: int = 0

    def add_request(self, ms: float, status: int, expected_tag: str, error_code: str = "") -> None:
        if expected_tag and expected_tag != "ok" and status in (401, 403):
            self.expected_excluded += 1
            return
        self.durations.append(ms)
        if status == 0 and error_code in ("1050", "1051"):
            self.timeouts += 1
        if status == 0 or status >= 400:
            self.errors += 1
        if status >= 500:
            self.http5xx += 1

    def summary(self) -> dict:
        d = sorted(self.durations)
        n = len(d)
        return {
            "service": self.service, "n": n,
            "p50_ms": percentile(d, 50), "p95_ms": percentile(d, 95), "p99_ms": percentile(d, 99),
            "max_ms": d[-1] if d else None,
            "error_rate": self.errors / n if n else None, "http5xx_rate": self.http5xx / n if n else None,
            "success": 1 - self.errors / n if n else None, "timeouts": self.timeouts,
            "expected_4xx_excluded": self.expected_excluded,
            "correctness_failures": self.correctness_failures, "correctness_checks": self.correctness_checks,
            "pagination_ok": (1 - self.pagination_failures / self.pagination_checks) if self.pagination_checks else None,
            "trackb_failure_rate": (self.trackb_failures / self.trackb_attempts) if self.trackb_attempts else None,
            "stuck_jobs": self.stuck_jobs,
        }


def healthy_criteria(slo: dict, service: str) -> dict:
    h = slo.get("healthy", {})
    if service in h:
        return h[service]
    return h.get("default_write" if service in slo.get("write_services", []) else "default_read", {})


def classify(summary: dict, slo: dict, system_broken: list[str] | None = None, restart_or_oom: bool = False) -> tuple[str, list[str]]:
    svc = summary["service"]
    n = summary["n"]
    if system_broken:
        return "Broken", [f"system-wide: {', '.join(system_broken)}"]
    b = slo.get("broken", {})
    why: list[str] = []
    is_trackb = svc in ("S18", "S19")
    if n < int(slo.get("min_samples", 20)) and not (is_trackb and summary.get("trackb_failure_rate") is not None):
        if summary.get("correctness_failures"):
            return "Broken", ["correctness failure"]
        return "n/a", [f"only {n} samples"]
    er = summary.get("error_rate") or 0.0
    if er > float(b.get("error_rate_gt", 0.01)) and not is_trackb:
        why.append(f"error rate {er:.2%}")
    if b.get("any_timeout", True) and summary.get("timeouts", 0) > 0:
        why.append(f"{summary['timeouts']} timeout(s)")
    if summary.get("p95_ms") is not None and summary["p95_ms"] > float(b.get("p95_ms_gt", 60000)):
        why.append(f"p95 {summary['p95_ms'] / 1000:.1f}s")
    if b.get("correctness_failure", True):
        if summary.get("correctness_failures"):
            why.append(f"{summary['correctness_failures']} correctness failure(s)")
        if summary.get("pagination_ok") is not None and summary["pagination_ok"] < 1.0:
            why.append("pagination check failed")
    if is_trackb:
        tb = b.get("track_b", {})
        fr = summary.get("trackb_failure_rate")
        if fr is not None and fr > float(tb.get("failure_gt", 0.05)):
            why.append(f"failure {fr:.1%}")
        if tb.get("stuck_job", True) and summary.get("stuck_jobs"):
            why.append(f"{summary['stuck_jobs']} stuck job(s)")
        if tb.get("oom_or_restart", True) and restart_or_oom:
            why.append("OOM/restart")
    if why:
        return "Broken", why
    crit = healthy_criteria(slo, svc)
    miss = []
    if crit.get("p95_ms") is not None and (summary.get("p95_ms") or 0) > crit["p95_ms"]:
        miss.append(f"p95 {summary['p95_ms']:.0f}ms > {crit['p95_ms']}")
    if crit.get("p99_ms") is not None and (summary.get("p99_ms") or 0) > crit["p99_ms"]:
        miss.append(f"p99 {summary['p99_ms']:.0f}ms > {crit['p99_ms']}")
    succ = summary.get("success") if not is_trackb else (1 - (summary.get("trackb_failure_rate") or 0))
    if crit.get("success_min") is not None and succ is not None and succ < crit["success_min"]:
        miss.append(f"success {succ:.3%} < {crit['success_min']:.1%}")
    if crit.get("http5xx_max") is not None and (summary.get("http5xx_rate") or 0) > crit["http5xx_max"]:
        miss.append(f"5xx {summary['http5xx_rate']:.3%}")
    if crit.get("pagination_ok_min") is not None and summary.get("pagination_ok") is not None \
            and summary["pagination_ok"] < crit["pagination_ok_min"]:
        miss.append("pagination < 100%")
    return ("Degraded", miss) if miss else ("Healthy", [])


def aggregate_cell(states: list[str]) -> str:
    """Combine repeats of one (profile, tier, service)."""
    s = [x for x in states if x != "n/a"]
    if not s:
        return "n/a"
    if all(x == "Broken" for x in s):
        return "Broken"
    if any(x == "Broken" for x in s):
        return "Broken?"          # flaky: broken in some repeats only
    if all(x == "Healthy" for x in s):
        return "Healthy"
    return "Degraded"


def breaking_point(by_tier: dict[int, list[str]], min_repeats: int = 2, confirm_next: bool = True) -> dict:
    """by_tier: tier -> list of per-repeat states (valid runs only).

    Returns {"tier": T|None, "status": "confirmed"|"candidate"|"none", "note": str}.
    """
    tiers = sorted(by_tier)
    for i, t in enumerate(tiers):
        st = [x for x in by_tier[t] if x != "n/a"]
        if not st or not all(x == "Broken" for x in st):
            continue
        enough = len(st) >= min_repeats
        nxt = tiers[i + 1] if i + 1 < len(tiers) else None
        next_broken = None
        if nxt is not None:
            ns = [x for x in by_tier[nxt] if x != "n/a"]
            next_broken = bool(ns) and all(x == "Broken" for x in ns)
        if enough and (not confirm_next or next_broken):
            return {"tier": t, "status": "confirmed", "note": f"Broken in {len(st)} repeats; next tier {nxt} Broken"}
        if not enough:
            return {"tier": t, "status": "candidate", "note": f"Broken but only {len(st)} valid repeat(s) (need {min_repeats})"}
        if next_broken is None:
            return {"tier": t, "status": "candidate", "note": "Broken in all repeats; next tier not measured yet"}
        # next tier recovered: keep looking (transient break)
    return {"tier": None, "status": "none", "note": "no Broken tier"}


def poll_overrun_tier(medians_by_tier: dict[int, float | None], limit_ms: float = 1500) -> int | None:
    for t in sorted(medians_by_tier):
        m = medians_by_tier[t]
        if m is not None and m > limit_ms:
            return t
    return None
