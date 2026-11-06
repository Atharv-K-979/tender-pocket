#!/usr/bin/env python3
"""Before/after DB snapshot and diff (read-only session; Part 2).

    python3 seeder/drift_check.py snapshot --out before.json
    python3 seeder/drift_check.py diff before.json after.json [--out drift.json]

Snapshot: row counts per app table, approvals by stage×status, duplicate PENDING groups,
tender status and current_stage distributions, db_change_log size. A run's own writes
(reviews, workflow actions, uploads) show up here; reconcile side effects (04 §5a) show
up as unexpected approval deltas / duplicate PENDING rows.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

TABLES = ["tenders", "tender_approval_requests", "tender_workflow_states", "tender_comments",
          "tender_workflow_comments", "status_history", "activity_log", "tender_document_manifest",
          "users", "email_notification_logs"]


def snapshot(db) -> dict:
    snap: dict = {"taken_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    existing = {r[0] for r in db.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'")}
    counts = {}
    for t in TABLES + ["db_change_log"]:
        if t in existing:
            counts[t] = int(db.scalar(f"SELECT count(*) FROM {t}"))
    snap["row_counts"] = counts
    snap["approvals_stage_status"] = {f"{r[0]}|{r[1]}": int(r[2]) for r in db.query(
        "SELECT stage, status, count(*) FROM tender_approval_requests GROUP BY 1,2 ORDER BY 1,2")}
    snap["duplicate_pending_groups"] = int(db.scalar(
        "SELECT count(*) FROM (SELECT tender_id, stage FROM tender_approval_requests WHERE status='PENDING' "
        "GROUP BY 1,2 HAVING count(*) > 1) d"))
    snap["tender_status"] = {(r[0] or "<null>"): int(r[1]) for r in db.query(
        "SELECT status, count(*) FROM tenders GROUP BY 1 ORDER BY 1")}
    snap["tender_stage"] = {(r[0] or "<null>"): int(r[1]) for r in db.query(
        "SELECT current_stage, count(*) FROM tenders GROUP BY 1 ORDER BY 1")}
    return snap


def _delta(a: dict, b: dict) -> dict:
    keys = sorted(set(a) | set(b))
    return {k: b.get(k, 0) - a.get(k, 0) for k in keys if b.get(k, 0) != a.get(k, 0)}


def diff(before: dict, after: dict) -> dict:
    return {
        "before_at": before.get("taken_at_utc"), "after_at": after.get("taken_at_utc"),
        "row_counts": _delta(before.get("row_counts", {}), after.get("row_counts", {})),
        "approvals_stage_status": _delta(before.get("approvals_stage_status", {}), after.get("approvals_stage_status", {})),
        "duplicate_pending_groups": {"before": before.get("duplicate_pending_groups"),
                                     "after": after.get("duplicate_pending_groups")},
        "tender_status": _delta(before.get("tender_status", {}), after.get("tender_status", {})),
        "tender_stage": _delta(before.get("tender_stage", {}), after.get("tender_stage", {})),
    }


def render(d: dict) -> str:
    out = [f"Drift {d['before_at']} -> {d['after_at']}"]
    for sect in ("row_counts", "approvals_stage_status", "tender_status", "tender_stage"):
        out.append(f"  {sect}: " + (", ".join(f"{k} {v:+d}" for k, v in d[sect].items()) or "no change"))
    dp = d["duplicate_pending_groups"]
    out.append(f"  duplicate PENDING groups: {dp['before']} -> {dp['after']}")
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("snapshot")
    s.add_argument("--out", required=True)
    s.add_argument("--local", action="store_true")
    d = sub.add_parser("diff")
    d.add_argument("before")
    d.add_argument("after")
    d.add_argument("--out")
    args = ap.parse_args(argv)
    if args.cmd == "snapshot":
        from common.config import load_config
        from common.safety import preflight_ssh_alias, preflight_target
        from seeder.db import Db
        cfg = load_config()
        preflight_target(cfg)
        preflight_ssh_alias(cfg)
        snap = snapshot(Db(cfg, local=args.local))
        Path(args.out).write_text(json.dumps(snap, indent=1, sort_keys=True))
        print(f"snapshot -> {args.out}")
        return 0
    res = diff(json.loads(Path(args.before).read_text()), json.loads(Path(args.after).read_text()))
    print(render(res))
    if args.out:
        Path(args.out).write_text(json.dumps(res, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
