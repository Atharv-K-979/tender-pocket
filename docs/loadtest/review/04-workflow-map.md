# 04 — Tender Workflow Map, Concurrency, and Approval Request Path

Commit `68eb28ae`. Path prefixes as in `02-service-inventory.md`, all under `backend/src/main/java/com/tenderpocket/`.
Labels: VERIFIED, INFERRED, UNKNOWN.

## 1. How many stages are there?

The task brief says 8 stages, and so does README.md:58. **The code has no single 8-stage model.** Four overlapping representations exist (VERIFIED):

| Representation | Where | Count |
|---|---|---|
| `TenderWorkflowStage` enum | `models/TenderWorkflowStage.java:3-20` | **16 constants**: EXECUTIVE_ASSIGNMENT, SPEC_CLEARANCE, BID_DOCS_PREPARATION, BID_DOC_GENERATED, PAYMENT_APPROVAL, DUAL_TRACK, TPC_PRICING, MIS_PRICING, DOC_VERIFICATION, SUBMISSION_READY, SUBMISSION_PENDING, SUBMITTED, WIN_LOSS_PENDING, WON, LOST, UNABLE_TO_SUBMIT |
| `tenders.current_stage` (free `String`, default `"NEW"`) | `models/Tender.java:167-168` | **16 distinct values written by code**: NEW, SPEC_CLEARANCE, BID_DOCS_PREPARATION, EMD_PAYMENT, PAYMENT_APPROVAL, DUAL_TRACK, TPC_PRICING, MIS_PRICING, DOC_VERIFICATION, BID_DOC_PENDING, SUBMISSION_READY, SUBMISSION_PENDING, WIN_LOSS_PENDING, WON, LOST, UNABLE_TO_SUBMIT. Any other string can also be written through PATCH (§3, T16) |
| `tender_workflow_states.current_step` / `step_name` ("v2" model) | `models/TenderWorkflowState.java:22-26`; steps assigned in `services/WorkflowSyncService.java` | **7 numbered steps** with 9 step names: 1 EXECUTIVE_ASSIGNMENT, 2 SPEC_CLEARANCE, 3 BID_DOCS_PREPARATION, 4 EMD_PAYMENT, 5 DUAL_TRACK, 6 SUBMISSION_READY, 7 SUBMITTED / OUTCOME_WON / OUTCOME_LOST |
| Approval-request stages (rows in `tender_approval_requests`) | `models/TenderApprovalRequest.java:17-19`; `config/WorkflowPermissions.java:63-75` | **7 reviewable** (SPEC_CLEARANCE, PAYMENT_APPROVAL, TPC_PRICING, MIS_PRICING, DOC_VERIFICATION, SUBMISSION_PENDING, WIN_LOSS_PENDING) plus one non-reviewable record (UNABLE_TO_SUBMIT, `controllers/WorkflowController.java:1190`) |

Mismatches between the representations (VERIFIED):
- Enum constants **never written** to `current_stage`: EXECUTIVE_ASSIGNMENT, BID_DOC_GENERATED, SUBMITTED.
- `current_stage` values **not in the enum**: NEW (`models/Tender.java:168`), EMD_PAYMENT (`controllers/TenderController.java:1695`), BID_DOC_PENDING (`controllers/ApprovalController.java:995`, `controllers/WorkflowController.java:1128`).
- Values **read but never written** by any code path: SPEC_GENERATION_PENDING, EMD_PENDING, DUAL_TRACK_ACTIVE (`controllers/ApprovalController.java:809-815`), REJECTED_TPC (`controllers/TenderController.java:335`), TECH_SPEC_PENDING (`:839`), INTAKE (`:1077`), SUBMITTED (`controllers/ApprovalController.java:814`).
- `current_stage` (on `tenders`) and `current_step` (on `tender_workflow_states`) are updated by different endpoints and can disagree. Example: `assign-executive` sets step 2 but leaves `current_stage` unchanged (`services/WorkflowSyncService.java:143-165`); `generate-bid-docs` changes `current_stage` but never touches the state row (`controllers/TenderController.java:1688-1696`).

### Other status fields on `tenders` (VERIFIED defaults; values from setters)

| Field | Default | Values written by code |
|---|---|---|
| `status` | `Issued` (`models/Tender.java:81`) | Participating, Submitted, Won, Lost, Awarded, Not Awarded, Missed Opportunity, New, plus anything sent through PATCH/POST that passes `allowedPatch` |
| `spec_verification_status` | `None` (`:225`) | Generated (`controllers/TenderController.java:2100`), Pending (`controllers/WorkflowController.java:147`), Approved |
| `payment_status` | `None` (`:213`) | Pending, Approved, Rejected, Exempt |
| `verification_status` | `None` (`:216`) | Approved, Rejected (+ Pending via PATCH by an Executive) |
| `submission_status` | `None` (`:219`) | Approved, Rejected (+ Pending via PATCH) |
| `outcome_status` | `None` (`:222`) | Pending, Won, Lost |
| `pricing_status` | `None` (`:252`) | Approved (`services/WorkflowSyncService.java:636`) |
| Display status (computed, not stored) | — | `services/TenderStatusResolver.java:73-110`: Won, Lost, Submitted, Missed Opportunity, Missed Deadline, Not Participating, Participating, Lapsed, New, else the stored value |
| `tender_approval_requests.status` | — | PENDING, APPROVED, REJECTED, CHANGES_REQUESTED, SUBMITTED (`models/TenderApprovalRequest.java:28`; `controllers/WorkflowController.java:1190`) |

## 2. Intended main path

This is the order implemented by `WorkflowSyncService` and enforced by the gates in `WorkflowController`. VERIFIED.

