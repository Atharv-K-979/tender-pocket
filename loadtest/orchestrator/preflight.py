"""Pre-flight checks before every run (Part 5). Pure parsers are unit-tested; `run_preflight`
does the remote reads (docker inspect/logs, env NAME presence — never values, G4).

Checks: target not EC2-1 (G2) · backend on PostgreSQL per log (DatabaseConfig.java:97/100) ·
no recent container restart · no scheduler sync in progress (SyncScheduler.java:24,31 start;
:40-55 end) · outside forbidden IST windows and the next 6-hourly sync · mock AI reachable ·
safety env names present/absent as required (config/safety.yaml).
"""
from __future__ import annotations

import datetime as dt
import re
import shlex
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common.safety import (SafetyError, in_forbidden_window, preflight_ssh_alias,  # noqa: E402
                           preflight_target)

SYNC_START = re.compile(r"\[Scheduler\] (Running automated|Starting daily)")
SYNC_END = re.compile(r"\[Scheduler\] (GeM Sync completed|GeM Sync failed|Automated execution encountered an error)")
TS_PREFIX = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?\s")


def _utc(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")[:19]).replace(tzinfo=dt.timezone.utc)


def parse_datasource(log_text: str) -> str:
    """Last datasource line wins (backend log, DatabaseConfig.java:54,97,100)."""
    state = "unknown"
    for line in log_text.splitlines():
        if "Configured PostgreSQL DataSource successfully" in line:
            state = "postgresql"
        elif "Falling back to SQLite" in line or "Configured SQLite DataSource" in line:
            state = "sqlite"
    return state


def parse_scheduler(log_text: str) -> dict:
    """From `docker logs --timestamps` lines: last start/end, in-progress flag."""
    starts, ends = [], []
    for line in log_text.splitlines():
        m = TS_PREFIX.match(line)
        if not m:
            continue
        if SYNC_START.search(line):
            starts.append(_utc(m.group(1)))
        elif SYNC_END.search(line):
            ends.append(_utc(m.group(1)))
    last_start = max(starts) if starts else None
    last_end = max(ends) if ends else None
    in_progress = bool(last_start and (last_end is None or last_end < last_start))
    return {"last_start": last_start, "last_end": last_end, "in_progress": in_progress,
            "ends": sorted(ends)[-2:]}


def next_sync_conflicts(ends: list[dt.datetime], start: dt.datetime, end: dt.datetime,
                        interval_h: float, guard_min: float) -> list[str]:
    """fixedDelay = 6 h after the END of the previous run (SyncScheduler.java:22)."""
    hits = []
    for e in ends:
        nxt = e + dt.timedelta(hours=interval_h)
        while nxt < start - dt.timedelta(minutes=guard_min):
            nxt += dt.timedelta(hours=interval_h)
        if start - dt.timedelta(minutes=guard_min) <= nxt <= end + dt.timedelta(minutes=guard_min):
            hits.append(nxt.isoformat())
    return hits


def env_presence_cmd(container: str, names: list[str]) -> str:
    """Prints NAME=set|unset per name inside the container; values never leave the container."""
    tests = "; ".join(f'if [ -n "${{{n}:-}}" ]; then echo {n}=set; else echo {n}=unset; fi' for n in names)
    return f"docker exec {shlex.quote(container)} sh -c {shlex.quote(tests)}"


def env_equals_cmd(container: str, name: str, value: str) -> str:
    t = f'if [ "${{{name}:-}}" = {shlex.quote(value)} ]; then echo EQUAL; else echo DIFFERENT; fi'
    return f"docker exec {shlex.quote(container)} sh -c {shlex.quote(t)}"


def run_preflight(cfg: dict, remote, planned_minutes: float, requires_mock_ai: bool,
                  now: dt.datetime | None = None, allow_unknown_sync: bool = False) -> dict:
    env, safety = cfg["env"], cfg["safety"]
    c = env.get("containers", {})
    backend = c.get("backend", "tender-pocket-backend")
    now = now or dt.datetime.now(dt.timezone.utc)
    end = now + dt.timedelta(minutes=planned_minutes)
    res: dict = {"checks": [], "facts": {}}

    def add(name, ok, detail):
        res["checks"].append({"check": name, "ok": bool(ok), "detail": detail})

    try:
        info = preflight_target(cfg)
        preflight_ssh_alias(cfg)
        add("target_not_ec2_1", True, f"{info['host']} -> {info['resolved']}")
        res["facts"]["target"] = info
    except SafetyError as exc:
        add("target_not_ec2_1", False, str(exc))
        return res

    logs = remote.text(f"docker logs --timestamps {shlex.quote(backend)} 2>&1 | grep -E "
                       f"'DatabaseConfig|\\[Scheduler\\]' | tail -n 400", check=False, timeout=120)
    ds = parse_datasource(logs)
    res["facts"]["datasource"] = ds
    add("backend_postgresql", ds == "postgresql", f"datasource per backend log: {ds}")

    inspect = remote.text("docker inspect --format '{{.Name}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.OOMKilled}}' "
                          + " ".join(shlex.quote(x) for x in c.values()), check=False)
    containers = {}
    for line in inspect.splitlines():
        parts = line.strip().lstrip("/").split("|")
        if len(parts) == 4:
            containers[parts[0]] = {"started_at": parts[1], "restart_count": int(parts[2] or 0), "oom_killed": parts[3] == "true"}
    res["facts"]["containers"] = containers
    min_up = float(safety.get("min_backend_uptime_minutes", 20))
    for name, st in containers.items():
        try:
            up = (now - _utc(st["started_at"])).total_seconds() / 60
        except ValueError:
            up = -1
        add(f"uptime_{name}", up >= min_up, f"up {up:.0f} min (min {min_up:.0f})")
    if not containers:
        add("containers_found", False, "docker inspect returned nothing")

    sched = parse_scheduler(logs)
    res["facts"]["scheduler"] = {k: (v.isoformat() if isinstance(v, dt.datetime) else v) for k, v in sched.items() if k != "ends"}
    add("scheduler_idle", not sched["in_progress"], "sync in progress" if sched["in_progress"] else "no sync running")
    if sched["ends"]:
        hits = next_sync_conflicts(sched["ends"], now, end, float(safety.get("sync_interval_hours", 6)),
                                   float(safety.get("sync_guard_minutes", 20)))
        add("next_sync_outside_window", not hits, f"predicted next sync(s) {hits}" if hits else "clear")
    else:
        add("next_sync_outside_window", allow_unknown_sync, "no [Scheduler] end line found — next sync UNKNOWN"
            + (" (allowed by --allow-unknown-sync)" if allow_unknown_sync else ""))

    fw = in_forbidden_window(now, end, safety.get("forbidden_windows_ist", []))
    res["facts"]["forbidden_windows_hit"] = fw
    add("outside_forbidden_windows", not fw, f"overlaps {fw}" if fw else "clear")

    present = safety.get("backend_env_required_present", [])
    absent = safety.get("backend_env_required_absent", [])
    out = remote.text(env_presence_cmd(backend, present + absent), check=False)
    seen = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    for n in present:
        add(f"env_present_{n}", seen.get(n) == "set", f"{n} {seen.get(n, '?')}")
    for n in absent:
        add(f"env_absent_{n}", seen.get(n) == "unset", f"{n} {seen.get(n, '?')}")
    for n, v in (safety.get("backend_env_must_not_equal") or {}).items():
        eq = remote.text(env_equals_cmd(backend, n, str(v)), check=False).strip()
        add(f"env_{n}_not_{v}", eq == "DIFFERENT", f"{n} {'equals' if eq == 'EQUAL' else 'does not equal'} {v!r}")

    mock = (env.get("mock_ai") or {})
    reachable_local = False
    try:
        with urllib.request.urlopen(mock.get("health_url", "http://127.0.0.1:8800/health"), timeout=5) as r:
            reachable_local = r.status == 200
    except Exception:  # noqa: BLE001
        pass
    ep = str(mock.get("endpoint_for_backend", "")).rstrip("/")
    health_from_backend = re.sub(r"/v1$", "", ep) + "/health" if ep else ""
    reachable_backend = False
    if health_from_backend:
        t = remote.text(f"docker exec {shlex.quote(backend)} sh -c "
                        + shlex.quote(f"wget -q -T 5 -O /dev/null {health_from_backend} && echo OK || echo FAIL"), check=False)
        reachable_backend = "OK" in t
    res["facts"]["mock_ai_reachable"] = reachable_local and reachable_backend
    add("mock_ai_reachable", (reachable_local and reachable_backend) or not requires_mock_ai,
        f"generator={'ok' if reachable_local else 'FAIL'} backend->mock={'ok' if reachable_backend else 'FAIL'}"
        + ("" if requires_mock_ai else " (not required by this profile)"))

    res["ok"] = all(ch["ok"] for ch in res["checks"])
    return res
