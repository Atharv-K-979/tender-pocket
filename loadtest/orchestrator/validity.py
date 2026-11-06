"""Run-validity rules (Part 5; unit-tested in tests/test_validity.py).

A run is INVALID (excluded from the matrix) if any of:
  R1 generator CPU > 80 % for > 10 % of the steady window
  R2 a container restart NOT caused by the load (outside the k6 window, self-update/exit 0,
     or no load-related evidence)
  R3 scheduler / cron overlap ([Scheduler] lines or host backup runs inside the window)
  R4 SQLite datasource on the backend
  R5 the window overlaps a forbidden IST window
  R6 BENCHMARK VU total != 17
  R7 Track B AI profile with the mock AI unreachable
A crash/OOM caused BY the load is a VALID result classified "Broken" (broken_by_load=True).
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field


def _ts(x) -> dt.datetime:
    if isinstance(x, dt.datetime):
        return x if x.tzinfo else x.replace(tzinfo=dt.timezone.utc)
    s = str(x).replace("Z", "+00:00")
    d = dt.datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)


@dataclass
class RestartEvent:
    container: str
    at: str                    # ISO UTC (State.StartedAt after the restart)
    oom_killed: bool = False
    exit_code: int | None = None
    oom_in_logs: bool = False
    autoupdate_exit: bool = False


@dataclass
class RunFacts:
    run_type: str
    vu_total: int
    expected_vus: int
    window_start: str          # steady window (k6 warm-up excluded)
    window_end: str
    k6_start: str
    k6_end: str
    generator_cpu: list[tuple[str, float]] = field(default_factory=list)   # (ts, host_cpu_pct)
    restarts: list[RestartEvent] = field(default_factory=list)
    scheduler_lines: list[str] = field(default_factory=list)   # ISO ts of [Scheduler] lines in window
    backup_runs_in_window: int = 0
    datasource: str = "postgresql"   # postgresql | sqlite | unknown
    forbidden_windows_hit: list[str] = field(default_factory=list)
    requires_mock_ai: bool = False
    mock_ai_reachable: bool = True
    generator_cpu_limit: float = 80.0
    generator_cpu_share: float = 0.10


def evaluate(f: RunFacts) -> dict:
    reasons: list[str] = []
    broken_by_load = False
    ws, we = _ts(f.window_start), _ts(f.window_end)
    ks, ke = _ts(f.k6_start), _ts(f.k6_end)

    # R1
    samples = [(t, v) for t, v in f.generator_cpu if ws <= _ts(t) <= we]
    if samples:
        hot = sum(1 for _, v in samples if v > f.generator_cpu_limit)
        share = hot / len(samples)
        if share > f.generator_cpu_share:
            reasons.append(f"R1 generator CPU >{f.generator_cpu_limit:.0f}% for {share:.0%} of the window")
    else:
        reasons.append("R1 no generator CPU samples in the window (cannot prove the generator was not saturated)")

    # R2
    for r in f.restarts:
        at = _ts(r.at)
        if not (ks <= at <= ke):
            reasons.append(f"R2 non-load restart of {r.container} at {r.at} (outside the k6 window)")
        elif r.autoupdate_exit or r.exit_code == 0:
            reasons.append(f"R2 non-load restart of {r.container} at {r.at} (self-update / clean exit)")
        elif r.oom_killed or r.oom_in_logs or (r.exit_code not in (None, 0)):
            broken_by_load = True
        else:
            reasons.append(f"R2 restart of {r.container} at {r.at} without load evidence")

    # R3
    if f.scheduler_lines:
        reasons.append(f"R3 scheduler activity in window ({len(f.scheduler_lines)} [Scheduler] lines)")
    if f.backup_runs_in_window:
        reasons.append(f"R3 {f.backup_runs_in_window} backup run(s) in window")
    # R4
    if f.datasource != "postgresql":
        reasons.append(f"R4 backend datasource is {f.datasource}")
    # R5
    if f.forbidden_windows_hit:
        reasons.append(f"R5 overlaps forbidden window(s) {', '.join(f.forbidden_windows_hit)}")
    # R6
    if f.run_type.upper() == "BENCHMARK" and f.vu_total != f.expected_vus:
        reasons.append(f"R6 VU total {f.vu_total} != {f.expected_vus}")
    # R7
    if f.requires_mock_ai and not f.mock_ai_reachable:
        reasons.append("R7 mock AI unreachable for an AI profile")

    valid = not reasons
    return {"valid": valid, "reasons": reasons, "broken_by_load": broken_by_load and valid,
            "classification_hint": "Broken" if broken_by_load and valid else None}