```
NEW ──(assign exec / Participating)──► SPEC_CLEARANCE ──(Clearance approves)──► BID_DOCS_PREPARATION
   ──(Exec generates bid package)──► EMD_PAYMENT | PAYMENT_APPROVAL ──(MIS approves EMD)──► DUAL_TRACK
   DUAL_TRACK ─┬─ Track A: route-pricing → TPC_PRICING ─(TPC price)→ MIS_PRICING ─(MIS price)→ trackA=APPROVED
               └─ Track B: DOC_VERIFICATION request ─(MIS verifies docs)→ trackB=APPROVED
   both approved ──► SUBMISSION_READY ──(Exec final-submission)──► WIN_LOSS_PENDING ──(MIS records)──► WON | LOST
   any stage ──(MIS unable-to-submit)──► UNABLE_TO_SUBMIT
```

The README order (spec → TPC → MIS → docs → verification → EMD → submission → outcome) **does not match** this. See Doc conflicts.

## 3. Transition table (`tenders.current_stage`)

"Roles" are the effective roles after the checks listed in `03-rbac-matrix.md`. "Side effects" lists DB rows written, files touched, and external calls. **None of the workflow transitions sends email or calls an external API.** VERIFIED: the only email trigger is `controllers/TenderController.java:277`, plus the schedulers. Workflow endpoints write `tender_comments` rows rather than `activity_log`. Only PATCH, the document-generation endpoints, user management and tender delete write `activity_log`.

