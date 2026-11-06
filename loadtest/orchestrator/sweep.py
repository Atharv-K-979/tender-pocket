#!/usr/bin/env python3
"""Run a list of tiers × profiles sequentially, pausing for YOUR confirmation before each tier.

    python3 orchestrator/sweep.py --tiers 100,500,1000 [--profiles MIX,READ,APPROVALS,WORKFLOW] --approved-reset
    python3 orchestrator/sweep.py --tiers 10000 --profiles AI-1,AI-3,AI-6,AI-10 --repeat 1 --approved-reset

Repeats per profile come from config/run.yaml runs_per_tier (overrides per tier) unless --repeat
is given. Before each tier the plan is printed and you must type the tier number to proceed
(approval per tier). The database must already hold that tier's dump (seeder/dump_tier.sh).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from common.config import load_config  # noqa: E402
from orchestrator import run as runmod  # noqa: E402


def plan_for_tier(cfg: dict, tier: int, profiles: list[str], repeat: int | None) -> list[tuple[str, int]]:
    rpt = cfg["run"].get("runs_per_tier", {})
    base = dict(rpt.get("default", {}))
    base.update((rpt.get("overrides") or {}).get(tier, {}) or (rpt.get("overrides") or {}).get(str(tier), {}))
    return [(p, repeat if repeat else int(base.get(p, 1))) for p in profiles]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tiers", required=True)
    ap.add_argument("--profiles", default="MIX,READ,APPROVALS,WORKFLOW")
    ap.add_argument("--repeat", type=int, default=None)
    ap.add_argument("--approved-reset", action="store_true")
    ap.add_argument("--allow-unknown-sync", action="store_true")
    ap.add_argument("--k6", default=None)
    ap.add_argument("--yes-i-am-watching", action="store_true", help="skip prompts (NOT recommended)")
    args = ap.parse_args(argv)
    cfg = load_config()
    tiers = [int(t) for t in args.tiers.split(",")]
    profiles = [p.strip() for p in args.profiles.split(",") if p.strip()]
    for tier in tiers:
        plan = plan_for_tier(cfg, tier, profiles, args.repeat)
        minutes = sum(n for _, n in plan) * (cfg["run"]["durations"]["warmup_minutes"] + cfg["run"]["durations"]["steady_minutes"] + 8)
        print(f"\n=== tier {tier}: " + ", ".join(f"{p}×{n}" for p, n in plan) + f"  (≈{minutes:.0f} min; reset={'yes' if args.approved_reset else 'NO'})")
        if not args.yes_i_am_watching:
            ans = input(f"Type {tier} to run this tier, 's' to skip, anything else to stop: ").strip()
            if ans == "s":
                continue
            if ans != str(tier):
                print("stopped by operator")
                return 0
        for profile, n in plan:
            argv_run = ["--profile", profile, "--tier", str(tier), "--repeat", str(n), "--run-type", "BENCHMARK"]
            if args.approved_reset:
                argv_run.append("--approved-reset")
            if args.allow_unknown_sync:
                argv_run.append("--allow-unknown-sync")
            if args.k6:
                argv_run += ["--k6", args.k6]
            rc = runmod.main(argv_run)
            if rc != 0:
                print(f"tier {tier} profile {profile} did not complete (rc={rc}); stopping the sweep")
                return rc
    print("\nsweep finished. Next: python3 report/build_report.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
