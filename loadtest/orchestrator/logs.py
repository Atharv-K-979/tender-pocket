"""Collect time-stamped container logs for a run window and extract anomalies (Part 5)."""
from __future__ import annotations

import re
import shlex
from pathlib import Path


def collect(remote, containers: dict, since_iso: str, until_iso: str, out_dir: Path) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {}
    for role, name in containers.items():
        text = remote.text(f"docker logs --timestamps --since {shlex.quote(since_iso)} --until {shlex.quote(until_iso)} "
                           f"{shlex.quote(name)} 2>&1", check=False, timeout=300)
        p = out_dir / f"{role}.log"
        p.write_text(text)
        paths[role] = p
    return paths


def scan(paths: dict[str, Path], patterns: dict[str, dict[str, str]], max_examples: int = 5) -> dict:
    """Return {role: {pattern: {"count": n, "examples": [...], "first_ts": ...}}}."""
    out: dict = {}
    for role, p in paths.items():
        pats = {k: re.compile(v) for k, v in (patterns.get(role) or {}).items()}
        res = {k: {"count": 0, "examples": [], "first_ts": None} for k in pats}
        if p.exists():
            for line in p.read_text(errors="replace").splitlines():
                for k, rx in pats.items():
                    if rx.search(line):
                        r = res[k]
                        r["count"] += 1
                        if r["first_ts"] is None:
                            r["first_ts"] = line.split(" ", 1)[0]
                        if len(r["examples"]) < max_examples:
                            r["examples"].append(line[:300])
        out[role] = res
    return out


def scheduler_timestamps(scan_result: dict) -> list[str]:
    b = (scan_result.get("backend") or {}).get("scheduler") or {}
    return [e.split(" ", 1)[0] for e in b.get("examples", [])] if b.get("count") else []