| # | From → To | Trigger (file:line) | Role(s) | Validations (VERIFIED) | Side effects |
|---|---|---|---|---|---|
| T1a | NEW / null / INTAKE → SPEC_CLEARANCE | `PATCH /api/tenders/{id}` with `status=Participating` (`controllers/TenderController.java:1076-1080`) or with `mis_executive` set while status is Issued/New/Lapsed (`:1303-1308`) | MIS Team (`config/WorkflowPermissions.java:156, 203`) | `Participating` requires an executive (`controllers/TenderController.java:1043-1057`) | W tenders (full row), `status_history` (`:1107`), `activity_log` (`:1585-1590`). **No approval row is created** |
| T1b | (step 1 → 2 only) | `POST /api/v2/workflow/{id}/assign-executive` (`controllers/WorkflowSyncController.java:165`) → `services/WorkflowSyncService.java:143-165` | MIS Team | executive name non-empty | W tenders (`mis_executive`, status → Participating); W/INSERT state (step 2). **`current_stage` is not changed** |
| T2 | (no stage change) spec_verification_status → Generated | `POST /api/tenders/{id}/upload-tech-spec` (`controllers/TenderController.java:1800`) | Tender Executive | spec status not Approved (`:1842`); file type and magic bytes (`:1864-1919`) | **AI + OCR**, PDF/DOCX/XLSX render, file/S3 writes, W tenders, `activity_log`. Creates the tender row if it is missing (`:1829-1839`) |
| T3 | **any** → SPEC_CLEARANCE | `POST /api/tenders/{id}/clearance-request` (`controllers/WorkflowController.java:116`) | Tender Executive | spec status ∈ {Generated, Rejected, Pending, **Approved**} and `downloaded_docs` non-empty (`:140-145`). **No current-stage check**, so a tender that has moved on can be sent back | W tenders (spec Pending, `assigned_mis_member_spec`), upsert of a PENDING SPEC_CLEARANCE approval (`:153-174`), W `tender_comments` |
| T4a | SPEC_CLEARANCE → BID_DOCS_PREPARATION | `POST /api/tenders/{id}/approve-clearance` (JSON `:222` / multipart `:233`) | Clearance Team (assigned rep or queue `:271-279`) | spec status = Pending (`:265`); file extensions (`:478-498`) | Optional file writes to 6 directories (`:183-219`); W tenders; `recordFinalTechSpec` (`services/WorkflowSyncService.java:171-222`): state step 3, approvals → APPROVED, **disk scan + manifest upserts** (`:208`), 2 comments |
| T4b | SPEC_CLEARANCE (also SPEC_GENERATION_PENDING / EXECUTIVE_ASSIGNMENT) → BID_DOCS_PREPARATION | `POST /api/approvals/{id}/review` APPROVED (`controllers/ApprovalController.java:897-923`) or `POST /api/tenders/{id}/review-approval` (`controllers/WorkflowController.java:1071-1081`) | Clearance Team | stage match (`controllers/ApprovalController.java:813`); reject is refused (`:823-825`); **does not check that spec status is Pending** | Same as T4a minus the file uploads |
| T4c | **any** → BID_DOCS_PREPARATION | `POST /api/v2/workflow/{id}/spec-clearance` (`controllers/WorkflowSyncController.java:196`) | Clearance Team | **none** (no Pending or stage check) | File writes to 6 directories, W tenders, `recordFinalTechSpec` as above |
| T4d | **any** → BID_DOCS_PREPARATION | PATCH `spec_verification_status=Approved` (`controllers/TenderController.java:1490-1509`) | Clearance Team (`config/WorkflowPermissions.java:182-187`) + assignee check (`controllers/TenderController.java:1492-1498`) | none on stage | W tenders only. **SPEC_CLEARANCE approval rows stay PENDING** until the next reconcile marks them stale |
| T5a | (any; intended BID_DOCS_PREPARATION) → EMD_PAYMENT, or DUAL_TRACK when EMD is exempt or already Approved | `POST /api/tenders/{id}/generate-bid-docs` (`controllers/TenderController.java:1632`, stage set `:1688-1696`) | Tender Executive | spec docs present (`:1657`); spec Approved (`:1663`). No current-stage check | **PDF + DOCX generation**, file/S3 writes, W tenders, `activity_log`. **Creates no approval rows and does not touch the state row**, so a DUAL_TRACK reached this way has no DOC_VERIFICATION request until reconcile adds a TPC_PRICING one (`controllers/ApprovalController.java:277`). INFERRED |
| T5b | any → PAYMENT_APPROVAL, or DUAL_TRACK when exempt | `POST /api/v2/workflow/{id}/bid-docs-prep` (`controllers/WorkflowSyncController.java:389`) → `services/WorkflowSyncService.java:241-298` | Tender Executive | none | W tenders (`working_path` = **client-supplied path**), state step 4 or 5, **disk walk of that path** (`:253`), `initiateDualTrack` if exempt, comment |
| T6 | any → DUAL_TRACK (not applicable) / PAYMENT_APPROVAL (applicable) | `POST /api/v2/workflow/{id}/emd-applicability` (`controllers/WorkflowSyncController.java:415`) → `services/WorkflowSyncService.java:304-341` | Tender Executive | none | W tenders (payment status Approved or None), state, `initiateDualTrack` when exempt, comment |
| T7a | any → PAYMENT_APPROVAL | `POST /api/v2/workflow/{id}/emd-payment` (`controllers/WorkflowSyncController.java:447`) → `services/WorkflowSyncService.java:347-393` | Tender Executive | none | Receipt written to `public/documents/{id}/confidential/` (`controllers/WorkflowSyncController.java:463-468`); W tenders (payment Pending); upsert of a PAYMENT_APPROVAL approval assigned to `misteam`; disk scan; comment |
| T7b | any → PAYMENT_APPROVAL | `POST /api/tenders/{id}/payment-request` (`controllers/WorkflowController.java:666`) | MIS Team | `verification_status = Approved` (`:691`) — the legacy order (docs before payment) | W tenders, PAYMENT_APPROVAL approval upsert, comment |
| T8 | PAYMENT_APPROVAL / BID_DOCS_PREPARATION / EMD_PENDING / EMD_PAYMENT → DUAL_TRACK | Approve PAYMENT_APPROVAL via `controllers/ApprovalController.java:846-853` or `controllers/WorkflowController.java:1004-1011` → `services/WorkflowSyncService.java:399-434` | MIS Team (queue/assignee) | stage match (`controllers/ApprovalController.java:812`) | W tenders (payment Approved), state step 5, approvals → APPROVED, **`initiateDualTrack`** (`services/WorkflowSyncService.java:440-476`): creates a DOC_VERIFICATION request (assigned `MIS Team`) and routes Track A by `pricing_route`; comment. Reject → payment Rejected, no stage change |
| T9a | any → TPC_PRICING | `POST /api/v2/workflow/{id}/route-pricing` `route=TPC` (`controllers/WorkflowSyncController.java:569-571`) → `services/WorkflowSyncService.java:482-514` | Tender Executive, MIS Team, Admin | none | W tenders, state (TPC_PENDING); **deletes PENDING MIS_PRICING rows**; creates a TPC_PRICING request (`TPC Team`); comment |
| T9b | any → MIS_PRICING | `route=MIS` (`controllers/WorkflowSyncController.java:572-578`) → `services/WorkflowSyncService.java:520-555` | Tender Executive, MIS Team, Admin | none | **Deletes every TPC_PRICING row for the tender, including history** (`:537-540`); creates a MIS_PRICING request; comment |
| T10a | TPC_PRICING / DUAL_TRACK / DUAL_TRACK_ACTIVE / DOC_VERIFICATION / BID_DOC_PENDING → MIS_PRICING | Approve TPC_PRICING via `controllers/ApprovalController.java:924-972` → `services/WorkflowSyncService.java:561-622` | TPC (queue) | stage match (`controllers/ApprovalController.java:811`) | W tenders (TPC price, assignee), state (MIS_PENDING), TPC approvals → APPROVED, MIS_PRICING request upsert, comment |
| T10b | same → MIS_PRICING | `controllers/WorkflowController.java:1082-1109` (review-approval) | TPC | same | W tenders, creates a MIS_PRICING request. **Does not call `recordTpcPricing`, so the state row is not updated** |
| T10c | any (spec Approved, EMD settled) → MIS_PRICING | `POST /api/tenders/{id}/tpc-price` (`controllers/WorkflowController.java:511`) | Admin, TPC, MIS | spec Approved (`:526`), EMD settled (`:530`) | The controller keeps DUAL_TRACK (`:543-545`), but `recordTpcPricing` then sets MIS_PRICING unconditionally (`services/WorkflowSyncService.java:573`) on the same managed entity, so the final stage is MIS_PRICING. INFERRED |
| T11a | MIS_PRICING and others → SUBMISSION_READY when Track B is already APPROVED; otherwise unchanged | Approve MIS_PRICING via `controllers/ApprovalController.java:973-1014` or `controllers/WorkflowController.java:1110-1131` → `services/WorkflowSyncService.java:628-664`, barrier `:760-786` | MIS Team | stage match (`controllers/ApprovalController.java:810`) | W tenders (MIS price, pricing Approved), state trackA APPROVED, MIS approvals → APPROVED, pending TPC → APPROVED (`controllers/ApprovalController.java:999-1013`), comment |
| T11b | MIS_PRICING / TPC_PRICING / EMD_PAYMENT / PAYMENT_APPROVAL / null → DUAL_TRACK, then possibly SUBMISSION_READY | `POST /api/tenders/{id}/mis-price` (`controllers/WorkflowController.java:601`), **not transactional** | MIS Team | spec Approved, EMD settled (`:615-622`) | As T11a. The tender save and `approveTrackAPricing` run in separate transactions |
| T11c | any → (SUBMISSION_READY when Track B is done) | `POST /api/v2/workflow/{id}/commercial-go-ahead` (`controllers/WorkflowSyncController.java:595`) | MIS Team | price > 0 | As T11a |
| T12a | any (spec Approved, EMD settled) → DOC_VERIFICATION | `POST /api/tenders/{id}/doc-verification-request` (`controllers/WorkflowController.java:736`) | Tender Executive | `:753-760` | **Overwrites TPC_PRICING / MIS_PRICING stage values**; sets `working_path` to a client string; DOC_VERIFICATION approval upsert; comment |
| T12b | DOC_VERIFICATION / BID_DOC_PENDING / DUAL_TRACK / DUAL_TRACK_ACTIVE / TPC_PRICING / MIS_PRICING → SUBMISSION_READY when Track A is done; otherwise unchanged | Approve DOC_VERIFICATION via `controllers/ApprovalController.java:830-845` or `controllers/WorkflowController.java:1012-1027` → `services/WorkflowSyncService.java:670-707`; or `POST /api/v2/workflow/{id}/verify-all-documents` (`controllers/WorkflowSyncController.java:504`) | MIS Team | stage match (`controllers/ApprovalController.java:809`) | W tenders (verification Approved); **disk walk of `{uploadDir}/{id}` and `working_path` + one manifest save per file, twice** (`services/TenderFolderScannerService.java:65-153, 181-190`); state trackB APPROVED; approvals; comment; barrier |
| T12c | (no stage change) Track B → CHANGES_REQUESTED | Reject or request changes on DOC_VERIFICATION (`controllers/ApprovalController.java:1023-1029`), or `POST /api/v2/workflow/{id}/reject-documents` (`controllers/WorkflowSyncController.java:527`) → `services/WorkflowSyncService.java:714-754` | MIS Team | — | W tenders (verification Rejected, `can_final_submit` false), state, approval CHANGES_REQUESTED, comment |
| T13a | SUBMISSION_READY (`can_final_submit` true on the state row) → WIN_LOSS_PENDING | `POST /api/v2/workflow/{id}/final-submission` (`controllers/WorkflowSyncController.java:624`) → `services/WorkflowSyncService.java:792-823` | Tender Executive (any tender) | `state.canFinalSubmit` (`controllers/WorkflowSyncController.java:634`) | W tenders (status Submitted, submission Approved), state step 7, WIN_LOSS_PENDING request (`misteam`), comment |
| T13b | any (payment Approved) → SUBMISSION_PENDING | `POST /api/tenders/{id}/submission-request` (`controllers/WorkflowController.java:803`) | MIS Team | payment Approved (`:816`) | SUBMISSION_PENDING approval upsert, comment |
| T13c | SUBMISSION_READY / SUBMISSION_PENDING / SUBMITTED → WIN_LOSS_PENDING | Approve SUBMISSION_PENDING (`controllers/ApprovalController.java:854-874`, `controllers/WorkflowController.java:1028-1048`) | MIS Team | stage match (`controllers/ApprovalController.java:814`) | W tenders (status Submitted, outcome Pending), WIN_LOSS_PENDING request if none, comment. Reject → submission Rejected |
| T14a | WIN_LOSS_PENDING / SUBMITTED / SUBMISSION_READY → WON or LOST | Approve WIN_LOSS_PENDING (`controllers/ApprovalController.java:875-896`, `controllers/WorkflowController.java:1049-1070`) → `services/WorkflowSyncService.java:829-863` | MIS Team | stage match (`controllers/ApprovalController.java:815`); outcome from `body.outcome`, otherwise inferred from the presence of a loss reason (`:877-881`) | W tenders (status Won or Lost), state, approvals, comment |
| T14b | **any** → WIN_LOSS_PENDING | `POST /api/tenders/{id}/win-loss-request` (`controllers/WorkflowController.java:857`) | MIS Team | **none** | W tenders (outcome Pending), approval upsert, comment |
| T14c | **any** → WON / LOST | PATCH `status` ∈ {Won, Awarded} / {Lost, Not Awarded} (`controllers/TenderController.java:1081-1103`) | MIS Team (`config/WorkflowPermissions.java:202`) | none | W tenders, WIN_LOSS approvals → APPROVED, `status_history`, `activity_log`. **The state row is not updated** |
| T15 | **any** → UNABLE_TO_SUBMIT | `POST /api/tenders/{id}/unable-to-submit` (`controllers/WorkflowController.java:1172`), not transactional | MIS Team | none | W tenders (status Missed Opportunity); approval row inserted with status `SUBMITTED`; comment |
| T16 | **any → any string** | PATCH `current_stage` (`controllers/TenderController.java:1511-1517`, repeated at `:1545-1551`) | Any non-Admin role, restricted only for WON/LOST/WIN_LOSS_PENDING (MIS), DOC_VERIFICATION (Exec/MIS), TPC_PRICING (Clearance/Exec/MIS), MIS_PRICING (TPC/MIS/Exec), PAYMENT_APPROVAL (MIS/Exec) (`config/WorkflowPermissions.java:190-197`). **SUBMISSION_READY, NEW, DUAL_TRACK, BID_DOCS_PREPARATION, etc. are unrestricted** | none | W tenders only. Approvals and the state row are not touched |
| R | Reconcile side-transitions (run on every `GET /api/approvals/counts` and `/pending`) | `controllers/ApprovalController.java:141-352` | (anyone allowed into the Approvals Center) | — | Deletes duplicate or premature PENDING approvals (`:162, :176`); marks stale ones APPROVED (`:218-221`); re-assigns (`:222-231`); **sets `payment_status=Pending` and saves the full tender** (`:258-261`); **clears `assigned_mis_member` and saves the full tender** (`:285-288`); creates missing PENDING approvals for 7 stage rules (`:245-347`) |

