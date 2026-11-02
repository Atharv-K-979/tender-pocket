# 07 — Data model (for load-test seeding and query-risk analysis)

Scope: branch `load-testing`, commit `68eb28ae`. This is a read-only code review: I ran nothing against a database. Labels used below:
**VERIFIED** means I read it in code. **INFERRED** means I reasoned it from code. **UNKNOWN** means it needs a DB or runtime check, and the check is named.
All paths are relative to the repo root. `models/` is short for `backend/src/main/java/com/tenderpocket/models/`, and `repositories/` follows the same pattern.

---

## 0. Things that change how to read everything else

| # | Finding | Label |
|---|---|---|
| 0.1 | **The Next.js app does not use Postgres.** `frontend/src/lib/db.ts:1,5,15` opens a **SQLite** file through `better-sqlite3` (`DATABASE_PATH` or `./tenders.db`). Every `db.prepare(...)` in the frontend runs against that local SQLite file. All the frontend API routes that matter for load testing (`/api/tenders`, `/api/approvals/*`, `/api/analytics`, `/api/tenders/stats`, `/api/activity-logs`, `/api/tenders/[id]`, `/api/v2/workflow/*`) are thin proxies to Spring through `proxyToBackend` (`frontend/src/lib/backendProxy.ts:5-67`). | VERIFIED |
| 0.2 | `frontend/src/lib/approvalsSync.ts` (`reconcileApprovalRequests`, line 9) has **no callers** anywhere under `frontend/src`. `frontend/src/lib/gemSyncEngine.ts` is also never imported. Both are dead code. The live approval reconciliation is the Java one at `ApprovalController.java:140-352`. | VERIFIED (grep) |
| 0.3 | The backend **falls back silently to SQLite** (`tenders.db` or `../frontend/tenders.db`, pool size 10) if creating the Postgres Hikari pool throws (`backend/src/main/java/com/tenderpocket/config/DatabaseConfig.java:99-113`). | VERIFIED. Which DB served the load test is UNKNOWN: grep the backend startup log for `Configured PostgreSQL DataSource successfully` versus `Falling back to SQLite`. |
| 0.4 | Hikari settings: `maximumPoolSize=25`, `minimumIdle=5`, `connectionTimeout=15000`, `idleTimeout=30000`, **`maxLifetime=60000`**, `leakDetectionThreshold=60000` (`DatabaseConfig.java:88-94`). The JVM runs with `-Xmx3g` (`docker-compose.yml:32`). | VERIFIED |
| 0.5 | `PostgresBackupInitConfig.java:25` calls `jdbcTemplate.getDataSource().getConnection()` and never closes the connection, so one pooled connection leaks at startup. | INFERRED (leak). UNKNOWN whether Hikari logged it: grep for `Connection leak detection triggered`. |

---

## 1. How the schema is created and migrated

| Mechanism | Where | What it does | Label |
|---|---|---|---|
| Hibernate `ddl-auto=update` | `backend/src/main/resources/application.properties:10` (env `SPRING_JPA_HIBERNATE_DDL_AUTO`, default `update`; also `docker-compose.yml:37`) | Creates or alters all 14 JPA tables. It also creates the indexes listed in `@Table(indexes=…)` and the unique constraints. It never drops anything. | VERIFIED (config). That update mode creates the `@Index` entries is INFERRED from Hibernate 6.6 behaviour (Spring Boot 3.4.1, `backend/pom.xml:10`). |
| No Flyway or Liquibase | the whole repo | `grep` finds no `flyway` or `liquibase`. | VERIFIED |
| `spring.sql.init.*` | not set | Spring's SQL init is not configured. | VERIFIED |
| `migrateDatabaseColumns` CommandLineRunner | `backend/src/main/java/com/tenderpocket/TenderPocketApplication.java:52-96` | On every start it runs `ALTER TABLE tenders ALTER COLUMN … TYPE text` for 14 columns (lines 57-70), then `UPDATE … replace(...) WHERE … LIKE '%T%'` on `tender_approval_requests` (fails on PG because those columns are `timestamp`, and the error is swallowed), `tender_workflow_comments.created_at`, and `activity_log.timestamp` (lines 81-84). Those last UPDATEs are **full scans at every boot**. | VERIFIED |
| `schema-backup-triggers.sql` | run by `PostgresBackupInitConfig.java:28-31` (`ResourceDatabasePopulator`, `continueOnError=true`) | Creates `db_change_log` and `backup_runs`, the function `fn_track_db_changes()`, 9 triggers, a backfill, and 4 composite `tenders` indexes. | VERIFIED (that it runs) |
| `schema-product-catalogue.sql` | **nothing references it** | Never executed. Its tables come from Hibernate instead. | VERIFIED (grep) |
| Frontend SQLite DDL | `frontend/src/lib/db.ts:24-252` | Separate SQLite schema. Not Postgres. | VERIFIED |

