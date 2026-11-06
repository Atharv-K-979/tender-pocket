"""Expected Postgres schema (from the JPA entities) and live-schema validation.

Column lists are copied from backend/src/main/java/com/tenderpocket/models/*.java at main
09129d2a (Hibernate CamelCaseToUnderscores naming; explicit @Column names where given):
  Tender.java:28-267, TenderApprovalRequest.java:10-70, TenderWorkflowState.java:14-153,
  TenderComment.java:10-30, TenderWorkflowComment.java:14-35, StatusHistory.java:9-26,
  ActivityLog.java:9-30, User.java:12-23, TenderDocumentManifest.java:14-56.
Type families: text (varchar/text), float (double precision), int (integer/bigint),
bool (boolean), ts (timestamp). After boot, TenderPocketApplication.java:52-70 ALTERs 14
tenders columns to text, so text/varchar are treated as one family.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

T, F, I, B, TS = "text", "float", "int", "bool", "ts"

TABLES: dict[str, list[tuple[str, str]]] = {
    "users": [("username", T), ("password_hash", T), ("role", T), ("email", T)],
    "tenders": [
        ("id", T), ("ref_no", T), ("title", T), ("authority", T), ("estimated_cost", F),
        ("estimated_cost_raw", T), ("emd", F), ("emd_raw", T), ("document_fee", F),
        ("document_fee_raw", T), ("location", T), ("sector", T), ("due_date", T),
        ("opening_date", T), ("document_url", T), ("downloaded_docs", T), ("original_url", T),
        ("status", T), ("notes", T), ("scraped_at", T), ("entry_date", T), ("mis_executive", T),
        ("assigned_by", T), ("assigned_at", T), ("source", T), ("source_id", T),
        ("offered_model", T), ("vertical_name", T), ("place", T), ("state", T),
        ("tender_type", T), ("publish_date", T), ("start_date", T), ("time", T),
        ("pre_bid_date", T), ("corrigendum_remark", T), ("product_name_as_per_tender", T),
        ("product_name_as_per_marken", T), ("bid_qty", I), ("official_reference_number", T),
        ("eprocurement_portal_id", T), ("is_corrigendum", B), ("assigned_mis_executive", T),
        ("tpc_purchase_price", F), ("mis_final_price", F), ("pricing_route", T),
        ("current_stage", T), ("quoted_qty", I), ("ai_details_summary", T),
        ("ai_history_summary", T), ("working_path", T), ("assigned_mis_member", T),
        ("assigned_mis_member_emd", T), ("assigned_mis_member_docs", T),
        ("assigned_mis_member_submission", T), ("assigned_mis_member_spec", T),
        ("emd_amount_actual", F), ("emd_payment_mode", T), ("emd_payment_ref", T),
        ("emd_payment_date", T), ("loss_reason", T), ("payment_status", T),
        ("verification_status", T), ("submission_status", T), ("outcome_status", T),
        ("spec_verification_status", T), ("emd_applicable", B), ("emd_beneficiary_name", T),
        ("emd_receipt_doc_path", T), ("emd_receipt_confidential", B),
        ("final_tech_spec_filename", T), ("final_tech_spec_uploaded_by", T),
        ("final_tech_spec_uploaded_at", T), ("spec_compliance_type", T), ("pricing_status", T),
        ("pricing_go_ahead_by", T), ("pricing_go_ahead_at", T), ("can_final_submit", B),
        ("selected_model_id", I), ("schedule_product_models", T),
    ],
    "tender_workflow_states": [
        ("id", I), ("tender_id", T), ("current_step", I), ("step_name", T),
        ("assigned_executive", T), ("assigned_at", T), ("spec_status", T),
        ("spec_compliance_type", T), ("final_tech_spec_filename", T),
        ("final_tech_spec_uploaded_by", T), ("final_tech_spec_uploaded_at", T),
        ("spec_clearance_remarks", T), ("bid_package_status", T), ("bid_package_generated_at", T),
        ("emd_applicable", B), ("emd_status", T), ("emd_beneficiary_name", T), ("emd_amount", F),
        ("emd_payment_mode", T), ("emd_receipt_doc_path", T), ("emd_receipt_confidential", B),
        ("emd_approved_by", T), ("emd_approved_at", T), ("track_a_pricing_status", T),
        ("pricing_route", T), ("tpc_purchase_price", F), ("mis_final_price", F),
        ("pricing_go_ahead_by", T), ("pricing_go_ahead_at", T), ("track_b_doc_status", T),
        ("docs_verified_by", T), ("docs_verified_at", T), ("total_path_docs", I),
        ("verified_path_docs", I), ("doc_verification_remarks", T), ("can_final_submit", B),
        ("submitted_by", T), ("submitted_at", T), ("submission_ack_path", T),
        ("outcome_status", T), ("loss_reason", T), ("created_at", T), ("updated_at", T),
    ],
    "tender_approval_requests": [
        ("id", I), ("tender_id", T), ("stage", T), ("requested_by", T), ("assigned_to", T),
        ("status", T), ("working_path", T), ("emd_amount", F), ("transfer_mode", T),
        ("transfer_ref_no", T), ("receipt_file_url", T), ("loss_reason_executive", T),
        ("loss_reason_mis", T), ("tpc_purchase_price", F), ("mis_final_price", F),
        ("reviewed_by", T), ("reviewer_comment", T), ("created_at", TS), ("updated_at", TS),
    ],
    "tender_comments": [
        ("id", I), ("tender_id", T), ("stage", T), ("author_username", T), ("author_role", T),
        ("comment_text", T), ("created_at", TS),
    ],
    "tender_workflow_comments": [
        ("id", I), ("tender_id", T), ("phase", T), ("author", T), ("author_role", T),
        ("comment", T), ("created_at", T),
    ],
    "status_history": [
        ("id", I), ("tender_id", T), ("from_status", T), ("to_status", T), ("changed_by", T),
        ("changed_at", T),
    ],
    "activity_log": [
        ("id", I), ("username", T), ("role", T), ("action", T), ("tender_id", T),
        ("timestamp", T), ("details", T),
    ],
    "tender_document_manifest": [
        ("id", I), ("tender_id", T), ("file_name", T), ("display_name", T), ("relative_path", T),
        ("file_category", T), ("file_size_bytes", I), ("file_extension", T),
        ("is_confidential", B), ("is_authoritative", B), ("verified_by_mis", B),
        ("verified_by_user", T), ("verified_at", T), ("created_at", T),
    ],
}

# Load order (no FK constraints exist, 07 §2, but keep parents first anyway).
TABLE_ORDER = ["users", "tenders", "tender_workflow_states", "tender_approval_requests",
               "tender_comments", "tender_workflow_comments", "status_history",
               "activity_log", "tender_document_manifest"]
# Tables whose identity sequence must be re-synced after an explicit-id COPY.
IDENTITY_TABLES = [t for t in TABLE_ORDER if t not in ("users", "tenders")]

_FAMILY = {
    "character varying": T, "text": T, "character": T, "varchar": T,
    "double precision": F, "real": F, "numeric": F,
    "integer": I, "bigint": I, "smallint": I,
    "boolean": B,
    "timestamp without time zone": TS, "timestamp with time zone": TS, "timestamp": TS,
    "date": TS,
}

# Live query used by load.py / validate.py (SELECT only).
LIVE_SCHEMA_SQL = """
SELECT table_name, column_name, data_type, is_nullable, coalesce(column_default,''),
       coalesce(character_maximum_length::text,''), is_identity
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ({tables})
ORDER BY table_name, ordinal_position;
""".strip()


def live_schema_sql() -> str:
    return LIVE_SCHEMA_SQL.format(tables=", ".join(f"'{t}'" for t in TABLE_ORDER))


@dataclass
class LiveColumn:
    table: str
    name: str
    data_type: str
    nullable: bool
    default: str
    max_len: int | None
    identity: bool

    @property
    def family(self) -> str:
        return _FAMILY.get(self.data_type, "?" + self.data_type)


def parse_live_schema_tsv(text: str) -> dict[str, dict[str, LiveColumn]]:
    out: dict[str, dict[str, LiveColumn]] = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 7:
            continue
        table, col, dtype, nullable, default, maxlen, ident = parts[:7]
        out.setdefault(table, {})[col] = LiveColumn(
            table, col, dtype, nullable == "YES", default,
            int(maxlen) if maxlen.strip().isdigit() else None, ident == "YES")
    return out


def load_schema_json(path: str) -> dict[str, dict[str, LiveColumn]]:
    """Fixture / snapshot format: {table: [{name,data_type,nullable,default,max_len,identity}]}"""
    with open(path, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    out: dict[str, dict[str, LiveColumn]] = {}
    for table, cols in raw.items():
        for c in cols:
            out.setdefault(table, {})[c["name"]] = LiveColumn(
                table, c["name"], c["data_type"], bool(c.get("nullable", True)),
                c.get("default", "") or "", c.get("max_len"), bool(c.get("identity", False)))
    return out


def expected_schema_json() -> dict:
    """A schema snapshot that exactly matches what the generator writes (used for fixtures)."""
    rev = {T: "character varying", F: "double precision", I: "bigint", B: "boolean",
           TS: "timestamp without time zone"}
    out = {}
    for table, cols in TABLES.items():
        out[table] = []
        for name, fam in cols:
            out[table].append({"name": name, "data_type": "text" if fam == T else rev[fam],
                               "nullable": name not in ("id", "username"),
                               "default": "", "max_len": None,
                               "identity": name == "id" and table in IDENTITY_TABLES})
    return out


def validate_schema(live: dict[str, dict[str, LiveColumn]],
                    max_lengths: dict[str, dict[str, int]] | None = None) -> tuple[list[str], list[str]]:
    """Return (errors, warnings). Errors abort the load with a clear diff."""
    errors: list[str] = []
    warnings: list[str] = []
    for table, cols in TABLES.items():
        lcols = live.get(table)
        if not lcols:
            errors.append(f"[{table}] table missing in live schema (backend must boot once with ddl-auto=update)")
            continue
        expected_names = {n for n, _ in cols}
        for name, fam in cols:
            lc = lcols.get(name)
            if lc is None:
                errors.append(f"[{table}] - {name}: expected ({fam}) but missing in live schema")
                continue
            if lc.family != fam:
                errors.append(f"[{table}] ~ {name}: type family live={lc.data_type} expected={fam}")
            ml = (max_lengths or {}).get(table, {}).get(name)
            if ml and lc.max_len and ml > lc.max_len:
                errors.append(f"[{table}] ~ {name}: generated max length {ml} > live limit {lc.max_len}")
        for name, lc in lcols.items():
            if name in expected_names:
                continue
            if not lc.nullable and not lc.default and not lc.identity:
                errors.append(f"[{table}] + {name}: live NOT NULL column without default, unknown to generator")
            else:
                warnings.append(f"[{table}] + {name}: extra live column (nullable/defaulted) left NULL/default")
    return errors, warnings


def format_diff(errors: list[str], warnings: list[str]) -> str:
    lines = ["Schema validation " + ("FAILED" if errors else "passed")]
    lines += ["  ERROR " + e for e in errors]
    lines += ["  warn  " + w for w in warnings]
    return "\n".join(lines)