## 4. Concurrency

### 4a. Inventory of concurrency controls (VERIFIED by grep over `backend/src/main/java`)

| Mechanism | Present? | Where |
|---|---|---|
| `@Version` (optimistic locking) | **No** | — |
| `@Lock` / `LockModeType` / `SELECT … FOR UPDATE` | **No** | — |
| `@DynamicUpdate` | **No**, so Hibernate updates every column on save (INFERRED, Hibernate default) | — |
| Unique constraints that serialise workflow | Only `tender_workflow_states.tender_id` (`models/TenderWorkflowState.java:19`, `unique = true`) and PKs. **None on `tender_approval_requests` (tender_id, stage, status)** | — |
| `@Transactional` | Default propagation REQUIRED, default isolation (PostgreSQL default READ COMMITTED; INFERRED). No `isolation=` or `propagation=` anywhere | `controllers/ApprovalController.java:140` (**not applied: self-invocation**, see 4c), `:667`; `controllers/WorkflowController.java:117, 223, 234, 512, 667, 737, 804, 858, 916`; every public method of `services/WorkflowSyncService.java` except `handOffClearedSpecToExecutive` (`:45, 142, 170, 240, 303, 346, 398, 439, 481, 519, 560, 627, 669, 713, 759, 791, 828`); `services/ProductCatalogueService.java:69, 183, 213, 242, 249` |
| Handlers that write without a transaction | — | **All of `TenderController`** (including PATCH `:877`), `controllers/WorkflowController.java:601` (mis-price), `:1172` (unable-to-submit), all of `WorkflowSyncController` (each service call is its own transaction), `AuthController` |
| `synchronized` | Yes, but none of these guard tender or approval state | `services/ComplianceProgressService.java:61, 77, 132, 153` (in-memory progress); `services/PostgresBackupService.java:45, 251`; `services/AISpecificationIntelligenceService.java:761` (**a JVM-wide `PACE_LOCK` with a ≥4 s gap, applied only on the Gemini fallback path** `:1136`); `services/GeMScraperService.java:675`; `services/DocumentGeneratorService.java:1946-2017` (progress lock) |
| Request-level idempotency / dedupe | Check-then-insert only (`ensurePendingApproval` `controllers/ApprovalController.java:112-123`; "patch existing pending" loops in WorkflowController) | not atomic |

