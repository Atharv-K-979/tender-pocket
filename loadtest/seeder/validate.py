#!/usr/bin/env python3
"""Validate a loaded tier (read-only) — or a generated tier offline with --csv.

    python3 seeder/validate.py --tier 1000            # live DB on EC2-2 (read-only session)
    python3 seeder/validate.py --tier 1000 --csv      # generated CSVs only (no DB)

Checks:
  counts       row counts per table == generator manifest (users: lt_* only)
  enums        approval stage ∈ TenderWorkflowStage (TenderWorkflowStage.java:3-20), approval
               status ∈ PENDING/APPROVED/REJECTED/CHANGES_REQUESTED/SUBMITTED, current_stage ∈
               values written by code (04 §1)
  one_pending  at most one PENDING row per (tender, stage)
  fixed_point  reconcile_sim.simulate() returns no actions (stage consistency: the first
               GET /api/approvals/* will not rewrite the data, 04 §5a)
  proportions  universe group shares within tolerance of seed.yaml at this tier
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common.config import load_config  # noqa: E402
from seeder import reconcile_sim  # noqa: E402
from seeder.schema import TABLES, TABLE_ORDER  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent / "out"
STAGE_ENUM = {"EXECUTIVE_ASSIGNMENT", "SPEC_CLEARANCE", "BID_DOCS_PREPARATION", "BID_DOC_GENERATED",
              "PAYMENT_APPROVAL", "DUAL_TRACK", "TPC_PRICING", "MIS_PRICING", "DOC_VERIFICATION",
              "SUBMISSION_READY", "SUBMISSION_PENDING", "SUBMITTED", "WIN_LOSS_PENDING", "WON", "LOST",
              "UNABLE_TO_SUBMIT"}
APPROVAL_STATUS = {"PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED", "SUBMITTED"}
CURRENT_STAGE_WRITTEN = {"NEW", "SPEC_CLEARANCE", "BID_DOCS_PREPARATION", "EMD_PAYMENT", "PAYMENT_APPROVAL",
                         "DUAL_TRACK", "TPC_PRICING", "MIS_PRICING", "DOC_VERIFICATION", "BID_DOC_PENDING",
                         "SUBMISSION_READY", "SUBMISSION_PENDING", "WIN_LOSS_PENDING", "WON", "LOST",
                         "UNABLE_TO_SUBMIT"}
TENDER_COLS = ["id", "status", "current_stage", "spec_verification_status", "payment_status",
               "verification_status", "submission_status", "outcome_status", "pricing_status", "pricing_route",
               "tpc_purchase_price", "mis_final_price", "mis_executive", "assigned_mis_member",
               "assigned_mis_member_emd", "assigned_mis_member_docs", "assigned_mis_member_submission",
               "assigned_mis_member_spec", "emd_amount_actual", "emd_payment_mode", "emd_beneficiary_name",
               "emd_payment_ref", "emd_receipt_doc_path", "working_path", "loss_reason"]
APPROVAL_COLS = ["id", "tender_id", "stage", "status", "assigned_to", "emd_amount", "transfer_mode",
                 "transfer_ref_no", "receipt_file_url", "tpc_purchase_price", "working_path",
                 "loss_reason_executive", "created_at"]
NUMERIC = {"tpc_purchase_price", "mis_final_price", "emd_amount_actual", "emd_amount", "id"}


def _num(rows: list[dict]) -> list[dict]:
    for r in rows:
        for k in NUMERIC:
            if k in r and r[k] not in (None, ""):
                try:
                    r[k] = float(r[k]) if k != "id" else int(float(r[k]))
                except ValueError:
                    pass
    return rows


def read_csv_table(tier_dir: Path, table: str, keep: list[str] | None = None) -> list[dict]:
    cols = [c for c, _ in TABLES[table]]
    out = []
    with gzip.open(tier_dir / f"{table}.csv.gz", "rt", encoding="utf-8", newline="") as fh:
        for row in csv.reader(fh):
            d = {c: (None if v == "\\N" else v) for c, v in zip(cols, row)}
            out.append({k: d[k] for k in keep} if keep else d)
    return out


def group_of(t: dict) -> str:
    st, cs = t.get("status"), t.get("current_stage")
    if st in ("Issued", "New") and cs == "NEW":
        return "new_unactioned"
    if st == "Not Participating":
        return "not_participating"
    if st in ("Submitted", "Won", "Lost"):
        return "submitted_won_lost"
    return "active_workflow"


def run_checks(tenders: list[dict], approvals: list[dict], counts: dict[str, int], manifest: dict,
               seed_cfg: dict) -> list[tuple[str, bool, str]]:
    res: list[tuple[str, bool, str]] = []
    exp = manifest["row_counts"]
    bad = {t: (counts.get(t), exp.get(t)) for t in TABLE_ORDER if counts.get(t) != exp.get(t)}
    res.append(("counts", not bad, "all match" if not bad else f"mismatch {bad}"))

    bad_stage = {a["stage"] for a in approvals} - STAGE_ENUM
    bad_status = {a["status"] for a in approvals} - APPROVAL_STATUS
    bad_cs = {t["current_stage"] for t in tenders} - CURRENT_STAGE_WRITTEN
    ok = not (bad_stage or bad_status or bad_cs)
    res.append(("enums", ok, "ok" if ok else f"stage={bad_stage} status={bad_status} current_stage={bad_cs}"))

    seen: dict[tuple, int] = {}
    for a in approvals:
        if a["status"] == "PENDING":
            k = (a["tender_id"], a["stage"])
            seen[k] = seen.get(k, 0) + 1
    dups = {k: v for k, v in seen.items() if v > 1}
    res.append(("one_pending", not dups, f"{len(seen)} pending groups" if not dups else f"{len(dups)} duplicate groups e.g. {list(dups)[:3]}"))

    acts = reconcile_sim.simulate({t["id"]: t for t in tenders}, approvals)
    res.append(("fixed_point", not acts, "reconcile would not write" if not acts else f"{len(acts)} actions e.g. {acts[:5]}"))

    prefix = seed_cfg.get("id_prefix_universe", "LTU-")
    uni = [t for t in tenders if str(t["id"]).startswith(prefix)]
    tol = float(seed_cfg.get("proportion_tolerance", 0.01))
    weights = seed_cfg["categories"]
    total_w = sum(weights.values())
    detail, ok = [], True
    if uni:
        for g, members in seed_cfg.get("groups", {}).items():
            target = sum(weights[m] for m in members) / total_w
            actual = sum(1 for t in uni if group_of(t) == g) / len(uni)
            within = abs(actual - target) <= tol + 1.0 / len(uni)
            ok &= within
            detail.append(f"{g}={actual:.4f}(target {target:.4f}{'' if within else ' OUT'})")
    res.append(("proportions", ok, "; ".join(detail) or "no universe tenders"))
    return res


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tier", type=int, required=True)
    ap.add_argument("--out", default=str(OUT_DIR))
    ap.add_argument("--csv", action="store_true", help="validate generated CSVs (offline)")
    ap.add_argument("--local", action="store_true")
    ap.add_argument("--json", help="write results JSON here")
    args = ap.parse_args(argv)

    tier_dir = Path(args.out) / f"tier_{args.tier}"
    manifest = json.loads((tier_dir / "manifest.json").read_text())
    cfg = load_config(require_env=not args.csv)
    seed_cfg = cfg["seed"]
    prefix = seed_cfg["users"]["prefix"]

    if args.csv:
        tenders = _num(read_csv_table(tier_dir, "tenders", TENDER_COLS))
        approvals = _num(read_csv_table(tier_dir, "tender_approval_requests", APPROVAL_COLS))
        counts = {}
        for t in TABLE_ORDER:
            with gzip.open(tier_dir / f"{t}.csv.gz", "rt", encoding="utf-8", newline="") as fh:
                counts[t] = sum(1 for _ in csv.reader(fh))
    else:
        from common.safety import preflight_ssh_alias, preflight_target
        preflight_target(cfg)
        preflight_ssh_alias(cfg)
        from seeder.db import Db
        db = Db(cfg, local=args.local)
        tenders = _num(db.copy_out("SELECT " + ", ".join(TENDER_COLS) + " FROM tenders"))
        approvals = _num(db.copy_out("SELECT " + ", ".join(APPROVAL_COLS) + " FROM tender_approval_requests"))
        counts = {}
        for t in TABLE_ORDER:
            where = f" WHERE username LIKE '{prefix.replace('_', chr(92) + '_')}%'" if t == "users" else ""
            counts[t] = int(db.scalar(f"SELECT count(*) FROM {t}{where}"))

    results = run_checks(tenders, approvals, counts, manifest, seed_cfg)
    width = max(len(r[0]) for r in results)
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name:<{width}}  {detail}")
    if args.json:
        Path(args.json).write_text(json.dumps([{"check": n, "ok": o, "detail": d} for n, o, d in results], indent=1))
    return 0 if all(ok for _, ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main())
