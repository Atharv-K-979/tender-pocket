# Seed design (Part 2)

Code: `loadtest/seeder/`. Config: `loadtest/config/seed.yaml` (every value is marked PROPOSED). Sources: review 07 §6 (realism rules), 04 §5a (reconcile), 03 §1 (role strings).

## 1. What a tier is

**Tier N = N proportional "universe" tenders + one fixed fixture block (F = 1,080 tenders).**

The fixture block is the same at every tier. The report labels runs `N (+F)`.

| | Universe (`LTU-0000000…`) | Fixture block (`LTF-…`, `LTP-…`) |
|---|---|---|
| Purpose | Realistic population; drives every full-table query | Per-VU work for WORKFLOW/APPROVALS/AI/DOCGEN, plus same-tender probes |
| Proportions | Identical at every tier (§2) | Constant composition |
| Subset property | Tier N is the exact prefix 0..N-1 of every larger tier, so the rows are byte-identical (tested) | Generated first, with identical ids at every tier |
| Reconcile-active rows | about 12.5 % of N | about 350 constant |

Why the fixtures are not drawn from the universe: at tier 100 the universe holds about 12 active tenders, too few for 15 minutes of per-VU workflow actions. Pinning the fixture block keeps proportions exact and tiers nested.

The cost is a constant floor at small tiers: about 1.2K extra rows, about 350 of them reconcile-active. The approvals reconcile cost scales with active tenders (08 §A), so latencies at tiers ≤ 1,000 carry that floor. Read the curve from 5,000 upward, where the floor is ≤ 28 % of active rows; it falls to 3 % at 100K.

## 2. Proportions (identical at every tier)

The category of universe tender *i* comes from a **largest-deficit proportional sequence**: `model.proportional_sequence`. Every prefix therefore holds each category within ±1 tender of exact. Its contents come from `random.Random(f"{seed}:u:{i}")` alone.

| Group | Share | Categories |
|---|---|---|
| new / unactioned | 67.5 % | `new_unassigned` 33 % (status Issued, no executive), `new_assigned` 34.5 % (owned, 20 % status `New`) |
| not participating | 10 % | `not_participating` (60 % owned) |
| active workflow | 12.45 % | spread over **all** stages: `spec_upload_pending`, `spec_generated`, `spec_clearance_pending`, `bid_docs_preparation`, `payment_approval`, `dual_track`, `tpc_pricing`, `mis_pricing`, `doc_verification`, `submission_ready`, `submission_pending` (1.05–1.25 % each) |
| submitted / won / lost | 10 % | `win_loss_pending` (status Submitted) 3 %, `won` 3.5 %, `lost` 3.5 % |

Variants applied inside the categories:

- 30 % EMD-exempt (no PAYMENT_APPROVAL history);
- 25 % pricing routed to MIS (no TPC);
- 25 % of assignees are the team alias (`misteam` / `clearance` / `TPC Team`).

`validate.py` checks each group to ±1 %.

## 3. Rows per tender, and fixed-point consistency

Each category template in `model.Factory.build` is a **fixed point of `ApprovalController.reconcileStaleAndDuplicateApprovals()`**. A Python port of that method is in `seeder/reconcile_sim.py`, with every rule cited by line. `validate.py` and the tests assert that `simulate()` returns **no actions**, so the first `GET /api/approvals/*` will not rewrite the seed.

The rule-by-rule consequences:

| Reconcile rule (ApprovalController.java) | What the seed guarantees |
|---|---|
| loop 1 duplicates `:161` | at most one PENDING per (tender, stage) |
| loop 1 SPEC stale/premature `:170-178` | PENDING SPEC_CLEARANCE only when spec `Pending` **and** stage `SPEC_CLEARANCE` |
| loop 1 TPC/MIS/PAYMENT/DOC/SUBMISSION/WIN_LOSS stale `:179-215` | a PENDING row exists only while its stage is genuinely open (no price, not approved, stage not past it) |
| loop 1 MIS alias reassignment `:222-231` | PENDING rows in MIS stages are never assigned to `tpc`/`clearance`/`executive` |
| rule 1 `:246` | spec `Pending` ⇒ PENDING SPEC_CLEARANCE assigned to `assigned_mis_member_spec` |
| rule 2 `:256-274` | `payment_status` is `Pending` only at PAYMENT_APPROVAL, with a PENDING row whose `emd_amount`, `transfer_mode`, `transfer_ref_no` and `receipt_file_url` are already filled. `ensurePendingApproval` fills nulls (`:124-129`), so leaving any null would cause a write |
| rule 3 `:277` | `TPC_PRICING`, or `DUAL_TRACK` without prices, ⇒ PENDING TPC_PRICING. DUAL_TRACK keeps `pricing_route` NULL |
| rule 4 `:284-299` | `MIS_PRICING` ⇒ PENDING MIS_PRICING assigned to a real MIS user, with `tpc_purchase_price` copied |
| rule 5 `:302-316` | `DOC_VERIFICATION` / verification `Pending` ⇒ PENDING DOC_VERIFICATION. `working_path` stays NULL, so reviews never walk an arbitrary directory (04 §5d) |
| rules 6–7 `:319-346` | submission / outcome `Pending` only at their own stage. `loss_reason` NULL while pending |

Child rows follow the stage:

- `tender_workflow_states`: one per tender past NEW, consistent with the stage (`step`, `spec_status`, `emd_status`, `track_a/b`, `can_final_submit`, `outcome`). Seeding these avoids the lazy INSERT that `GET /api/v2/workflow/{id}/state` does on a cold tender.
- `tender_approval_requests`: APPROVED with `reviewed_by` for each passed stage, plus the PENDING row(s) for the current stage. During Dual Track a DOC_VERIFICATION PENDING exists in parallel with TPC/MIS, as `initiateDualTrack` creates it.
- `tender_comments`: about 2 per approval (request + review).
- `tender_workflow_comments`: 0–5.
- `status_history`: one row per status change (Issued→Participating→Submitted→Won/Lost, Issued→Not Participating).
- `activity_log`: 3–8 per active/terminal tender, using the app's own action strings (`TenderController.java:1585-1704`).
- `tender_document_manifest`: 3–10 per tender past bid docs.

Approximate rows at 100K: 101K tenders, about 105K approvals, about 190K tender comments, about 200K activity rows.

## 4. Payload realism

| Field | Value |
|---|---|
| title | 100–400 chars |
| `ai_details_summary` / `ai_history_summary` | 1–5 KB each on 40 % of tenders |
| `downloaded_docs` | JSON array of 2–8 `{name, filename, local_path, created_date}`, plus a "Technical Specification" entry once a spec exists, as `GET /api/approvals/pending` filters on it (`ApprovalController.java:596-604`) |
| notes | 40–600 chars on 55 % |
| `schedule_product_models` | JSON on 30 % |
| `estimated_cost` | log-uniform ₹1 lakh–₹50 crore, covering the analytics brackets |
| String dates | `yyyy-MM-dd HH:mm:ss`, which the boot migration leaves untouched (`TenderPocketApplication.java:80-84`); 20 % of due dates as `d MMM yyyy` (`TenderController.java:590`); 60 % of GeM `scraped_at` as `java.util.Date.toString()` (`TenderStatusResolver.java:33-36`) |
| `due_date` | mostly past for new tenders, so they resolve to Lapsed/Missed Deadline; future for active tenders |

The production length distribution is UNKNOWN (07 §6.1). Compare with the audit's `avg/p95 pg_column_size(tenders)` and adjust `seed.yaml payload`.

`anchor_date` is fixed (2026-11-01), so the data is byte-identical on every regeneration. Lapsed and Missed Deadline are computed against the wall clock (`TenderStatusResolver.java:72-110`), so a few display statuses shift as days pass. This affects the display only, not reconcile.

## 5. Users

| Role (stored string, `AuthController.java:251`) | Seeded |
|---|---|
| Tender Executive | `lt_exec_01..12`, plus `lt_exec_x01..x03` inactive owners. 15 owners in total, Zipf-skewed |
| MIS Team | `lt_mis_01..08` |
| Clearance Team | `lt_clear_01..06` |
| TPC Team (**not** "TPC Pricing Team", 03 §1c) | `lt_tpc_01..06` |
| Admin | `lt_admin_01..04` |