### 4b. What happens when two users act on the same tender at the same time

| Scenario | Outcome | Label |
|---|---|---|
| **Two MIS users approve the same approval id** (`POST /api/approvals/{id}/review`) | Both transactions read `status=PENDING` (`controllers/ApprovalController.java:737`) before either commits, so both pass. Both run the stage transition, both write `status=APPROVED`, both add a `tender_comments` row. **No exception is raised; the stage is applied twice.** For PAYMENT_APPROVAL, both call `initiateDualTrack`, and each sees no committed DOC_VERIFICATION or TPC/MIS request, so **duplicate PENDING requests** are inserted (`services/WorkflowSyncService.java:452-457, 504-509, 545-550`). For SUBMISSION_PENDING, duplicate WIN_LOSS_PENDING requests appear (`controllers/ApprovalController.java:859-873`). Duplicates are deleted later by reconcile (`:160-163`). Response: both callers get 200 | INFERRED |
| **Track A (MIS price) and Track B (doc verification) approved concurrently.** The design invites this ("Dual Track") | Each transaction loads `tenders` and `tender_workflow_states` before the other commits. Tx A sets `track_a_pricing_status=APPROVED` and `mis_final_price`; Tx B sets `track_b_doc_status=APPROVED` and `verification_status`. Each barrier check (`services/WorkflowSyncService.java:766-785`) sees the other track as not done, so `can_final_submit=false`. Because every column is written on save, **the second commit overwrites the first commit's track status and price columns with stale values** (row lock → wait → overwrite under READ COMMITTED). Net result: one approval's effect on `tenders` and the state row is **lost**, `current_stage` never reaches SUBMISSION_READY, both approval rows are APPROVED (nothing left to re-approve), and `final-submission` returns 412. Recovery requires a manual `commercial-go-ahead` or `verify-all-documents` | INFERRED |
| **PATCH /api/tenders/{id} concurrent with any workflow write** | PATCH is non-transactional. It loads the tender, then `save()` merges the detached entity and writes every column (`controllers/TenderController.java:889, 1581`). Any stage, status or price committed by another request between the PATCH's load and save is **reverted** (lost update) | INFERRED |
| **Approvals page load (reconcile) concurrent with a review** | Reconcile reads every tender once (`controllers/ApprovalController.java:237`), then works through the list. With 50K–100K rows, an entity may be many seconds old by the time it is processed. (a) `tenderRepository.save(t)` at `:260` and `:287` writes the **stale full row back**, reverting concurrent stage or price changes. (b) `ensurePendingApproval` can create a **new PENDING request for a stage that was just approved** (phantom queue item, cleared by a later reconcile at `:170-221`) | INFERRED |
| **Two approvals page loads at once (17 users polling)** | Both reconcilers do check-then-insert, so **duplicate PENDING rows** appear. Both may try to delete the same duplicates; the loser's `delete` can hit a 0-row update and throw `ObjectOptimisticLockingFailureException`. That is **swallowed** by `catch (Exception)` at `:349-351`, the rest of that reconcile is silently skipped, and the request still returns 200 | INFERRED |
| **Two first-time `getOrCreateState` calls for the same tender** (e.g. two `GET /api/v2/workflow/{id}/state`, or a review racing a state GET) | Both INSERT; one violates `tender_workflow_states.tender_id UNIQUE` → `DataIntegrityViolationException` → **500**. If this happens inside `reviewApproval`, the **whole approval rolls back** | INFERRED |
| **Exception swallowed inside a joined transaction** | `controllers/ApprovalController.java:914-919, 948-952` and `controllers/WorkflowController.java:411-417, 549-553` catch exceptions from `@Transactional` `WorkflowSyncService` methods that joined the outer transaction. Spring marks it rollback-only, so the outer commit throws `UnexpectedRollbackException` → **500 and full rollback**, even though the handler tried to continue | INFERRED |
| **Concurrent manifest scans** (`GET /api/v2/workflow/{id}/manifest` + doc approval) | No unique key on (tender_id, file_name), so **duplicate manifest rows** can be created (`services/TenderFolderScannerService.java:102-149`) | INFERRED |
| **Concurrent `upload-tech-spec` for one tender** | Both write the same output filenames (`Combined_Technical_Data_Sheet.*`) and share the in-memory progress key (`controllers/TenderController.java:1921, 2059-2075`). The last writer wins on files and on `downloaded_docs` | INFERRED |

