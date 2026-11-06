"""Config loading for every Python tool (G5).

All tunables live in loadtest/config/*.yaml. Host/credential values live only in the
gitignored loadtest/config/env.yaml (G4). PyYAML is the only third-party dependency and is
pinned in loadtest/requirements.txt (G8). The EC2-2 monitor agent does NOT import this
module (it must stay stdlib-only); the orchestrator passes it plain JSON instead.
"""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from typing import Any

LOADTEST_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = LOADTEST_ROOT / "config"
PROFILES_DIR = LOADTEST_ROOT / "k6" / "profiles"

CONFIG_FILES = ("run", "safety", "services", "seed", "screen_time", "screens", "slo", "mock_ai", "monitors")


class ConfigError(RuntimeError):
    pass


def _yaml():
    try:
        import yaml  # type: ignore
    except ImportError as exc:  # pragma: no cover - environment problem
        raise ConfigError(
            "PyYAML is required: pip install -r loadtest/requirements.txt") from exc
    return yaml


def load_yaml(path: Path) -> Any:
    with open(path, "r", encoding="utf-8") as fh:
        return _yaml().safe_load(fh) or {}


def load_config(config_dir: Path | None = None, require_env: bool = True) -> dict:
    """Return {"run": ..., "safety": ..., ..., "env": ...}."""
    cdir = Path(config_dir) if config_dir else CONFIG_DIR
    cfg: dict[str, Any] = {}
    for name in CONFIG_FILES:
        p = cdir / f"{name}.yaml"
        cfg[name] = load_yaml(p) if p.exists() else {}
    env_path = Path(os.environ.get("LT_ENV_FILE", cdir / "env.yaml"))
    if env_path.exists():
        cfg["env"] = load_yaml(env_path)
    elif require_env:
        raise ConfigError(
            f"{env_path} not found. Copy config/env.example.yaml to config/env.yaml and fill it in.")
    else:
        cfg["env"] = {}
    return cfg


def load_profile(name: str, profiles_dir: Path | None = None) -> dict:
    pdir = Path(profiles_dir) if profiles_dir else PROFILES_DIR
    p = pdir / f"{name}.yaml"
    if not p.exists():
        raise ConfigError(f"unknown profile {name!r} ({p} missing)")
    prof = load_yaml(p)
    prof.setdefault("name", name)
    return prof


def profile_vu_slots(profile: dict) -> list[dict]:
    """Expand a profile into one slot per VU.

    Profile shape (k6/profiles/*.yaml):
      roles:
        "Tender Executive": {count: 6, browser: 1, behaviour: default}
        ...
      extra_groups: [{role: "Tender Executive", count: 3, behaviour: spec_upload}]
    Browser VUs are counted inside `count` (G1: browser VUs included in the 17).
    """
    slots: list[dict] = []
    per_role_index: dict[str, int] = {}
    groups = []
    for role, spec in (profile.get("roles") or {}).items():
        groups.append({"role": role, **(spec or {})})
    groups.extend(profile.get("extra_groups") or [])
    for g in groups:
        count = int(g.get("count", 0))
        browsers = int(g.get("browser", 0))
        if browsers > count:
            raise ConfigError(f"profile {profile.get('name')}: role {g['role']} browser {browsers} > count {count}")
        behaviour = g.get("behaviour", "default")
        for i in range(count):
            idx = per_role_index.get(g["role"], 0)
            per_role_index[g["role"]] = idx + 1
            slots.append({
                "role": g["role"],
                "role_index": idx,
                "kind": "browser" if i < browsers else "api",
                "behaviour": behaviour,
            })
    return slots


def assert_total_vus(profile: dict, run_type: str, expected: int = 17) -> int:
    """G1 — BENCHMARK runs must total exactly `expected` VUs (browser VUs included)."""
    total = len(profile_vu_slots(profile))
    if run_type.upper() == "BENCHMARK" and total != expected:
        raise ConfigError(
            f"G1 violation: profile {profile.get('name')} totals {total} VUs; BENCHMARK requires exactly {expected}")
    if total <= 0:
        raise ConfigError(f"profile {profile.get('name')} has no VUs")
    return total


def deep_merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def dump_json(obj: Any, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, sort_keys=True, default=str)