**Trigger creation probably fails.** `ResourceDatabasePopulator` splits the script on `;`, and Spring's `ScriptUtils` does not understand PostgreSQL `$$` dollar quoting. The body of `CREATE OR REPLACE FUNCTION fn_track_db_changes()` (`schema-backup-triggers.sql:33-71`) contains `;`, so it would be split into fragments that fail to parse. With `continueOnError=true`, every later `CREATE TRIGGER … EXECUTE FUNCTION fn_track_db_changes()` would then fail with "function does not exist", unless someone created the function by hand earlier. Label: **INFERRED**. **UNKNOWN** on the test DB until you run: `SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE NOT tgisinternal;` and `\df fn_track_db_changes`. This matters for write-path load: if the triggers exist, **every INSERT, UPDATE or DELETE on 9 tables also writes a full `to_jsonb(row)` copy into `db_change_log`**.

---

## 2. Tables (Postgres)

There are 14 JPA entities, which give 14 tables, plus 1 table that exists only in raw SQL (`db_change_log`). None of the entities has a real JPA association **except** `ProductModel` and `ProductSpecificationItem`. Every other "foreign key" is a plain `String tenderId` column with **no FK constraint and no relation mapping**.

### 2.1 `tenders` (`models/Tender.java`)
- PK `id` VARCHAR (assigned String, not generated) (`Tender.java:28-30`). Has no `@Version` and no `@DynamicUpdate`, so every `save()` of a detached entity becomes `SELECT` + `UPDATE` of **all ~90 columns** (INFERRED from Hibernate merge semantics).
- About 90 columns. **Every date or time is a String/VARCHAR**: `due_date`, `opening_date`, `scraped_at` (NOT NULL), `entry_date`, `assigned_at`, `publish_date`, `start_date`, `pre_bid_date`, `final_tech_spec_uploaded_at`, `pricing_go_ahead_at`, `emd_payment_date` (lines 65-69, 86-99, 122-132, 206, 245, 257). Range filters on these are **string comparisons**, and the data contains mixed formats (`TenderStatusResolver.java:36-60` handles `"Sun Oct 11 19:12:57 GMT 2026"` and `"MMM d yyyy"`).
- **TEXT columns, which carry the payload weight**: `title` (NOT NULL), `authority`, `location`, `document_url`, `downloaded_docs` (a **JSON array stored as text**; see `TenderController.java:2086-2090` and the frontend's `JSON.stringify(currentDocs)` at `generate-bid-docs/route.ts:566-574`), `original_url` (NOT NULL), `notes`, `corrigendum_remark`, `product_name_as_per_tender`, `product_name_as_per_marken`, **`ai_details_summary`**, **`ai_history_summary`**, `working_path`, `loss_reason`, `schedule_product_models` (JSON as text) (lines 35-84, 134-141, 173-180, 209, 266). There is no `@Lob`, bytea or JSONB anywhere in the entities. VERIFIED.
- The workflow and status columns that the approval and search code read: `status` (default `Issued`), `current_stage` (default `NEW`), `spec_verification_status`, `payment_status`, `verification_status`, `submission_status`, `outcome_status`, `pricing_status` (all default `None`), `pricing_route`, `tpc_purchase_price`, `mis_final_price`, `mis_executive`, `assigned_mis_member`, `assigned_mis_member_{emd,docs,submission,spec}`, `final_tech_spec_filename`, `emd_*`, `source`, `source_id`, `ref_no`, `estimated_cost`, `sector`. VERIFIED.
- **Indexes** (`Tender.java:12-24`, also repeated in `schema-backup-triggers.sql:157-160`): `status`, `due_date`, `mis_executive`, `location`, `sector`, `scraped_at`, `source`, `ref_no`, `(due_date, mis_executive)`, `(status, estimated_cost)`, `(sector, estimated_cost)`, `(authority, estimated_cost)`. VERIFIED (declared). Whether they exist on the test DB is UNKNOWN (`\d+ tenders`).
- **Filtered or sorted columns with NO index**: `source_id` (`findFirstBySourceId`, which GeM and email sync call per bid), `current_stage`, `spec_verification_status`, `payment_status`, `verification_status`, `submission_status`, `outcome_status`, `assigned_mis_member_spec` (`LOWER(...)` in `TenderRepository.java:56-57`), `title`, `authority` (as a leading or sole column for `LIKE`), `LOWER(mis_executive)` (`TenderApprovalRepository.java:221,231,241`), `TRIM(mis_executive)` (`TenderRepository.java:95,98`). There are no expression indexes. VERIFIED.

### 2.2 `tender_approval_requests` (`models/TenderApprovalRequest.java`)
- PK `id` IDENTITY. `tender_id` VARCHAR NOT NULL, `stage` VARCHAR (enum STRING, `TenderWorkflowStage`, 16 values in `models/TenderWorkflowStage.java:3-20`), `requested_by` NOT NULL, `assigned_to`, `status` NOT NULL (`PENDING|APPROVED|REJECTED|CHANGES_REQUESTED`), `working_path`, `emd_amount`, `transfer_mode`, `transfer_ref_no`, `receipt_file_url`, `loss_reason_executive` TEXT, `loss_reason_mis` TEXT, `tpc_purchase_price`, `mis_final_price`, `reviewed_by`, `reviewer_comment` TEXT, `created_at`/`updated_at` `timestamp` (LocalDateTime) (lines 14-70). VERIFIED.
- **There are no indexes at all** (`@Table(name="tender_approval_requests")` with no `indexes`, line 7). There is no unique constraint on `(tender_id, stage, status)` either. VERIFIED.
- Every approval query filters on `status`, `stage`, `tender_id`, `LOWER(assigned_to)`, `LOWER(requested_by)` and sorts on `created_at`/`updated_at`, so **every one of them is a sequential scan**. VERIFIED (that no index is declared). INFERRED (the plan shape).
- Enum risk: a row whose `stage` value is not one of the 16 enum names makes Hibernate throw when it reads the row. Seeders must use the exact names. INFERRED.

### 2.3 `tender_workflow_states` (`models/TenderWorkflowState.java`)
- PK `id`. `tender_id` is **UNIQUE** (line 19) and also has a redundant `idx_workflow_tender_id`, plus `idx_workflow_current_step` (lines 8-10). Contains about 40 status columns that mirror `tenders` (spec/emd/pricing/doc/submission/outcome), 3 TEXT remark columns (lines 51, 125, 145), and String dates. VERIFIED.
- Created lazily by `WorkflowSyncService.getOrCreateState` (`services/WorkflowSyncService.java:45-136`), which **`GET /api/v2/workflow/{id}/state` calls** (`WorkflowSyncController.java:63`). That is a write on a GET. VERIFIED.

### 2.4 `tender_comments` (`models/TenderComment.java`)
- `tender_id` NOT NULL, `stage`, `author_username`, `author_role`, `comment_text` TEXT NOT NULL, `created_at` timestamp. **No indexes.** Read by `findByTenderIdOrderByCreatedAtAsc` (`WorkflowController.java:89`). VERIFIED.

### 2.5 `tender_workflow_comments` (`models/TenderWorkflowComment.java`)
- `tender_id`, `phase`, `author`, `author_role`, `comment` (VARCHAR 255, not TEXT), `created_at` String. **No indexes.** Read by `GET /api/tenders/{id}/comments` (`TenderController.java:2236`), which **the UI polls every 1.5 s** (`frontend/src/app/tenders/[id]/page.tsx:391-394`, `frontend/src/app/page.tsx:1026`). VERIFIED.

### 2.6 `status_history` (`models/StatusHistory.java`)
- `tender_id`, `from_status`, `to_status`, `changed_by`, `changed_at` String. **No indexes.** `GET /api/tenders/stats` joins all of it to `tenders` (`TenderRepository.java:92-93`). VERIFIED.

### 2.7 `activity_log` (`models/ActivityLog.java`)
- `username`, `role`, `action`, `tender_id`, `timestamp` String NOT NULL, `details` VARCHAR(255). **No indexes.** `GET /api/activity-logs` returns **the whole table** sorted by `timestamp` (`ActivityLogRepository.java:11`, `ActivityLogController.java:28`). VERIFIED.

### 2.8 `tender_document_manifest` (`models/TenderDocumentManifest.java`)
- `tender_id`, `file_name`, `display_name`, `relative_path` TEXT, `file_category`, `file_size_bytes`, flags, String dates. Indexes on `tender_id` and `file_category` (lines 8-10). VERIFIED.

### 2.9 `email_notification_logs` (`models/EmailNotificationLog.java`)
- Unique constraint plus an identical index on `(recipient_username, tender_id, notification_type, sent_date)`, with further indexes on `sent_date` and `status` (lines 8-16). `findByTenderId` (`repositories/EmailNotificationLogRepository.java:20`) can only use the composite index as a non-leading column, so it is effectively unindexed. VERIFIED (declared). The plan is INFERRED.

### 2.10 `users`, `user_signatures`
- `users`: PK `username`, plus `password_hash`, `role`, `email`. `findByRole` is unindexed, but the table is tiny. `user_signatures`: PK `username`. VERIFIED.

### 2.11 `product_models` / `product_spec_items` (the only real JPA relation)
- `ProductModel.specifications`: `@OneToMany(mappedBy="productModel", cascade=ALL, orphanRemoval=true, fetch=EAGER)` (`ProductModel.java:53-55`). `ProductSpecificationItem.productModel`: `@ManyToOne(fetch=LAZY)` with join column `product_model_id` (`ProductSpecificationItem.java:18-21`). The indexes declared are the unique `model_number`, `product_category`, `status`, `product_model_id` and `is_verified`. `ProductCatalogueService.java:167` calls `findAll()`, which makes the EAGER collection do an N+1 or a join. The table is independent of tender count, and the catalogue tab has been removed from the UI (commit `dfd86780`). Low priority. VERIFIED.

### 2.12 `backup_runs` (JPA `models/BackupRun.java`, and also `schema-backup-triggers.sql:16-31`)
- Index on `status`. Small. VERIFIED.

### 2.13 `db_change_log` (raw SQL only, `schema-backup-triggers.sql:4-14`)
- `id BIGSERIAL PK`, `table_name`, `operation`, `record_pk TEXT`, **`row_data JSONB`** (a full row snapshot), `created_at`. It has indexes on `id` (redundant with the PK) and `table_name`. If the triggers exist, it grows by **1 row per write** on 9 tables, and each tender write stores a full JSONB copy of the ~90-column tender, AI summaries included. Read by `PostgresBackupService` (`:62,76,264`), which nothing in Java calls (VERIFIED by grep). The Python scripts `scripts/postgres-backup-{daily,monthly}.py` use `pg_dump` instead. VERIFIED.

### 2.14 Tables in the frontend SQLite only (`frontend/src/lib/db.ts`)
`tenders` (subset), `processed_emails` (SQLite only, unused elsewhere), `status_history` (with SQLite triggers at lines 85-112), `users`, `activity_log`, `tender_workflow_comments`, `tender_approval_requests`. None of these is Postgres. VERIFIED.

**Count: 15 Postgres tables (14 JPA plus `db_change_log`) and 7 SQLite tables.**

---

## 3. Index coverage compared with the filters actually used

| Table | Indexes that exist (declared) | Filtered, sorted or joined with no usable index |
|---|---|---|
| tenders | see 2.1 | `source_id`, `current_stage`, `*_status` workflow flags, `LOWER(assigned_mis_member_spec)`, `LOWER(mis_executive)`, `TRIM(mis_executive)`, `title`/`authority`/`ref_no` substring search (done in Java) |
| tender_approval_requests | **none** | `status`, `stage`, `tender_id`, `LOWER(assigned_to)`, `LOWER(requested_by)`, `ORDER BY created_at`/`updated_at` |
| tender_comments | none | `tender_id`, `ORDER BY created_at` |
| tender_workflow_comments | none | `tender_id`, `ORDER BY created_at` |
| status_history | none | `tender_id` (join, `findByTenderId`) |
| activity_log | none | `action`, `ORDER BY timestamp` |
| email_notification_logs | composite (recipient, tender, type, date), sent_date, status | `tender_id` alone |
| tender_workflow_states | tender_id (unique and duplicate), current_step | `assigned_executive` (`findByAssignedExecutive`, `repositories/TenderWorkflowStateRepository.java:14`) |
| users | PK | `role` (tiny table) |

---

## 4. Triggers

| Trigger | Table | Fires | Effect | Label |
|---|---|---|---|---|
| `trg_track_tenders` … `trg_track_email_notification_logs` (9 of them) | tenders, users, activity_log, status_history, tender_approval_requests, tender_comments, tender_workflow_comments, user_signatures, email_notification_logs | `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW` (`schema-backup-triggers.sql:74-117`) | `INSERT INTO db_change_log … to_jsonb(NEW/OLD)` (lines 33-71) | Declared: VERIFIED. Present in DB: **UNKNOWN** (likely missing; see §1) |
| Backfill | db_change_log | At every backend start (lines 120-154) | If `db_change_log` has no rows for a table, it copies **the whole table** as JSONB. After seeding 100K tenders, the next restart copies all 100K. | VERIFIED (SQL). The impact is INFERRED. |
| SQLite triggers | frontend `tenders` → `status_history` | `frontend/src/lib/db.ts:85-112` | SQLite only | VERIFIED |

Tables **not** tracked: `tender_workflow_states`, `tender_document_manifest`, `product_*`, `backup_runs`.

---

## 5. Row growth per tender (INFERRED from code paths)

The "happy-path lifecycle" goes: new → assigned → spec submitted → spec cleared → bid docs → EMD → TPC/MIS pricing → doc verification → submission → outcome.

| Child table | Writers (file:line) | Rows per tender, happy path | Rows with 1-2 rejections or re-submissions | Notes |
|---|---|---|---|---|
| tender_workflow_states | `WorkflowSyncService.java:46-136` (also created on GET `/state`) | 1 | 1 | unique on tender_id |
| tender_approval_requests | `WorkflowController.java:153-173` (SPEC_CLEARANCE), `WorkflowSyncService.java:374-384` (PAYMENT), `:504-508` (TPC), `:545-549`, `:597-616` (MIS), `:452-456` (DOC), `ApprovalController.java:865-872` (WIN_LOSS), and also **`ApprovalController.java:110-137` via the reconcile loop on every GET** | 5-7 (SPEC, PAYMENT unless EMD exempt, TPC if the TPC route is used, MIS, DOC, SUBMISSION, WIN_LOSS) | 8-12 (`rejectTrackBDocs` creates a new DOC row, `WorkflowSyncService.java:748`). Concurrent GETs can also insert **duplicate PENDING rows** (check-then-insert with no lock or unique key), which later get deleted. | the biggest per-tender child table that gets queried |
| tender_comments | `ApprovalController.java:1060` (every review), plus `WorkflowSyncService.java:214,282,293,325,337,389,430,511,552,619,658,701,751`, plus `WorkflowController.java:177,450` | about 10-15 (roughly 2 per approval review plus 1 per submit step) | 15-25 | no index |
| tender_workflow_comments | `TenderController.java:2240-2258` (user comments) | 0-N (user-driven, say 2-5) | — | polled every 1.5 s |
| status_history | `TenderController.java:1107` (PATCH status change) | 2-4 | — | no index |
| activity_log | `TenderController.java:1590` (PATCH), `:1627` (delete), `:1704` (bid docs), `:2111` (upload spec), `:2193` (gen specs), `AuthController.java:291,345` | 3-8 | — | no index, and the endpoint returns all rows unpaginated |
| tender_document_manifest | `TenderFolderScannerService.java:102-148` (one per file found in the tender folder) | 3-10 | — | indexed |
| email_notification_logs | `EmailNotificationService.java:546` (daily T0/T3/unreviewed/pending-approval alerts per recipient) | 0-5 per tender over its life | — | |
| db_change_log (if triggers exist) | trigger | 1 per write to the tables above: about **30-60 per tender**, each tender write carrying a full JSONB row | more | the largest table by bytes |

Rough totals for a fully worked tender: **~25-40 child rows** outside `db_change_log`, and 50-100 including it. A tender that is only scraped (status `Issued`/`New`, never assigned) has **0 child rows**, unless someone opens its detail page: `GET /state` then creates 1 `tender_workflow_states` row. INFERRED.

---

## 6. What a realistic seeded tender must include

The aim is that the queries in `08-query-risk-register.md` do the same work they do in production, and that **the first GET does not rewrite the dataset**. `ApprovalController.reconcileStaleAndDuplicateApprovals` (`:140-352`) mutates data on every `/api/approvals/counts` and `/pending` call, so an inconsistent seed turns the load test into a data migration.

### 6.1 `tenders` columns that are touched
- Identity and search: `id` (string), `ref_no`, `title` (realistic length: 100-400 chars), `authority` (TEXT), `source_id`, `source` (`GeM`/`Tender247`/`email`), `original_url` (NOT NULL), `scraped_at` (NOT NULL, ISO string), `publish_date`, `due_date` (ISO `yyyy-MM-dd HH:mm:ss` string, a mix of past and future dates), `assigned_at`, `entry_date`, `location`, `sector`, `estimated_cost` (spread across the brackets at `AnalyticsController.java:182-189`).
- Payload weight (needed so that `findAll()` costs what it costs in production): `ai_details_summary` and `ai_history_summary` (1-5 KB each when present), `downloaded_docs` (JSON array of 2-8 `{name, filename, local_path, created_date}` objects), `notes`, `schedule_product_models` (JSON), `product_name_as_per_*`, `corrigendum_remark`. **UNKNOWN:** the real production length distribution. Run `SELECT avg(pg_column_size(t.*)), percentile_cont(0.95) WITHIN GROUP (ORDER BY pg_column_size(t.*)) FROM tenders t;` on production or a staging snapshot.
- Ownership: `mis_executive` (many tenders per executive username, and **null/blank for unassigned tenders**: they drive `Lapsed` and the unreviewed alerts), `assigned_mis_member`, `assigned_mis_member_{spec,emd,docs,submission}` (a mix of real usernames and team aliases such as `misteam`, `clearance`, `tpc`).
- Workflow state, which must be **mutually consistent** for each stage (see `ApprovalController.java:170-216` and `:238-347`):
  - `current_stage` ∈ {`NEW`, `EXECUTIVE_ASSIGNMENT`, `SPEC_CLEARANCE`, `BID_DOCS_PREPARATION`, `EMD_PAYMENT`/`PAYMENT_APPROVAL`, `DUAL_TRACK`, `TPC_PRICING`, `MIS_PRICING`, `DOC_VERIFICATION`, `SUBMISSION_READY`, `SUBMISSION_PENDING`, `WIN_LOSS_PENDING`, `WON`, `LOST`}.
  - `spec_verification_status` (`None|Pending|Approved`). Pending SPEC_CLEARANCE rows are only listed if `downloaded_docs` contains "Technical Specification"/"specification", or `final_tech_spec_filename` is set, or `current_stage='SPEC_CLEARANCE'` (`ApprovalController.java:596-604`).
  - `payment_status` (`None|Pending|Approved|Exempt|Rejected`), `verification_status`, `submission_status`, `outcome_status`, `pricing_status`, `pricing_route` (`TPC|MIS`), `tpc_purchase_price`, `mis_final_price`, `emd_applicable`, `emd_*`.
  - `status` ∈ {`Issued`, `New`, `Participating`, `Not Participating`, `Submitted`/`Filed`, `Won`/`Awarded`, `Lost`/`Not Awarded`}. Terminal statuses are skipped by the reconcile loop (`:239`).

### 6.2 Child rows per tender, by stage
- Each tender at stage X > NEW needs a `tender_workflow_states` row whose fields match (`spec_status`, `emd_status`, `track_a_pricing_status`, `track_b_doc_status`, `outcome_status`).
- `tender_approval_requests`: one **historical** row (`APPROVED`, with `reviewed_by` and `reviewer_comment`) for each stage already passed, and **exactly one `PENDING` row** for the current approval stage, with `assigned_to` set to the alias the reconcile code would choose. Otherwise reconcile re-assigns it (`:222-231`). Use exact enum names for `stage`. Set `created_at` and `updated_at` to realistic spread timestamps, because the lists sort on them.
- `tender_comments`: about 2 per historical approval. `tender_workflow_comments`: 0-5. `status_history`: 1 per status change, with `changed_at` as an ISO string spread over the last 365 days, since `/api/tenders/stats` buckets by 7/30/365 days. `activity_log`: 3-8. `tender_document_manifest`: 3-10 for tenders past BID_DOCS.

### 6.3 Status distribution needed (proposed; the production mix is UNKNOWN)
Get the production numbers with: `SELECT status, current_stage, count(*) FROM tenders GROUP BY 1,2 ORDER BY 3 DESC;` and `SELECT stage, status, count(*) FROM tender_approval_requests GROUP BY 1,2;`.
If production data is not available, a defensible starting mix is:
- About 60-70 % scraped but never actioned (`Issued`/`New`, half with `mis_executive` null, `due_date` mostly in the past, so they resolve to `Lapsed` / `Missed Deadline`).
- About 10 % `Not Participating`.
- **About 10-15 % in active workflow stages, spread across all stages.** This is the population the approval reconcile loop iterates over, and its **absolute size** (not the total tender count) drives approval latency. See 08 §A.
- About 10 % terminal (`Submitted`/`Won`/`Lost`).
- For comparing 50K and 100K runs, **scale the active-workflow share proportionally**. If the 100K seed only added `Issued` rows, the approval endpoints will look flat by construction.

### 6.4 Users
Seed several users per role (`Tender Executive`, `MIS Team`, `Clearance Team`, `TPC Team`, `Admin`). Approval queries branch by role, and `assigned_to` matching is by username or alias.

---

## Open questions / UNKNOWN (run these on the test DB)

1. Which DB did the backend actually use? Grep the startup log for `[DatabaseConfig] Configured PostgreSQL DataSource successfully` or `Falling back to SQLite`.
2. Do the triggers and the function exist? `SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE NOT tgisinternal;` `SELECT proname FROM pg_proc WHERE proname='fn_track_db_changes';` `SELECT count(*), pg_size_pretty(pg_total_relation_size('db_change_log')) FROM db_change_log;`
3. Do the declared indexes exist? `\d+ tenders`, `\d+ tender_approval_requests`, `\d+ tender_comments`, `\d+ tender_workflow_comments`, `\d+ status_history`, `\d+ activity_log`, `\di+`.
4. Table sizes and row width: `SELECT relname, n_live_tup, n_dead_tup, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC;` and `SELECT avg(pg_column_size(t.*)) FROM tenders t;`.
5. What the seed distribution was (50K compared with 100K): `SELECT status, current_stage, spec_verification_status, payment_status, verification_status, submission_status, outcome_status, count(*) FROM tenders GROUP BY 1,2,3,4,5,6,7;` and `SELECT stage, status, count(*) FROM tender_approval_requests GROUP BY 1,2;`, compared before and after a run. A difference means the reconcile loop mutated the seed.
6. Duplicate PENDING rows created under concurrency: `SELECT tender_id, stage, count(*) FROM tender_approval_requests WHERE status='PENDING' GROUP BY 1,2 HAVING count(*)>1;`
7. Column types after `ddl-auto=update` plus the ALTERs: `SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_name='tenders';`
8. Whether Hibernate 6.6 added a CHECK constraint for `stage`: `\d tender_approval_requests`.
9. Postgres memory compared with the data: `SHOW shared_buffers; SHOW work_mem;` together with the EC2 instance RAM.