## 5. Approval endpoints in detail (`controllers/ApprovalController.java`)

### 5a. Reconcile: `reconcileStaleAndDuplicateApprovals()` (`:140-352`), called by **both** GET endpoints

- **Transaction:** none. `@Transactional` at `:140` is bypassed because the method is called as `this.reconcile…()` from `:371` and `:515`, so the Spring proxy is not involved. Every repository call below is its own transaction and its own pool checkout (pool = 25, `config/DatabaseConfig.java:88`). INFERRED (standard Spring AOP proxy behaviour).
- **The UI calls both endpoints:** `frontend/src/app/components/ApprovalsCenter.tsx:347` (counts) and `:408` (pending). That means **two full reconciles per Approvals Center refresh**. VERIFIED (call sites); refresh frequency UNKNOWN (frontend reviewer).

| Step | Line | Query / work | Scales with |
|---|---|---|---|
| R1 | `:143` | `findByStatusOrderByCreatedAtDesc("PENDING")` → `SELECT … FROM tender_approval_requests WHERE status=? ORDER BY created_at DESC`. No index declared on `status` (VERIFIED absence in `models/TenderApprovalRequest.java:6-8` and in the SQL files) | all approval rows (seq scan if no index) |
| R2 | `:145-147` | `findAllById(tenderIds)` → full `tenders` rows for every tender with a pending approval | #pending tenders |
| R3 | `:150-153` | group in memory by tender::stage | — |
| R4 | `:161-163` | per duplicate: `approvalRepository.delete()` (find + delete) | #duplicates |
| R5 | `:170-216` | stale checks (in memory) | — |
| R6 | `:176`, `:221`, `:230` | delete / save per stale or reassigned request (merge = SELECT + UPDATE each) | #stale |
| **R7** | **`:237`** | **`tenderRepository.findAll()`: every row and every column of `tenders`**, including ~15 TEXT columns (`models/Tender.java:35-252`) | **all tenders (50K–100K)** |
| R8 | `:238-241` | Java loop over all tenders; skips status ∈ {Won, Lost, Awarded, Not Awarded, Not Participating} | all tenders |
| R9 | `:246-253` | Rule 1 SPEC (spec status Pending) → `ensurePendingApproval` → `findByTenderIdAndStageOrderByCreatedAtDesc` (`:112`) [+ INSERT `:123`] | tenders matching the rule |
| R10 | `:256-274` | Rule 2 PAYMENT → **`tenderRepository.save(t)` of the stale full row** (`:260`) when payment status is None/null, then `ensurePendingApproval` [+1 query, +0–1 write] | " |
| R11 | `:277-281` | Rule 3 TPC (stage TPC_PRICING, or DUAL_TRACK with no prices) → `ensurePendingApproval` | " |
| R12 | `:284-299` | Rule 4 MIS → possible stale `tenderRepository.save(t)` (`:287`) + `ensurePendingApproval` + possible approval save (`:297`) | " |
| R13 | `:302-316` | Rule 5 DOC → `ensurePendingApproval` + possible save (`:313`) | " |
| R14 | `:319-329` | Rule 6 SUBMISSION → `ensurePendingApproval` | " |
| R15 | `:332-346` | Rule 7 WIN_LOSS (stage WIN_LOSS_PENDING **or `outcome_status='Pending'`**) → `ensurePendingApproval` + possible save (`:344`). Tenders with status Submitted keep `outcome_status=Pending` until an outcome is recorded, so they fire this rule **on every call** | " |
| R16 | `:349-351` | `catch (Exception e) {}`: any failure aborts the remainder silently | — |