- Password: `env.yaml test_user_password`, hashed exactly as `SecurityConfig.passwordEncoder` does (unsalted SHA-256 hex, `SecurityConfig.java:29-56`; tested).
- E-mails: `@loadtest.invalid` (RFC 2606, never deliverable).
- Counts cover the largest allocation (AI-10 needs 11 executives) plus spares.

Non-`lt_` users are never deleted. The five default accounts that `AuthController.java:73-87` re-creates on login therefore keep existing, and login stays read-only.

## 6. Fixture block (per VU, partitioned)

`fixtures.json` maps each username to its tender ids by kind. `run.py` puts it into the k6 run config, so each VU acts only on its own tenders.

| Role | Kind × count per user | Used by |
|---|---|---|
| Executive | `spec_generated` 10, `bid_docs_preparation` 6, `dual_track` 6 | J1 clearance-request, J3 emd-applicability / route-pricing |
| Executive | `upload` 30 (spec not approved) | Track B AI: one distinct tender per upload |
| Executive | `bidpack` 15 (spec Approved) | Track B DOCGEN |
| Clearance | `spec_clearance_pending` 10, assigned to the user | J2 |
| TPC | `tpc_pricing` 10, assigned to the user | J4 |
| MIS | `payment_approval`, `mis_pricing`, `doc_verification` 4 each; `submission_pending`, `win_loss_pending` 3 each | J5 |
| probe | `double_approval` 6 (PAYMENT_APPROVAL in the `misteam` queue); `dual_track_race` 6 (MIS_PRICING + DOC_VERIFICATION pending) | same-tender probe (04 §4b) |

## 7. Trigger handling (`db_change_log`, review 07 §4)

The review infers that the trigger script probably fails to install, because of `$$` splitting. The audit settles it. `load.py` and `reset.sh` **detect** `trg_track_*` triggers and `db_change_log`, and apply `seed.yaml triggers_mode`:

| Detected | `auto` (default, PROPOSED) |
|---|---|
| no triggers | plain load |
| triggers + superuser | `SET LOCAL session_replication_role = replica` during the load, so the seed does not create about 2 rows of JSONB per seeded row. `TRUNCATE db_change_log` in the same transaction |
| triggers, not superuser | triggers fire during the load. `TRUNCATE db_change_log` at the end of the same transaction |

During the **test**, triggers fire normally. This matches production write amplification and is measured.

Two consequences:

- After a reset, `db_change_log` is empty. On the **next backend restart**, the backfill (`schema-backup-triggers.sql:120-154`) copies whole tables into it, which stalls startup. The orchestrator's "no recent restart" pre-flight and the 20-minute uptime rule cover this.
- Mode `fire` keeps everything as is (`seed.yaml`).

## 8. Commands (run order)

| Step | Command | Where |
|---|---|---|
| 1 | `bash seeder/backup.sh --approved` | EC2-2: full `pg_dump -Fc` to `/var/tmp/tp-loadtest/backups/` |
| 2 | `python3 seeder/generate.py --tiers 100,…,100000 --seed 42` | generator: CSVs to `seeder/out/` (about 1–2 min, about 0.5 GB gz) |
| 3 | `python3 seeder/load.py --tier N --approved` | generator: schema check, plan, one-transaction COPY over SSH |
| 4 | `python3 seeder/validate.py --tier N` | generator: read-only |
| 5 | `bash seeder/dump_tier.sh --tier N --approved` | EC2-2: `dumps/tier_N.sql.gz` |
| 6 (each run) | `bash seeder/reset.sh --tier N --approved` | EC2-2: TRUNCATE + reload + ANALYZE in one transaction, no restart |
| check | `python3 seeder/drift_check.py snapshot/diff` | generator: read-only |
| emergency | `bash seeder/restore_backup.sh --file … --approved` | EC2-2 |

Every write prints its plan first and refuses without `--approved` (G6).
