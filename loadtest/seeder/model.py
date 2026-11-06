"""Deterministic tender universe + fixture block for the load-test seed.

Design (docs/loadtest/seed-design.md):
  * Universe tender i is generated from random.Random(f"{seed}:u:{i}") only, and its
    category comes from a proportional (largest-deficit) sequence, so tier N is the exact
    prefix 0..N-1 of tier M>N (subset property) and every prefix holds the configured
    proportions to within one tender per category.
  * Every category template is a fixed point of ApprovalController reconcile
    (reconcile_sim.simulate() returns no actions) — see the rule-by-rule notes below.
  * Fixtures (per-VU pre-staged tenders, Track B tenders, probe tenders) are identical at
    every tier and are generated first, so their child-row ids are identical too.

Value sets follow the code: current_stage values written by code (04 §1); stage enum names
(TenderWorkflowStage.java:3-20); approval statuses (TenderApprovalRequest.java:28); user
roles as stored (AuthController.java:251); string dates "yyyy-MM-dd HH:mm:ss"
(TenderController.java:1585-1590) and the due-date shapes parsed at TenderController.java:568-590.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import random
from dataclasses import dataclass, field

# --------------------------------------------------------------------------- vocab
AUTHORITIES = [
    "Ministry of Defence", "Indian Railways", "All India Institute of Medical Sciences",
    "Directorate General of Health Services", "Indian Council of Medical Research",
    "Bharat Heavy Electricals Limited", "Oil and Natural Gas Corporation Limited",
    "Steel Authority of India Limited", "National Thermal Power Corporation",
    "Department of Health and Family Welfare, Government of Maharashtra",
    "Municipal Corporation of Greater Mumbai", "Delhi Development Authority",
    "Indian Space Research Organisation", "Defence Research and Development Organisation",
    "Employees State Insurance Corporation", "Central Public Works Department",
    "Airports Authority of India", "Hindustan Aeronautics Limited",
    "National Health Mission, Uttar Pradesh", "Kerala Medical Services Corporation Limited",
    "Tamil Nadu Medical Services Corporation", "Rajasthan Medical Services Corporation",
    "Indian Army Medical Corps", "Border Security Force", "Central Reserve Police Force",
]
CITIES = [
    ("Mumbai", "Maharashtra"), ("Pune", "Maharashtra"), ("New Delhi", "Delhi"),
    ("Bengaluru", "Karnataka"), ("Chennai", "Tamil Nadu"), ("Hyderabad", "Telangana"),
    ("Kolkata", "West Bengal"), ("Lucknow", "Uttar Pradesh"), ("Jaipur", "Rajasthan"),
    ("Ahmedabad", "Gujarat"), ("Bhopal", "Madhya Pradesh"), ("Patna", "Bihar"),
    ("Thiruvananthapuram", "Kerala"), ("Bhubaneswar", "Odisha"), ("Guwahati", "Assam"),
    ("Chandigarh", "Punjab"), ("Dehradun", "Uttarakhand"), ("Raipur", "Chhattisgarh"),
    ("Ranchi", "Jharkhand"), ("Nagpur", "Maharashtra"),
]
SECTORS = ["Healthcare", "Medical Equipment", "Laboratory", "Defence", "Railways", "Energy",
           "Education", "IT & Electronics", "Infrastructure", "Water & Sanitation"]
PRODUCTS = [
    "Multipara Patient Monitor", "ICU Ventilator", "Defibrillator with AED", "Infusion Pump",
    "Syringe Pump", "Ultrasound Machine with Colour Doppler", "Digital X-Ray System",
    "Anaesthesia Workstation", "Haematology Analyser", "Biochemistry Analyser",
    "Operation Theatre Light", "Electrosurgical Unit", "ECG Machine 12 Channel",
    "Pulse Oximeter", "Autoclave Horizontal", "Hospital Bed ICU Motorised",
    "Oxygen Concentrator", "Dialysis Machine", "CT Scanner 128 Slice", "Blood Bank Refrigerator",
]
PHRASES = [
    "as per the technical specifications annexed", "including installation, testing and commissioning",
    "with comprehensive warranty of five years", "followed by CMC for five years",
    "along with training of clinical and technical staff", "conforming to IEC 60601 standards",
    "with all standard accessories and consumables for one year", "on turnkey basis",
    "including site preparation where required", "with uninterrupted power supply backup",
]
SOURCES = ["GeM", "GeM", "GeM", "Tender247", "email"]
WORDS = ("the bidder shall supply equipment compliant with specification clause tender schedule "
         "warranty installation training delivery period acceptance inspection documentation "
         "performance security earnest money deposit eligibility criteria turnover experience "
         "authorisation manufacturer service support uptime calibration certificate").split()

NEW_GROUP = ("new_unassigned", "new_assigned")
ACTIVE = ("spec_upload_pending", "spec_generated", "spec_clearance_pending", "bid_docs_preparation",
          "payment_approval", "dual_track", "tpc_pricing", "mis_pricing", "doc_verification",
          "submission_ready", "submission_pending")
TERMINAL = ("win_loss_pending", "won", "lost")
ALL_CATEGORIES = NEW_GROUP + ("not_participating",) + ACTIVE + TERMINAL

# Order of reviewable stages along the main path (04 §2).
PATH = ["SPEC_CLEARANCE", "PAYMENT_APPROVAL", "TPC_PRICING", "MIS_PRICING", "DOC_VERIFICATION",
        "SUBMISSION_PENDING", "WIN_LOSS_PENDING"]


def fmt(d: dt.datetime) -> str:
    return d.strftime("%Y-%m-%d %H:%M:%S")


def java_date_string(d: dt.datetime) -> str:
    """java.util.Date.toString() as GeMScraperService writes scraped_at (TenderStatusResolver.java:33-36)."""
    return d.strftime("%a %b %d %H:%M:%S GMT %Y")


def sha256_hex(password: str) -> str:
    """SecurityConfig.passwordEncoder: unsalted single-round SHA-256 hex (SecurityConfig.java:29-56)."""
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- users
@dataclass
class Users:
    by_role: dict[str, list[str]]
    inactive_execs: list[str]
    rows: list[dict]

    @property
    def owners(self) -> list[str]:
        return self.by_role["Tender Executive"] + self.inactive_execs

    def first(self, role: str) -> str:
        return self.by_role[role][0]


def username(prefix: str, code: str, n: int) -> str:
    return f"{prefix}{code}_{n:02d}"


def build_users(seed_cfg: dict, password: str) -> Users:
    ucfg = seed_cfg["users"]
    prefix, domain = ucfg["prefix"], ucfg["email_domain"]
    pw_hash = sha256_hex(password)
    by_role: dict[str, list[str]] = {}
    rows = []
    for role, spec in ucfg["roles"].items():
        names = [username(prefix, spec["code"], i + 1) for i in range(int(spec["count"]))]
        by_role[role] = names
        for n in names:
            rows.append({"username": n, "password_hash": pw_hash, "role": role, "email": f"{n}@{domain}"})
    inactive = [f"{prefix}exec_x{i + 1:02d}" for i in range(int(ucfg.get("inactive_executives", 0)))]
    for n in inactive:
        rows.append({"username": n, "password_hash": pw_hash, "role": "Tender Executive", "email": f"{n}@{domain}"})
    for n in rows:
        assert 3 <= len(n["username"]) <= 20, n  # AuthController.java:251-262 username rule
    return Users(by_role, inactive, rows)


# --------------------------------------------------------------------------- proportions
def proportional_sequence(weights: dict[str, float], n: int):
    """Yield n categories so that every prefix k has count_c within 1 of k*w_c."""
    total = sum(weights.values())
    keys = list(weights)
    w = [weights[k] / total for k in keys]
    counts = [0] * len(keys)
    for i in range(n):
        best, best_def = 0, None
        for j in range(len(keys)):
            deficit = w[j] * (i + 1) - counts[j]
            if best_def is None or deficit > best_def + 1e-12:
                best, best_def = j, deficit
        counts[best] += 1
        yield keys[best]


# --------------------------------------------------------------------------- tender
@dataclass
class Bundle:
    tender: dict
    state: dict | None = None
    approvals: list[dict] = field(default_factory=list)
    comments: list[dict] = field(default_factory=list)
    wcomments: list[dict] = field(default_factory=list)
    history: list[dict] = field(default_factory=list)
    activity: list[dict] = field(default_factory=list)
    manifest: list[dict] = field(default_factory=list)
    category: str = ""


class Factory:
    def __init__(self, seed_cfg: dict, users: Users):
        self.cfg = seed_cfg
        self.users = users
        self.anchor = dt.datetime.strptime(seed_cfg["anchor_date"], "%Y-%m-%d").replace(hour=12)
        self.v = seed_cfg.get("variants", {})
        self.p = seed_cfg.get("payload", {})
        self.c = seed_cfg.get("children", {})

    # ---- helpers
    def _when(self, rng: random.Random, days_back_min: float, days_back_max: float) -> dt.datetime:
        return self.anchor - dt.timedelta(days=rng.uniform(days_back_min, days_back_max),
                                          seconds=rng.randint(0, 86399))

    def _text(self, rng: random.Random, lo: int, hi: int) -> str:
        target = rng.randint(lo, hi)
        words = rng.choices(WORDS, k=target // 6 + 4)
        out: list[str] = []
        for k in range(0, len(words), 12):
            out.append(" ".join(words[k:k + 12]).capitalize() + ". ")
        return "".join(out)[:target].rstrip()

    def _pick(self, rng, role: str, alias: str | None = None) -> str:
        if alias and rng.random() < float(self.v.get("team_alias_share", 0.25)):
            return alias
        return rng.choice(self.users.by_role[role])

    def _owner(self, rng) -> str:
        owners = self.users.owners
        # Zipf-like skew: low indexes own more tenders.
        weights = [1.0 / (k + 1) ** 0.6 for k in range(len(owners))]
        return rng.choices(owners, weights=weights, k=1)[0]

    def base_tender(self, tid: str, rng: random.Random, created: dt.datetime, due_future: bool) -> dict:
        city, state = rng.choice(CITIES)
        product = rng.choice(PRODUCTS)
        tlo, thi = self.p.get("title_chars", [100, 400])
        target = rng.randint(tlo, thi)
        title = f"Supply of {product} for {rng.choice(AUTHORITIES)}, {city}"
        while len(title) < target:
            title += ", " + rng.choice(PHRASES)
        title = title[:target].rstrip(", ")
        cost = round(10 ** rng.uniform(5, 9.7), 2)              # ₹1 lakh – ₹50 crore (AnalyticsController.java:182-189)
        emd = round(cost * rng.choice([0.01, 0.02, 0.03, 0.05]), 2)
        source = rng.choice(SOURCES)
        bid_no = rng.randint(1000000, 9999999)
        ref = f"GEM/{created.year}/B/{bid_no}" if source == "GeM" else f"T247-{bid_no}"
        due = created + dt.timedelta(days=rng.uniform(7, 45))
        if due_future:
            due = self.anchor + dt.timedelta(days=rng.uniform(3, 60))
        due_s = fmt(due) if rng.random() < 0.8 else f"{due.day} {due.strftime('%b %Y')}"
        docs = self._downloaded_docs(tid, rng, created)
        t = {c: None for c in TENDER_COLUMNS}
        t.update({
            "id": tid, "ref_no": ref, "title": title, "authority": rng.choice(AUTHORITIES),
            "estimated_cost": cost, "estimated_cost_raw": f"INR {cost:,.2f}", "emd": emd,
            "emd_raw": f"INR {emd:,.2f}", "document_fee": float(rng.choice([0, 500, 1000, 2500])),
            "document_fee_raw": None, "location": f"{city}, {state}", "sector": rng.choice(SECTORS),
            "due_date": due_s, "opening_date": fmt(due + dt.timedelta(hours=rng.choice([1, 2, 24]))),
            "document_url": f"https://bidplus.gem.gov.in/showbidDocument/{bid_no}",
            "downloaded_docs": json.dumps(docs), "original_url": f"https://bidplus.gem.gov.in/bidlists?bid={bid_no}",
            "status": "Issued", "notes": "",
            "scraped_at": java_date_string(created) if source == "GeM" and rng.random() < 0.6 else fmt(created),
            "entry_date": fmt(created), "source": source, "source_id": str(bid_no),
            "vertical_name": rng.choice(SECTORS), "place": city, "state": state,
            "tender_type": rng.choice(["Open", "Limited", "Single", "Global"]),
            "publish_date": fmt(created - dt.timedelta(days=rng.uniform(0, 3))),
            "start_date": fmt(created), "time": due.strftime("%H:%M"),
            "pre_bid_date": fmt(created + dt.timedelta(days=rng.uniform(2, 6))) if rng.random() < 0.4 else None,
            "bid_qty": rng.randint(1, 200), "official_reference_number": ref,
            "eprocurement_portal_id": f"EP{rng.randint(100000, 999999)}", "is_corrigendum": False,
            "current_stage": "NEW", "payment_status": "None", "verification_status": "None",
            "submission_status": "None", "outcome_status": "None", "spec_verification_status": "None",
            "pricing_status": "None", "emd_applicable": True, "emd_receipt_confidential": True,
            "can_final_submit": False,
        })
        if rng.random() < float(self.p.get("notes_share", 0.5)):
            lo, hi = self.p.get("notes_chars", [40, 600])
            t["notes"] = self._text(rng, lo, hi)
        if rng.random() < float(self.p.get("ai_summary_share", 0.4)):
            lo, hi = self.p.get("ai_summary_bytes", [1000, 5000])
            t["ai_details_summary"] = self._text(rng, lo, hi)
            t["ai_history_summary"] = self._text(rng, lo, hi)
        if rng.random() < float(self.p.get("schedule_share", 0.3)):
            t["schedule_product_models"] = json.dumps({str(k + 1): {"product": rng.choice(PRODUCTS),
                                                                   "model": f"MDL-{rng.randint(100, 999)}",
                                                                   "make": rng.choice(["Philips", "GE", "Mindray", "BPL", "Siemens"])}
                                                      for k in range(rng.randint(1, 4))})
        if rng.random() < float(self.p.get("corrigendum_share", 0.08)):
            t["is_corrigendum"] = True
            t["corrigendum_remark"] = self._text(rng, 60, 300)
        if rng.random() < float(self.p.get("product_names_share", 0.5)):
            t["product_name_as_per_tender"] = product
            t["product_name_as_per_marken"] = product + " (" + rng.choice(["Std", "Pro", "Plus"]) + ")"
        return t

    def _downloaded_docs(self, tid: str, rng, created: dt.datetime) -> list[dict]:
        lo, hi = self.p.get("downloaded_docs_entries", [2, 8])
        names = ["Bid Document", "Technical Bid", "Financial Bid Format", "BOQ", "Corrigendum",
                 "Annexure", "Terms and Conditions", "Pre-bid Minutes", "Schedule of Requirements"]
        docs = []
        for k in range(rng.randint(lo, hi)):
            nm = names[k % len(names)]
            fn = f"{nm.replace(' ', '_')}_{k + 1}.pdf"
            docs.append({"name": nm, "filename": fn, "local_path": f"/documents/{tid}/{fn}",
                         "created_date": fmt(created + dt.timedelta(minutes=k))})
        return docs

    @staticmethod
    def _add_spec_doc(t: dict, when: dt.datetime) -> None:
        docs = json.loads(t["downloaded_docs"] or "[]")
        docs.append({"name": "Technical Specification", "filename": "Combined_Technical_Data_Sheet.pdf",
                     "local_path": f"/documents/{t['id']}/Combined_Technical_Data_Sheet.pdf",
                     "created_date": fmt(when)})
        t["downloaded_docs"] = json.dumps(docs)

    # ---- approvals/comments
    def _appr(self, b: Bundle, stage: str, status: str, req_by: str, assigned: str, when: dt.datetime,
              reviewer: str | None = None, **extra) -> dict:
        row = {c: None for c in APPROVAL_COLUMNS}
        row.update({"tender_id": b.tender["id"], "stage": stage, "requested_by": req_by,
                    "assigned_to": assigned, "status": status, "created_at": fmt(when),
                    "updated_at": fmt(when + dt.timedelta(hours=2 if status != "PENDING" else 0))})
        if status != "PENDING":
            row["reviewed_by"] = reviewer
            row["reviewer_comment"] = f"{stage.replace('_', ' ').title()} reviewed and approved."
        row.update(extra)
        b.approvals.append(row)
        role_of = {"SPEC_CLEARANCE": "Clearance Team", "TPC_PRICING": "TPC Team"}.get(stage, "MIS Team")
        b.comments.append(self._comment(b, stage, req_by, "Tender Executive" if req_by.startswith("lt_exec") else "MIS Team",
                                        f"Requested {stage.replace('_', ' ').lower()} review.", when))
        if status != "PENDING" and reviewer:
            b.comments.append(self._comment(b, stage, reviewer, role_of, row["reviewer_comment"],
                                            when + dt.timedelta(hours=2)))
        return row

    @staticmethod
    def _comment(b: Bundle, stage, author, role, text, when) -> dict:
        return {"tender_id": b.tender["id"], "stage": stage, "author_username": author,
                "author_role": role, "comment_text": text, "created_at": fmt(when)}

    def _state(self, b: Bundle, step: int, name: str, when: dt.datetime, **kw) -> dict:
        s = {c: None for c in STATE_COLUMNS}
        s.update({"tender_id": b.tender["id"], "current_step": step, "step_name": name,
                  "assigned_executive": b.tender.get("mis_executive"), "assigned_at": b.tender.get("assigned_at"),
                  "spec_status": "NOT_STARTED", "bid_package_status": "NOT_STARTED", "emd_applicable": True,
                  "emd_status": "PENDING", "emd_receipt_confidential": True, "track_a_pricing_status": "NOT_STARTED",
                  "track_b_doc_status": "NOT_STARTED", "total_path_docs": 0, "verified_path_docs": 0,
                  "can_final_submit": False, "outcome_status": "PENDING",
                  "created_at": b.tender.get("assigned_at") or fmt(when), "updated_at": fmt(when)})
        s.update(kw)
        b.state = s
        return s

    # ---- category templates (each is a reconcile fixed point)
    def build(self, tid: str, category: str, rng: random.Random, assign: dict | None = None) -> Bundle:
        """`assign` pins usernames for fixtures: exec, mis, clear, tpc."""
        assign = assign or {}
        cat = category
        created = self._when(rng, 20, 90) if cat in ACTIVE else self._when(rng, 3, 365)
        t = self.base_tender(tid, rng, created, due_future=cat in ACTIVE)
        b = Bundle(tender=t, category=cat)
        exe = assign.get("exec") or (self._owner(rng) if cat != "new_unassigned" else None)
        mis = assign.get("mis") or self._pick(rng, "MIS Team", alias=None)
        clear = assign.get("clear") or self._pick(rng, "Clearance Team", alias="clearance")
        tpc_user = assign.get("tpc") or self._pick(rng, "TPC Team")
        assigner = self.users.first("MIS Team") if not assign else mis

        if cat == "new_unassigned":
            self._new_children(b, rng, created)
            return b
        if cat == "new_assigned":
            t["mis_executive"] = exe
            t["assigned_by"] = assigner
            t["assigned_at"] = fmt(created + dt.timedelta(hours=rng.uniform(1, 48)))
            if rng.random() < float(self.v.get("new_assigned_status_new_share", 0.2)):
                t["status"] = "New"
            self._new_children(b, rng, created)
            return b
        if cat == "not_participating":
            if rng.random() < 0.6:
                t["mis_executive"] = exe
                t["assigned_by"] = assigner
                t["assigned_at"] = fmt(created + dt.timedelta(hours=6))
            t["status"] = "Not Participating"
            b.history.append(self._hist(t, "Issued", "Not Participating", exe or assigner, created + dt.timedelta(days=1)))
            self._activity(b, rng, exe or assigner, "Tender Executive", created, n=1)
            return b

        # ---- everything below has entered the workflow
        t["status"] = "Participating"
        t["mis_executive"] = exe
        t["assigned_by"] = assigner
        assigned_at = created + dt.timedelta(hours=rng.uniform(2, 30))
        t["assigned_at"] = fmt(assigned_at)
        t["assigned_mis_member"] = mis
        b.history.append(self._hist(t, "Issued", "Participating", assigner, assigned_at))
        clock = assigned_at + dt.timedelta(days=rng.uniform(0.5, 2))
        order = list(ACTIVE) + list(TERMINAL)
        rank = order.index(cat)

        def reached(name: str) -> bool:
            return rank >= order.index(name)

        exempt = rng.random() < float(self.v.get("emd_exempt_share", 0.3))
        if cat == "payment_approval":
            exempt = False                            # a PAYMENT_APPROVAL tender always has EMD
        route_mis = rng.random() < float(self.v.get("pricing_route_mis_share", 0.25))
        tpc_price = round(t["estimated_cost"] * rng.uniform(0.55, 0.85), 2)
        mis_price = round(tpc_price * rng.uniform(1.08, 1.25), 2)

        # Step 2 — spec clearance
        t["current_stage"] = "SPEC_CLEARANCE"
        state_kw: dict = {}
        step, step_name = 2, "SPEC_CLEARANCE"
        if cat == "spec_upload_pending":
            self._state(b, step, step_name, clock)
            self._active_children(b, rng, exe, created)
            return b
        self._add_spec_doc(t, clock)
        t["spec_verification_status"] = "Generated"
        state_kw["spec_status"] = "DRAFT"
        if cat == "spec_generated":
            self._state(b, step, step_name, clock, **state_kw)
            b.activity.append(self._act(exe, "Tender Executive", "Uploaded Technical Specification & Generated Documents", t["id"], clock,
                                        "Uploaded specification.pdf and generated Technical Specification Sheet PDF, DOCX & XLSX outputs"))
            self._active_children(b, rng, exe, created)
            return b
        t["assigned_mis_member_spec"] = clear
        clock += dt.timedelta(hours=rng.uniform(2, 20))
        if cat == "spec_clearance_pending":
            # Rule 1 (ApprovalController.java:246-253) requires a PENDING SPEC_CLEARANCE for spec
            # "Pending"; loop 1 keeps it only while current_stage == SPEC_CLEARANCE (:170-178).
            t["spec_verification_status"] = "Pending"
            self._appr(b, "SPEC_CLEARANCE", "PENDING", exe, clear, clock)
            self._state(b, step, step_name, clock, spec_status="PENDING")
            self._active_children(b, rng, exe, created)
            return b
        self._appr(b, "SPEC_CLEARANCE", "APPROVED", exe, clear, clock,
                   reviewer=clear if clear.startswith("lt_") else self.users.first("Clearance Team"))
        t["spec_verification_status"] = "Approved"
        t["final_tech_spec_filename"] = "Combined_Technical_Data_Sheet.pdf"
        t["final_tech_spec_uploaded_by"] = clear
        t["final_tech_spec_uploaded_at"] = fmt(clock + dt.timedelta(hours=2))
        t["spec_compliance_type"] = rng.choice(["ALL_COMPLY", "ALL_COMPLY", "DEVIATIONS"])
        t["current_stage"] = "BID_DOCS_PREPARATION"
        state_kw.update(spec_status="APPROVED", spec_compliance_type=t["spec_compliance_type"],
                        final_tech_spec_filename=t["final_tech_spec_filename"],
                        final_tech_spec_uploaded_by=clear, final_tech_spec_uploaded_at=t["final_tech_spec_uploaded_at"])
        step, step_name = 3, "BID_DOCS_PREPARATION"
        clock += dt.timedelta(days=rng.uniform(0.5, 3))
        if cat == "bid_docs_preparation":
            self._state(b, step, step_name, clock, **state_kw)
            self._active_children(b, rng, exe, created)
            return b

        # Step 4 — EMD (bid package generated first, T5a/T5b)
        state_kw.update(bid_package_status="GENERATED", bid_package_generated_at=fmt(clock))
        b.activity.append(self._act(exe, "Tender Executive", "Generated Bid Documents", t["id"], clock,
                                    "Generated Word & PDF bid document package"))
        self._manifest(b, rng, clock)
        emd_member = mis
        if not exempt:
            t["assigned_mis_member_emd"] = emd_member
            t["emd_amount_actual"] = t["emd"]
            t["emd_payment_mode"] = rng.choice(["NEFT / RTGS", "DD", "BG"])
            t["emd_beneficiary_name"] = t["authority"][:120]
            t["emd_payment_ref"] = f"UTR{rng.randint(10**9, 10**10 - 1)}"
            t["emd_payment_date"] = fmt(clock)
            t["emd_receipt_doc_path"] = f"/documents/{t['id']}/confidential/emd_receipt_{int(clock.timestamp())}.pdf"
            state_kw.update(emd_beneficiary_name=t["emd_beneficiary_name"], emd_amount=t["emd_amount_actual"],
                            emd_payment_mode=t["emd_payment_mode"], emd_receipt_doc_path=t["emd_receipt_doc_path"])
            clock += dt.timedelta(hours=rng.uniform(2, 24))
            emd_fields = dict(emd_amount=t["emd_amount_actual"], transfer_mode=t["emd_payment_mode"],
                              transfer_ref_no=t["emd_beneficiary_name"], receipt_file_url=t["emd_receipt_doc_path"])
            if cat == "payment_approval":
                # Rule 2 (:256-274): payment "Pending" + PENDING row whose emd/mode/ref/receipt
                # fields are already filled (ensurePendingApproval only fills nulls, :124-129).
                t["current_stage"] = "PAYMENT_APPROVAL"
                t["payment_status"] = "Pending"
                self._appr(b, "PAYMENT_APPROVAL", "PENDING", exe, emd_member, clock, **emd_fields)
                self._state(b, 4, "EMD_PAYMENT", clock, **state_kw)
                self._active_children(b, rng, exe, created)
                return b
            self._appr(b, "PAYMENT_APPROVAL", "APPROVED", exe, emd_member, clock, reviewer=mis, **emd_fields)
            t["payment_status"] = "Approved"
            state_kw.update(emd_status="APPROVED", emd_approved_by=mis, emd_approved_at=fmt(clock + dt.timedelta(hours=2)))
        else:
            t["emd_applicable"] = False
            t["payment_status"] = "Approved"          # WorkflowSyncService.setEmdApplicability(false)
            state_kw.update(emd_applicable=False, emd_status="EXEMPT_SKIPPED")

        # Step 5 — dual track
        clock += dt.timedelta(hours=rng.uniform(2, 24))
        t["current_stage"] = "DUAL_TRACK"
        step, step_name = 5, "DUAL_TRACK"
        state_kw.update(track_b_doc_status="PENDING")
        doc_assignee = "MIS Team"                    # initiateDualTrack (WorkflowSyncService.java:451-456)
        if cat == "dual_track":
            # Rule 3 (:277-281): DUAL_TRACK with no prices needs a PENDING TPC_PRICING; route stays null.
            self._appr(b, "DOC_VERIFICATION", "PENDING", exe, doc_assignee, clock)
            self._appr(b, "TPC_PRICING", "PENDING", "clearance", "tpc", clock + dt.timedelta(minutes=1))
            self._state(b, step, step_name, clock, track_a_pricing_status="ROUTING_PENDING", **state_kw)
            self._active_children(b, rng, exe, created)
            return b
        doc_row = self._appr(b, "DOC_VERIFICATION", "PENDING", exe, doc_assignee, clock)
        # Track A
        clock += dt.timedelta(hours=rng.uniform(1, 12))
        if route_mis and cat != "tpc_pricing":
            t["pricing_route"] = "MIS"
            state_kw.update(pricing_route="MIS")
        else:
            t["pricing_route"] = "TPC"
            state_kw.update(pricing_route="TPC")
            alias_draw = rng.random() < float(self.v.get("team_alias_share", 0.25))
            tpc_assignee = assign.get("tpc") or ("TPC Team" if alias_draw else tpc_user)
            if cat == "tpc_pricing":
                t["current_stage"] = "TPC_PRICING"
                self._appr(b, "TPC_PRICING", "PENDING", exe, tpc_assignee, clock)
                self._state(b, step, step_name, clock, track_a_pricing_status="TPC_PENDING", **state_kw)
                self._active_children(b, rng, exe, created)
                return b
            self._appr(b, "TPC_PRICING", "APPROVED", exe, tpc_assignee, clock,
                       reviewer=tpc_user, tpc_purchase_price=tpc_price)
            t["tpc_purchase_price"] = tpc_price
            state_kw.update(tpc_purchase_price=tpc_price)
            clock += dt.timedelta(hours=rng.uniform(1, 12))
        if cat == "mis_pricing":
            # Rule 4 (:284-299): MIS_PRICING without MIS price needs a PENDING MIS_PRICING whose
            # assignee is a real MIS member (not an alias) and whose tpc price is filled.
            t["current_stage"] = "MIS_PRICING"
            self._appr(b, "MIS_PRICING", "PENDING", "tpc", mis, clock, tpc_purchase_price=t["tpc_purchase_price"])
            self._state(b, step, step_name, clock, track_a_pricing_status="MIS_PENDING", **state_kw)
            self._active_children(b, rng, exe, created)
            return b
        self._appr(b, "MIS_PRICING", "APPROVED", "tpc", mis, clock, reviewer=mis,
                   tpc_purchase_price=t["tpc_purchase_price"], mis_final_price=mis_price)
        t["mis_final_price"] = mis_price
        t["pricing_status"] = "Approved"
        t["pricing_go_ahead_by"] = mis
        t["pricing_go_ahead_at"] = fmt(clock + dt.timedelta(hours=1))
        state_kw.update(track_a_pricing_status="APPROVED", mis_final_price=mis_price,
                        pricing_go_ahead_by=mis, pricing_go_ahead_at=t["pricing_go_ahead_at"])
        clock += dt.timedelta(hours=rng.uniform(1, 12))
        if cat == "doc_verification":
            # Rule 5 (:302-316): stage DOC_VERIFICATION needs a PENDING DOC_VERIFICATION.
            # working_path stays NULL so a review does not walk an arbitrary directory (04 §5d).
            t["current_stage"] = "DOC_VERIFICATION"
            t["verification_status"] = "Pending"
            t["assigned_mis_member_docs"] = mis
            doc_row["assigned_to"] = mis
            self._state(b, step, step_name, clock, **state_kw)
            self._active_children(b, rng, exe, created)
            return b
        # Track B approved
        doc_row["status"] = "APPROVED"
        doc_row["reviewed_by"] = mis
        doc_row["reviewer_comment"] = "Documents verified."
        doc_row["updated_at"] = fmt(clock)
        b.comments.append(self._comment(b, "DOC_VERIFICATION", mis, "MIS Team", "Documents verified.", clock))
        t["verification_status"] = "Approved"
        t["can_final_submit"] = True
        t["current_stage"] = "SUBMISSION_READY"
        state_kw.update(track_b_doc_status="APPROVED", docs_verified_by=mis, docs_verified_at=fmt(clock),
                        can_final_submit=True)
        step, step_name = 6, "SUBMISSION_READY"
        if cat == "submission_ready":
            self._state(b, step, step_name, clock, **state_kw)
            self._active_children(b, rng, exe, created)
            return b
        clock += dt.timedelta(hours=rng.uniform(2, 48))
        sub_member = mis
        t["assigned_mis_member_submission"] = sub_member
        if cat == "submission_pending":
            # Rule 6 (:319-329)
            t["current_stage"] = "SUBMISSION_PENDING"
            t["submission_status"] = "Pending"
            self._appr(b, "SUBMISSION_PENDING", "PENDING", exe, sub_member, clock)
            self._state(b, step, step_name, clock, **state_kw)
            self._active_children(b, rng, exe, created)
            return b
        if rng.random() < 0.5:
            self._appr(b, "SUBMISSION_PENDING", "APPROVED", exe, sub_member, clock, reviewer=mis)
        t["submission_status"] = "Approved"
        t["status"] = "Submitted"
        b.history.append(self._hist(t, "Participating", "Submitted", exe, clock))
        state_kw.update(submitted_by=exe, submitted_at=fmt(clock))
        step, step_name = 7, "SUBMITTED"
        clock += dt.timedelta(days=rng.uniform(5, 40))
        t["current_stage"] = "WIN_LOSS_PENDING"
        if cat == "win_loss_pending":
            # Rule 7 (:332-346): outcome "Pending" needs a PENDING WIN_LOSS_PENDING; loss_reason NULL.
            t["outcome_status"] = "Pending"
            self._appr(b, "WIN_LOSS_PENDING", "PENDING", exe, sub_member, clock)
            self._state(b, step, step_name, clock, outcome_status="PENDING", **state_kw)
            self._active_children(b, rng, exe, created)
            return b
        won = cat == "won"
        extra = {} if won else {"loss_reason_mis": "L1 price lower than quoted price."}
        self._appr(b, "WIN_LOSS_PENDING", "APPROVED", exe, sub_member, clock, reviewer=mis, **extra)
        t["outcome_status"] = "Won" if won else "Lost"
        t["status"] = "Won" if won else "Lost"
        t["current_stage"] = "WON" if won else "LOST"
        if not won:
            t["loss_reason"] = "Lost on price (L2)."
        b.history.append(self._hist(t, "Submitted", t["status"], mis, clock))
        self._state(b, 7, "OUTCOME_WON" if won else "OUTCOME_LOST", clock,
                    outcome_status="WON" if won else "LOST", loss_reason=t["loss_reason"], **state_kw)
        self._active_children(b, rng, exe, created)
        return b

    # ---- children
    def _hist(self, t, frm, to, by, when) -> dict:
        return {"tender_id": t["id"], "from_status": frm, "to_status": to, "changed_by": by, "changed_at": fmt(when)}

    def _act(self, user, role, action, tid, when, details) -> dict:
        return {"username": user, "role": role, "action": action, "tender_id": tid,
                "timestamp": fmt(when), "details": details[:255]}

    def _activity(self, b: Bundle, rng, user, role, created, n: int):
        for k in range(n):
            b.activity.append(self._act(user, role, "Updated Tender", b.tender["id"],
                                        created + dt.timedelta(hours=k + rng.uniform(0, 10)),
                                        rng.choice(["status: Issued -> Participating", "notes updated",
                                                    "mis_executive assigned", "due_date corrected"])))

    def _new_children(self, b: Bundle, rng, created):
        if rng.random() < float(self.c.get("activity_log_new_share", 0.15)):
            self._activity(b, rng, b.tender.get("mis_executive") or self.users.first("MIS Team"),
                           "MIS Team", created, n=1)

    def _active_children(self, b: Bundle, rng, exe, created):
        lo, hi = self.c.get("activity_log", [3, 8])
        need = max(0, rng.randint(lo, hi) - len(b.activity))
        self._activity(b, rng, exe or self.users.first("MIS Team"), "Tender Executive", created, need)
        wlo, whi = self.c.get("workflow_comments", [0, 5])
        for k in range(rng.randint(wlo, whi)):
            author = rng.choice([exe or self.users.first("MIS Team"), self.users.first("MIS Team")])
            b.wcomments.append({"tender_id": b.tender["id"], "phase": rng.choice(["SPEC", "BID", "EMD", "PRICING", "GENERAL"]),
                                "author": author, "author_role": "Tender Executive" if author.startswith("lt_exec") else "MIS Team",
                                "comment": self._text(rng, 20, 240),
                                "created_at": fmt(created + dt.timedelta(days=k + 1, hours=rng.uniform(0, 8)))})

    def _manifest(self, b: Bundle, rng, when):
        lo, hi = self.c.get("manifest_files", [3, 10])
        cats = ["ORIGINAL_NOTICE", "FINAL_TECH_SPEC", "BID_PACKAGE", "QUOTATION", "OTHER"]
        for k in range(rng.randint(lo, hi)):
            fn = f"file_{k + 1}.pdf" if k else "Combined_Technical_Data_Sheet.pdf"
            b.manifest.append({"tender_id": b.tender["id"], "file_name": fn, "display_name": fn,
                               "relative_path": f"{b.tender['id']}/{fn}", "file_category": cats[k % len(cats)],
                               "file_size_bytes": rng.randint(20_000, 4_000_000), "file_extension": "pdf",
                               "is_confidential": False, "is_authoritative": k == 0, "verified_by_mis": False,
                               "verified_by_user": None, "verified_at": None, "created_at": fmt(when)})


from .schema import TABLES as _TABLES  # noqa: E402

TENDER_COLUMNS = [c for c, _ in _TABLES["tenders"]]
APPROVAL_COLUMNS = [c for c, _ in _TABLES["tender_approval_requests"]]
STATE_COLUMNS = [c for c, _ in _TABLES["tender_workflow_states"]]


# --------------------------------------------------------------------------- fixtures
FIXTURE_KIND_CATEGORY = {
    "spec_generated": "spec_generated", "bid_docs_preparation": "bid_docs_preparation",
    "dual_track": "dual_track", "upload": "spec_upload_pending", "bidpack": "bid_docs_preparation",
    "spec_clearance_pending": "spec_clearance_pending", "tpc_pricing": "tpc_pricing",
    "payment_approval": "payment_approval", "mis_pricing": "mis_pricing",
    "doc_verification": "doc_verification", "submission_pending": "submission_pending",
    "win_loss_pending": "win_loss_pending",
}
KIND_CODE = {"spec_generated": "SG", "bid_docs_preparation": "BD", "dual_track": "DT", "upload": "UP",
             "bidpack": "BP", "spec_clearance_pending": "SC", "tpc_pricing": "TP", "payment_approval": "PA",
             "mis_pricing": "MP", "doc_verification": "DV", "submission_pending": "SP", "win_loss_pending": "WL"}
ROLE_ASSIGN_KEY = {"Tender Executive": "exec", "MIS Team": "mis", "Clearance Team": "clear", "TPC Team": "tpc"}


def fixture_plan(seed_cfg: dict, users: Users) -> list[tuple[str, str, dict, str, str]]:
    """Return [(tender_id, category, assign, owner_username, kind)] for the fixture block."""
    fx = seed_cfg["fixtures"]
    pre, probe_pre = fx["id_prefix"], fx["probe_prefix"]
    plan = []
    for role, kinds in fx["per_user"].items():
        for uname in users.by_role[role]:
            ucode = uname.split("_", 1)[1].replace("_", "").upper()   # lt_exec_03 -> EXEC03
            for kind, count in kinds.items():
                for n in range(int(count)):
                    tid = f"{pre}{ucode}-{KIND_CODE[kind]}-{n + 1:03d}"
                    assign = {ROLE_ASSIGN_KEY[role]: uname}
                    if role != "Tender Executive":
                        assign["exec"] = users.by_role["Tender Executive"][n % len(users.by_role["Tender Executive"])]
                    plan.append((tid, FIXTURE_KIND_CATEGORY[kind], assign, uname, kind))
    pr = fx.get("probe", {})
    for n in range(int(pr.get("double_approval", 0))):
        plan.append((f"{probe_pre}DA-{n + 1:03d}", "payment_approval",
                     {"exec": users.by_role["Tender Executive"][0], "mis": "misteam"}, "probe", "double_approval"))
    for n in range(int(pr.get("dual_track_race", 0))):
        plan.append((f"{probe_pre}DR-{n + 1:03d}", "mis_pricing_race",
                     {"exec": users.by_role["Tender Executive"][0], "mis": users.by_role["MIS Team"][0]},
                     "probe", "dual_track_race"))
    return plan


def build_fixture(factory: Factory, seed: int, tid: str, category: str, assign: dict) -> Bundle:
    rng = random.Random(f"{seed}:f:{tid}")
    if category == "mis_pricing_race":
        # MIS_PRICING pending + DOC_VERIFICATION pending on one tender (04 §4b dual-track race).
        # Force the TPC route so the DOC row is pending (not approved) and pricing pending.
        for attempt in range(50):
            b = factory.build(tid, "mis_pricing", random.Random(f"{seed}:f:{tid}:{attempt}"), assign)
            if any(a["stage"] == "DOC_VERIFICATION" and a["status"] == "PENDING" for a in b.approvals):
                b.category = "mis_pricing_race"
                return b
        raise RuntimeError("could not build dual-track race fixture")
    if category == "payment_approval" and assign.get("mis") == "misteam":
        b = factory.build(tid, category, rng, {k: v for k, v in assign.items() if k != "mis"})
        for a in b.approvals:
            if a["stage"] == "PAYMENT_APPROVAL" and a["status"] == "PENDING":
                a["assigned_to"] = "misteam"
        b.tender["assigned_mis_member_emd"] = "misteam"
        return b
    return factory.build(tid, category, rng, assign)
