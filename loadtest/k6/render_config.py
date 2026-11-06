#!/usr/bin/env python3
"""Render the single JSON run config consumed by k6/main.js (k6 cannot read YAML).

    python3 k6/render_config.py --profile MIX --tier 1000 --run-type DEBUG [--out k6/build/run_config.json]

Inputs: config/*.yaml, k6/profiles/<PROFILE>.yaml, env.yaml (target + EC2-1 deny-list),
seeder/out/fixtures.json (per-VU pre-staged tender ids). The password is NOT written here.
Pre-flight (target not EC2-1) runs before anything is rendered (G2).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from common.config import (ConfigError, assert_total_vus, dump_json, load_config,  # noqa: E402
                           load_profile, profile_vu_slots)
from common.safety import preflight_target  # noqa: E402

DEFAULT_FIXTURES = ROOT / "seeder" / "out" / "fixtures.json"


def usernames_for(seed_cfg: dict, role: str, count: int) -> list[str]:
    spec = seed_cfg["users"]["roles"][role]
    if count > int(spec["count"]):
        raise ConfigError(f"profile needs {count} '{role}' users but seed.yaml creates {spec['count']}")
    return [f"{seed_cfg['users']['prefix']}{spec['code']}_{i + 1:02d}" for i in range(count)]


def render(cfg: dict, profile_name: str, tier: int, run_type: str, run_id: str,
           fixtures_path: Path = DEFAULT_FIXTURES, resolved_ips: list[str] | None = None,
           limit_vus: int | None = None, ai_mode: str = "none") -> dict:
    run_type = run_type.upper()
    profile = load_profile(profile_name)
    if profile.get("debug_only") and run_type == "BENCHMARK":
        raise ConfigError(f"profile {profile_name} is DEBUG-only")
    slots = profile_vu_slots(profile)
    if limit_vus:
        if run_type == "BENCHMARK":
            raise ConfigError("--limit-vus is only allowed with RUN_TYPE=DEBUG (G1)")
        slots = slots[:limit_vus]
    if not limit_vus:
        assert_total_vus(profile, run_type, int(cfg["run"].get("total_vus", 17)))   # G1
    per_role: dict[str, int] = {}
    for s in slots:
        per_role[s["role"]] = max(per_role.get(s["role"], 0), s["role_index"] + 1)
    names = {r: usernames_for(cfg["seed"], r, n) for r, n in per_role.items()}
    for s in slots:
        s["username"] = names[s["role"]][s["role_index"]]

    fixtures = {"users": {}, "probe": {}}
    if fixtures_path and Path(fixtures_path).exists():
        fx = json.loads(Path(fixtures_path).read_text())
        fixtures["users"] = {s["username"]: fx.get("users", {}).get(s["username"], {}) for s in slots}
        fixtures["probe"] = fx.get("probe", {})
    elif run_type == "BENCHMARK":
        raise ConfigError(f"{fixtures_path} not found — run seeder/generate.py first")

    seed_cfg, screens = cfg["seed"], json.loads(json.dumps(cfg["screens"]))
    files = []
    for f in (screens.get("spec_upload") or {}).get("files", []):
        p = (ROOT / f).resolve()
        files.append({"name": p.name, "path": str(p), "exists": p.exists()})
    screens.setdefault("spec_upload", {})["files_resolved"] = [f for f in files if f["exists"]]

    env = cfg["env"]
    safety = cfg["safety"]
    durations = cfg["run"]["durations"]
    return {
        "run_id": run_id,
        "run_type": run_type,
        "tier": int(tier),
        "seed": int(seed_cfg.get("seed", 42)),
        "base_url": env["target"]["frontend_url"].rstrip("/"),
        "total_vus": int(cfg["run"].get("total_vus", 17)),
        "request_timeout": cfg["run"].get("request_timeout", "300s"),
        "durations": {"warmup_s": int(durations["warmup_minutes"] * 60), "steady_s": int(durations["steady_minutes"] * 60),
                      "graceful_stop_s": int(durations.get("graceful_stop_seconds", 30))},
        "profile": {"name": profile_name, "slots": slots, "screen_time_overrides": profile.get("screen_time_overrides") or {},
                    "probe": bool(profile.get("probe"))},
        "screen_time": cfg["screen_time"],
        "screens": screens,
        "workflow": screens.get("workflow", {}),
        "user_prefix": seed_cfg["users"]["prefix"],
        "fixtures": {"prefix": seed_cfg["fixtures"]["id_prefix"], "probe_prefix": seed_cfg["fixtures"]["probe_prefix"],
                     "universe_prefix": seed_cfg.get("id_prefix_universe", "LTU-"), **fixtures},
        "safety": {"endpoint_denylist": safety.get("endpoint_denylist", []), "frontend_only": bool(safety.get("frontend_only", True)),
                   "blocked_ports": safety.get("blocked_ports", []), "ec2_1_denylist": env.get("ec2_1_denylist", []),
                   "resolved_ips": resolved_ips or []},
        "ai_mode": ai_mode,
        "rendered_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profile", required=True)
    ap.add_argument("--tier", type=int, required=True)
    ap.add_argument("--run-type", default="DEBUG", choices=["DEBUG", "BENCHMARK"])
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--limit-vus", type=int, default=None)
    ap.add_argument("--fixtures", default=str(DEFAULT_FIXTURES))
    ap.add_argument("--out", default=str(ROOT / "k6" / "build" / "run_config.json"))
    ap.add_argument("--skip-preflight", action="store_true", help="local stub only (refuses unless host is localhost)")
    args = ap.parse_args(argv)
    cfg = load_config()
    url = cfg["env"]["target"]["frontend_url"]
    if args.skip_preflight:
        if not any(h in url for h in ("127.0.0.1", "localhost")):
            print("--skip-preflight is only allowed for a localhost stub target", file=sys.stderr)
            return 2
        info = {"resolved": ["127.0.0.1"]}
    else:
        info = preflight_target(cfg)
    run_id = args.run_id or dt.datetime.now(dt.timezone.utc).strftime(f"%Y%m%dT%H%M%SZ_{args.profile}_{args.tier}_{args.run_type}")
    rc = render(cfg, args.profile, args.tier, args.run_type, run_id, Path(args.fixtures), info["resolved"], args.limit_vus)
    dump_json(rc, Path(args.out))
    print(f"run config -> {args.out} ({len(rc['profile']['slots'])} VUs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