**Per-call cost model** (INFERRED): 2 + (#duplicates×2) + (#stale×2) queries, plus **one full-table load of `tenders`**, plus Σ over in-workflow tenders of (rules fired × (1 SELECT on `tender_approval_requests` by tender_id + stage, which is a full seq scan if no index exists, + 0–2 writes)). Each write also fires the `db_change_log` trigger (`backend/src/main/resources/schema-backup-triggers.sql:75-98`). Freshly scraped tenders (status Issued, all sub-statuses None, stage NEW) fire no rules, so the N+1 part scales with **tenders in the workflow**, while the hydration part scales with **all tenders**.

### 5b. `GET /api/approvals/counts` (`:360-457`)

1. JWT parse and HMAC verify (`config/JwtRequestFilter.java:33-45`); role and username from the context (`:362-363`); `isAuthorized` (`:365`).
2. **Reconcile R1–R16** (`:371`).
3. Role branch (`:383-408`): 3 GROUP BY queries (selected status, PENDING, HISTORY):
   - Admin: `countByStageForAdmin` (`repositories/TenderApprovalRepository.java:104-107`).
   - MIS: `countByStageForMisTeam` with `LOWER(assigned_to)=LOWER(:u) OR … OR stage IN :misStages` (`:109-119`).
   - TPC: `:141-151`.
   - Clearance: `:177-188`, with up to 3 more `countByStageForUser` calls if the first returns nothing (`:399-403`).
4. `countByStatusForAdmin()`: a global `GROUP BY status` over the whole table, run for every role (`:415`; repository `:138-139`).
5. In-memory map building; response.
**Total:** reconcile + 4 to 7 aggregate queries. The `(:status='ALL' OR (:status='HISTORY' AND …) OR a.status=:status)` predicate and `LOWER()` make index use unlikely. INFERRED.

### 5c. `GET /api/approvals/pending` (`:498-650`)

1–2. As above, including **reconcile** (`:515`).
3. Stage parsing (`:528-535`); the role-specific list query (`:536-577`). For example, MIS without a stage uses `findByStatusForMisTeam` (`repositories/TenderApprovalRepository.java:79-89`), ordered by `updated_at DESC, created_at DESC`. **Unbounded.** With `status=HISTORY` or `ALL` it returns every historical row. Admin with `ALL` runs `findAllByOrderByCreatedAtDesc` (`:74`), i.e. the whole table. Clearance may run 2 queries (`:566-571`).
4. `findAllById(tenderIds)` (`:586`): full `tenders` rows for every approval returned (IN list of up to thousands of ids).
5. Java loop over the requests (`:592-643`): SPEC filter with `String.contains` on `downloaded_docs` JSON (`:596-605`); `search` filter by `toLowerCase().contains` on title, ref, authority, id and requestedBy (`:608-621`) — **search is applied after loading everything**; team and role filters (`:624-633`); `new ApprovalSummaryDto(req, tender)` (`models/ApprovalSummaryDto.java:47-90`, pure field copies); EMD receipt and TPC price masking (`:636-641`).
6. Response `{approvals,total}`, **no pagination**. `ManufacturerPriceAdvice` re-serialises the body as a tree for Clearance callers (`config/ManufacturerPriceAdvice.java:25-28`).

### 5d. `POST /api/approvals/{approvalId}/review` (`:666-1068`, `@Transactional`)

One transaction and one pooled connection held for the whole request. INFERRED.

1. Role checks (`:675-683`); body validation (`:686-705`).
2. `approvalRepository.findById(approvalId)` (`:708`); fallback `findByTenderIdAndStageOrderByCreatedAtDesc` (`:716`).
3. `WorkflowPermissions.allowed(role, reviewAction(stage))` (`:732`); PENDING check (`:737-744`); queue and assignee ownership (`:747-794`).
4. `tenderRepository.findById` (`:797`); stage match → 409 on mismatch (`:807-821`).
5. Stage work (APPROVED):
   - DOC_VERIFICATION → `approveTrackBDocs` (`services/WorkflowSyncService.java:670-707`): `getOrCreateState` (1 query, or 1 query + 1 insert), `findById`, save tender, **`verifyAllDocuments` → `scanAndSyncFolder`: `Files.walk(uploadDir/id)` + `Files.walk(working_path)` + manifest SELECT + one manifest save per file, then one more save per file** (`services/TenderFolderScannerService.java:65-153, 181-190`); state save; approvals SELECT + saves; comment insert; `checkAndUnlockSubmission` (state + tender SELECT/save). Then `findById` again (`controllers/ApprovalController.java:834`).
   - PAYMENT_APPROVAL → `approveEmdPayment` + `initiateDualTrack` (≈ 6–10 statements plus possible route-pricing deletes and inserts).
   - TPC_PRICING → `recordTpcPricing` (≈ 6–10 statements).
   - MIS_PRICING → `approveTrackAPricing` + barrier (≈ 6–8), then a TPC cleanup SELECT and saves (`:999-1013`).
   - SUBMISSION_PENDING → 1 SELECT + 0–1 INSERT (`:859-873`).
   - WIN_LOSS_PENDING → `recordOutcome` (≈ 5).
   - SPEC_CLEARANCE → `recordFinalTechSpec` (including a **disk scan**, `services/WorkflowSyncService.java:208`).
6. `tenderRepository.save` (`:1017` / `:1034`); `approvalRepository.save` (`:1041`); `findByTenderIdAndStageOrderByCreatedAtDesc` + deletes of other pending rows (`:1044-1049`); `commentRepository.save` (`:1060`).
**Total:** ≈ 10–25 statements, bounded per tender, **plus an unbounded directory walk** for DOC_VERIFICATION and SPEC_CLEARANCE, whose depth depends on the client-supplied `working_path` (set at `controllers/WorkflowController.java:768`, `services/WorkflowSyncService.java:248`, `controllers/TenderController.java:1316-1321`). No external HTTP, AI or email in this path (VERIFIED).

### 5e. Checks for the data-model reviewer's hypotheses about the ~55 s p95 at 50K/100K tenders

| Hypothesis | Code evidence | Verdict |
|---|---|---|
| A full scan of `tenders` per approvals request | `controllers/ApprovalController.java:237` (`findAll()` inside reconcile) on **every** `/counts` and `/pending` call | **Supported** (VERIFIED code path; magnitude INFERRED) |
| N+1 queries | `ensurePendingApproval` → `:112` once per (in-workflow tender × firing rule); plus per-row saves | **Supported** (VERIFIED) |
| No index on `tender_approval_requests` | None declared in the entity (`models/TenderApprovalRequest.java:6-8`) or the SQL resources | Supported for the repo; **UNKNOWN for the live DB** |
| Unpaginated list or result | `/pending` returns every match; no `Pageable` anywhere in `ApprovalController` | **Supported** (VERIFIED) |
| Query shapes defeat indexes | `LOWER(assigned_to)`, `OR stage IN`, `:status='ALL' OR …` (`repositories/TenderApprovalRepository.java:79-245`) | Supported (VERIFIED shape; plan UNKNOWN without `EXPLAIN`) |
| Long transactions holding pool connections | Reconcile is **not** transactional, so it makes many short checkouts rather than holding one connection. The review POST holds one connection, including during the disk walk | Partially: pool *churn* rather than holding; INFERRED |
| Work duplicated per page view | The UI calls counts and pending, so 2× reconcile per view (`frontend/src/app/components/ApprovalsCenter.tsx:347, 408`) | **Supported** (VERIFIED call sites) |
| The POST review itself is slow | Bounded per tender unless `working_path` points at a large tree | Unlikely to explain 55 s at scale. INFERRED. Which endpoint the historical "approval endpoint" figure measured is **UNKNOWN** |

## Doc conflicts (code wins)

| Document claim | Code |
|---|---|
| README.md:58-153: **8 sequential stages**: Spec → TPC → MIS → Docs Prep → Doc Verification → EMD → Submission → Outcome | Spec → Bid docs → EMD → Dual Track (pricing ∥ doc verification) → Submission ready → Submitted / WIN_LOSS_PENDING → Won/Lost (`services/WorkflowSyncService.java`). The enum has 16 values; the state model has 7 steps (§1) |
| README.md:150: Docs Prep requires "Stage 3 MIS price finalized" | `generate-bid-docs` requires only an Approved spec (`controllers/TenderController.java:1657-1666`) |
| README.md:152: EMD requires doc verification Approved | True only for the legacy `payment-request` (MIS-only, `controllers/WorkflowController.java:691`). The v2 path takes EMD *before* doc verification (`controllers/WorkflowController.java:757-760` requires EMD settled first) |
| WORKFLOW_SYSTEM_ARCHITECTURE_REVIEW.md:14-30: "7-Step Gated Workflow" with stage codes SPEC_GENERATION_PENDING, EMD_PAYMENT_READY, DUAL_TRACK_ACTIVE, SPEC_REJECTED | Those stage codes are never written by any code path (§1). The 7 steps match only `tender_workflow_states.current_step` |
| WORKFLOW_SYSTEM_ARCHITECTURE_REVIEW.md:61: `WorkflowController.java (/api/workflow)` | The mapping is `/api/tenders` (`controllers/WorkflowController.java:29`) |
| WORKFLOW_SYSTEM_ARCHITECTURE_REVIEW.md:72: "PostgreSQL … Row-Level Locking" | No explicit locking or versioning exists (§4a) |
| WORKFLOW_SYSTEM_ARCHITECTURE_REVIEW.md:218: Clearance can reject specs → `SPEC_REJECTED` | Rejection is refused (`controllers/ApprovalController.java:823-825`); `SPEC_REJECTED` is never written |
| WORKFLOW_SYSTEM_ARCHITECTURE_REVIEW.md:103 and the `services/WorkflowSyncService.java:16-17` javadoc: "atomic state transitions" | Several handlers split one logical transition across multiple transactions (`controllers/WorkflowController.java:601`, all `WorkflowSyncController` handlers that make more than one service call, PATCH) |
| `services/TenderStatusResolver.java:10-19` javadoc: "the single definition … both controllers now delegate here" | `controllers/AuthController.java:422-449` still has its own divergent copy (used for Admin user stats). `controllers/AnalyticsController.java:329-355` keeps an unused copy |
| Test name `testSpecClearanceApprovalAdvancesToTpcPricingAndCreatesTpcRequest` (`backend/src/test/java/com/tenderpocket/controllers/ApprovalControllerWorkflowTest.java:133`) | The test body asserts `BID_DOCS_PREPARATION` (`:158`), matching the code; only the name is stale |

## Open questions / UNKNOWN

- UNKNOWN: the live distribution of `current_stage`, `outcome_status` and the other sub-statuses at 50K/100K tenders. That distribution sets how many reconcile rules fire per call. Establish with `SELECT current_stage, status, outcome_status, payment_status, verification_status, spec_verification_status, count(*) FROM tenders GROUP BY 1,2,3,4,5,6`.
- UNKNOWN: the row count of `tender_approval_requests` and its indexes in the target DB (`\d+ tender_approval_requests`), and `EXPLAIN ANALYZE` for `repositories/TenderApprovalRepository.java:79-89` and `findByTenderIdAndStageOrderByCreatedAtDesc`.
- UNKNOWN: which approval endpoint (counts, pending or review) produced the historical ~55 s p95, and with which role and status parameter.
- UNKNOWN: how often the Approvals Center refreshes counts and pending (frontend reviewer). The tender list itself polls every 1.5 s (`frontend/src/app/page.tsx:956-1037`).
- UNKNOWN: what scraped and email-imported tenders set for `current_stage` and the sub-statuses (`services/GeMScraperService.java`, `services/EmailSyncService.java` were not read in full).
- UNKNOWN: typical `working_path` values in production. If they point at large network shares, DOC_VERIFICATION and SPEC_CLEARANCE approvals and `GET /api/v2/workflow/{id}/manifest` walk them synchronously.
- INFERRED items in §4b should be confirmed with a targeted race test: two parallel `POST /api/approvals/{id}/review` calls on the same id, and parallel Track A + Track B approvals on one tender, then inspect `tender_workflow_states` and `tenders`.
