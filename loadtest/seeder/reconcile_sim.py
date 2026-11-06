"""Python port of ApprovalController.reconcileStaleAndDuplicateApprovals().

Source: backend/src/main/java/com/tenderpocket/controllers/ApprovalController.java:110-352
(main 09129d2a; review 04 §5a). Every GET /api/approvals/counts and /pending runs it and
WRITES when the data is not a fixed point. The seeder must therefore produce data for which
`simulate()` returns no actions ("the first approvals GET must not rewrite the data").

Rows are plain dicts keyed by DB column name (see schema.TABLES). Only the decision logic
is ported; persistence is not.
"""
from __future__ import annotations

ALIASES_NOT_MIS = ("tpc", "tpc team", "clearance", "clearance team", "executive")
MIS_TEAM_STAGES = ("PAYMENT_APPROVAL", "MIS_PRICING", "DOC_VERIFICATION",
                   "SUBMISSION_PENDING", "WIN_LOSS_PENDING")          # ApprovalController.java:35-41
TERMINAL_STATUSES = ("Won", "Lost", "Awarded", "Not Awarded", "Not Participating")  # :239
LATE_A = ("SUBMISSION_READY", "SUBMISSION_PENDING", "SUBMITTED", "WIN_LOSS_PENDING", "WON", "LOST")


def _eq(a, b) -> bool:
    return a is not None and str(a).lower() == str(b).lower()


def _blank(v) -> bool:
    return v is None or str(v).strip() == ""


def _pos(v) -> bool:
    return v is not None and float(v) > 0


def _upper(v) -> str:
    return str(v).upper() if v is not None else ""


def simulate(tenders: dict[str, dict], approvals: list[dict]) -> list[tuple]:
    """Return the list of writes reconcile would perform. Empty list == fixed point."""
    actions: list[tuple] = []
    pending = [a for a in approvals if a["status"] == "PENDING"]
    # findByStatusOrderByCreatedAtDesc("PENDING") — newest first (:143)
    pending.sort(key=lambda a: (str(a.get("created_at") or ""), a.get("id") or 0), reverse=True)
    grouped: dict[str, list[dict]] = {}
    for a in pending:
        grouped.setdefault(f"{a['tender_id']}::{a['stage']}", []).append(a)

    for key, lst in grouped.items():
        latest = lst[0]
        for dup in lst[1:]:
            actions.append(("delete_duplicate", dup["tender_id"], dup["stage"], dup.get("id")))   # :161-163
        t = tenders.get(latest["tender_id"])
        if t is None:
            continue
        stage = latest["stage"]
        cs = t.get("current_stage")
        stale = False
        if stage == "SPEC_CLEARANCE":                                                    # :170-178
            if _eq(t.get("spec_verification_status"), "Approved") or (cs is not None and not _eq(cs, "SPEC_CLEARANCE")):
                stale = True
            elif not _eq(t.get("spec_verification_status"), "Pending"):
                actions.append(("delete_premature_spec", t["id"], stage, latest.get("id")))
                continue
        elif stage == "TPC_PRICING":                                                     # :179-184
            stale = _pos(t.get("tpc_purchase_price")) or _eq(t.get("pricing_route"), "MIS") or (cs is not None and _upper(cs) in LATE_A)
        elif stage == "MIS_PRICING":                                                     # :185-190
            stale = _pos(t.get("mis_final_price")) or _eq(t.get("pricing_status"), "Approved") or (cs is not None and _upper(cs) in LATE_A)
        elif stage == "PAYMENT_APPROVAL":                                                # :191-195
            stale = _eq(t.get("payment_status"), "Approved") or (cs is not None and _upper(cs) in ("DUAL_TRACK",) + LATE_A)
        elif stage == "DOC_VERIFICATION":                                                # :196-200
            stale = _eq(t.get("verification_status"), "Approved") or (cs is not None and _upper(cs) in LATE_A)
        elif stage == "SUBMISSION_PENDING":                                              # :201-205
            stale = _eq(t.get("submission_status"), "Approved") or (cs is not None and _upper(cs) in ("SUBMITTED", "WIN_LOSS_PENDING", "WON", "LOST"))
        elif stage == "WIN_LOSS_PENDING":                                                # :206-215
            oc = t.get("outcome_status")
            stale = (oc is not None and not _eq(oc, "Pending")) or _eq(cs, "WON") or _eq(cs, "LOST") \
                or any(_eq(t.get("status"), s) for s in ("Awarded", "Won", "Not Awarded", "Lost"))
        if stale:
            actions.append(("mark_stale_approved", t["id"], stage, latest.get("id")))       # :217-221
        elif stage in MIS_TEAM_STAGES:                                                   # :222-231
            cur = latest.get("assigned_to")
            if cur is not None and cur.strip().lower() in ALIASES_NOT_MIS:
                actions.append(("reassign_mis", t["id"], stage, latest.get("id")))

    by_ts: dict[tuple, list[dict]] = {}
    for a in approvals:
        by_ts.setdefault((a["tender_id"], a["stage"]), []).append(a)

    def ensure(tid, stage, req_by, assigned, emd=None, mode=None, ref=None, receipt=None, tpc=None):
        rows = by_ts.get((tid, stage), [])
        ex = next((r for r in sorted(rows, key=lambda r: str(r.get("created_at") or ""), reverse=True)
                   if _eq(r["status"], "PENDING")), None)                                   # :112-113
        if ex is None:
            actions.append(("insert_pending", tid, stage, assigned if assigned is not None else "misteam"))
            return None
        for field, val in (("emd_amount", emd), ("transfer_mode", mode), ("transfer_ref_no", ref),
                           ("receipt_file_url", receipt), ("tpc_purchase_price", tpc)):      # :124-129
            if val is not None and ex.get(field) is None:
                actions.append(("fill_pending_field", tid, stage, field))
        return ex

    for t in tenders.values():                                                           # :237-348
        if t.get("status") is not None and t["status"] in TERMINAL_STATUSES:
            continue
        stage = _upper(t.get("current_stage"))
        tid = t["id"]
        exe = t.get("mis_executive") if t.get("mis_executive") is not None else "executive"
        if _eq(t.get("spec_verification_status"), "Pending"):                            # rule 1
            ensure(tid, "SPEC_CLEARANCE", exe, t.get("assigned_mis_member_spec") if t.get("assigned_mis_member_spec") is not None else "clearance")
        if stage in ("PAYMENT_APPROVAL", "EMD_PENDING") or _eq(t.get("payment_status"), "Pending"):  # rule 2
            if not _eq(t.get("payment_status"), "Approved") and not _eq(t.get("payment_status"), "Exempt"):
                if t.get("payment_status") is None or _eq(t.get("payment_status"), "None"):
                    actions.append(("tender_save_payment_pending", tid))
                assignee = t.get("assigned_mis_member_emd") if not _blank(t.get("assigned_mis_member_emd")) else (
                    t.get("assigned_mis_member") if not _blank(t.get("assigned_mis_member")) else "misteam")
                ensure(tid, "PAYMENT_APPROVAL", exe, assignee, t.get("emd_amount_actual"),
                       t.get("emd_payment_mode") if t.get("emd_payment_mode") is not None else "NEFT / RTGS",
                       t.get("emd_beneficiary_name") if t.get("emd_beneficiary_name") is not None else t.get("emd_payment_ref"),
                       t.get("emd_receipt_doc_path"))
        if stage == "TPC_PRICING" or (stage == "DUAL_TRACK" and not _pos(t.get("tpc_purchase_price")) and not _pos(t.get("mis_final_price"))):  # rule 3
            ensure(tid, "TPC_PRICING", "clearance", "tpc")
        if stage == "MIS_PRICING" and not _pos(t.get("mis_final_price")):                  # rule 4
            amm = t.get("assigned_mis_member")
            if amm is not None and amm.strip().lower() in ALIASES_NOT_MIS:
                actions.append(("tender_save_clear_mis_member", tid))
                amm = None
            assignee = amm.strip() if not _blank(amm) and amm.strip().lower() not in ALIASES_NOT_MIS else "misteam"
            req = ensure(tid, "MIS_PRICING", "tpc", assignee, tpc=t.get("tpc_purchase_price"))
            if req is not None and req.get("assigned_to") is not None and req["assigned_to"].strip().lower() in ALIASES_NOT_MIS:
                actions.append(("reassign_mis_pricing", tid))
        if stage == "DOC_VERIFICATION" or _eq(t.get("verification_status"), "Pending"):   # rule 5
            if not _eq(t.get("verification_status"), "Approved"):
                assignee = t.get("assigned_mis_member_docs") if not _blank(t.get("assigned_mis_member_docs")) else (
                    t.get("assigned_mis_member") if not _blank(t.get("assigned_mis_member")) else "misteam")
                req = ensure(tid, "DOC_VERIFICATION", exe, assignee)
                if req is not None and t.get("working_path") is not None and req.get("working_path") is None:
                    actions.append(("copy_working_path", tid))
        if stage == "SUBMISSION_PENDING" or _eq(t.get("submission_status"), "Pending"):   # rule 6
            if not _eq(t.get("submission_status"), "Approved"):
                assignee = t.get("assigned_mis_member_submission") if not _blank(t.get("assigned_mis_member_submission")) else (
                    t.get("assigned_mis_member") if not _blank(t.get("assigned_mis_member")) else "misteam")
                ensure(tid, "SUBMISSION_PENDING", exe, assignee)
        if stage == "WIN_LOSS_PENDING" or _eq(t.get("outcome_status"), "Pending"):         # rule 7
            oc = t.get("outcome_status")
            if not _eq(oc, "Won") and not _eq(oc, "Lost") and not _eq(oc, "Approved"):
                assignee = t.get("assigned_mis_member_submission") if not _blank(t.get("assigned_mis_member_submission")) else (
                    t.get("assigned_mis_member") if not _blank(t.get("assigned_mis_member")) else "misteam")
                req = ensure(tid, "WIN_LOSS_PENDING", exe, assignee)
                if req is not None and t.get("loss_reason") is not None and req.get("loss_reason_executive") is None:
                    actions.append(("copy_loss_reason", tid))
    return actions
