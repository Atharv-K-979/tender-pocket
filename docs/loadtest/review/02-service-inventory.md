# 02 — Backend Service Inventory (Spring Boot)

Scope: every HTTP handler method in `backend/src/main/java/com/tenderpocket/controllers/*.java` at commit `68eb28ae` (branch `load-testing`).
Read-only review. All 14 controller files were read in full.

Path abbreviations used in citations (all repo-relative):

| Prefix | Expands to |
|---|---|
| `controllers/` | `backend/src/main/java/com/tenderpocket/controllers/` |
| `services/` | `backend/src/main/java/com/tenderpocket/services/` |
| `config/` | `backend/src/main/java/com/tenderpocket/config/` |
| `models/` | `backend/src/main/java/com/tenderpocket/models/` |
| `repositories/` | `backend/src/main/java/com/tenderpocket/repositories/` |
| `application.properties` | `backend/src/main/resources/application.properties` |

Labels: **VERIFIED** = read in code; **INFERRED** = reasoned from code (including standard Spring/Hibernate/jjwt behaviour); **UNKNOWN** = cannot be established from code.

## Endpoint counts (VERIFIED, counted `@Get/Post/Put/Patch/DeleteMapping` per file)

| Controller | Class prefix | Handlers |
|---|---|---|
| ActivityLogController | `/api/activity-logs` | 1 |
| AnalyticsController | `/api/analytics` | 2 |
| ApprovalController | `/api/approvals` | 3 |
| AuthController | `/api/auth` | 10 |
| DocumentDownloadController | (none) | 1 |
| HealthController | `/api` | 1 |
| NoticeDeskController | `/api/noticedesk` | 4 |
| ProductCatalogueController | `/api` | 8 |
| SignatureController | `/api/signatures` | 2 |
| SpaForwardController | (none) | 1 (two URL patterns) |
| TenderController | `/api/tenders` | 17 |
| UpdateController | `/api/update` | 3 |
| WorkflowController | `/api/tenders` | 14 (13 distinct method+path; `approve-clearance` has a JSON and a multipart handler) |
| WorkflowSyncController | `/api/v2/workflow` | 13 |
| **Total** | | **80 handler methods** |

Non-controller HTTP surfaces (VERIFIED):
- `/documents/**` static resource handler mapped to local disk (`config/WebConfig.java:20-25`), `permitAll` (`config/SecurityConfig.java:66`).
- `/tenders/**` view controller forward to `/index.html` (`config/WebConfig.java:30-33`), which duplicates `SpaForwardController`.
- `ComplianceProgressUiInjectionFilter` rewrites the HTML of `GET /`, `/index.html` and `/tenders/*` responses to inject a `<script>` (`config/ComplianceProgressUiInjectionFilter.java:22-48`).

## Cross-cutting facts that affect every row

- **Auth gate.** `/api/**` requires an authenticated principal; `/api/auth/login` and `/api/health` are `permitAll`; everything outside `/api/**` is `permitAll` (`config/SecurityConfig.java:64-69`). VERIFIED. There is no `@PreAuthorize`/`@Secured` anywhere (grep returned nothing). VERIFIED. Role checks are manual, in-controller, mostly via `config/WorkflowPermissions.java`.
- **Transactions.** `spring.jpa.open-in-view=false` (`application.properties:16`). VERIFIED. Handlers without `@Transactional` therefore run each repository call in its own short transaction and connection checkout. INFERRED (standard Spring Data behaviour).
- **Connection pool.** Hikari `maximumPoolSize=25`, `connectionTimeout=15000ms`, `maxLifetime=60000ms`, `leakDetectionThreshold=60000ms` (`config/DatabaseConfig.java:88-94`). VERIFIED. If PostgreSQL cannot be reached at startup, the app silently falls back to SQLite (pool 10) (`config/DatabaseConfig.java:99-112`). VERIFIED. A load test must confirm which DB is live.
- **Tomcat.** `server.tomcat.connection-timeout=180000`, `spring.mvc.async.request-timeout=180000`, multipart limit 50 MB (`application.properties:70-77`). VERIFIED. Thread-pool size is not set, so the Spring Boot default applies (200). INFERRED.
- **Response post-processing.** `ManufacturerPriceAdvice` runs on every JSON response from `com.tenderpocket.controllers`. When the caller lacks `VIEW_TPC_PRICE` (Tender Executive, Clearance Team, unauthenticated), it converts the whole body into a Jackson tree and walks it recursively (`config/ManufacturerPriceAdvice.java:23-45`). VERIFIED. That is extra CPU proportional to response size for those roles. INFERRED.
- **DB write amplification.** On PostgreSQL, triggers copy every INSERT/UPDATE/DELETE on `tenders`, `users`, `activity_log`, `status_history`, `tender_approval_requests`, `tender_comments`, `tender_workflow_comments`, `user_signatures` and `email_notification_logs` into `db_change_log` as full-row JSONB (`backend/src/main/resources/schema-backup-triggers.sql:33-115`, installed by `config/PostgresBackupInitConfig.java:26-31`). VERIFIED.
- **No optimistic locking.** No `@Version`, `@Lock`, `@DynamicUpdate` or `FOR UPDATE` exists anywhere in `backend/src/main/java`. VERIFIED (grep). Every `save()` writes all columns. INFERRED (Hibernate default). See `04-workflow-map.md` §Concurrency.
- **Jackson naming.** `spring.jackson.property-naming-strategy=SNAKE_CASE` (`application.properties:80`). VERIFIED. Entity and DTO JSON uses snake_case, while ad-hoc `Map` responses keep their literal (mostly camelCase) keys. INFERRED.
- **Background schedulers that can interfere with a test.** GeM and email sync run 15 s after boot and then every 6 h (`backend/src/main/java/com/tenderpocket/scheduler/SyncScheduler.java:22`), plus a daily 08:00 IST run (`:29`, `services/EmailNotificationService.java:55`). An auto-update check runs hourly (`services/AutoUpdateService.java:51`). VERIFIED.

Cost legend (all INFERRED): **low** = O(1) primary-key work; **med** = bounded scan or file I/O; **high** = full-table load, external call, AI/OCR, or N+1 at the 50K–100K tender scale.

---

## AuthController — `/api/auth` (`controllers/AuthController.java:28`)

| Method | Path | file:line | Roles (where enforced) | Request → Response | Sync | Reads / Writes | Deps | Paginated | Cost |
|---|---|---|---|---|---|---|---|---|---|
| POST | `/api/auth/login` | `controllers/AuthController.java:63` | Public (`config/SecurityConfig.java:65`) | `{username,password}` → `{success,token,user{username,role,email}}`; 401 if bad | sync | R `users` (5× `existsById` + 1× `findById`); **W `users`**: on every login, any of the 5 default accounts that is missing is auto-created (`:73-87`) | DB | none | low (6 PK queries + SHA-256) |
| GET | `/api/auth/users` | `:109` | Any canonical role (`VIEW_TENDERS`, `:114`). Non-Admins get a directory only (`:115-125`). Admin gets per-user stats | — → `{success,users[{username,role,email,stats?}]}` | sync | Non-Admin: R `users` findAll. **Admin: R `users` findAll + `tenders` findAll (all columns, `:145`)**, then in-memory stats | DB | none | Admin: **high** (full tender load); others: low |
| POST | `/api/auth/users` | `:203` | Admin (`MANAGE_USERS` `:210`, then a DB role re-check `:222-235`) | `{username,password,role,email?}` → `{success,message}`. **An existing username is overwritten** (password, role and email updated, `:264-277`) | sync | R/W `users`; W `activity_log` | DB | — | low |
| DELETE | `/api/auth/users?username=` | `:296` | Admin (`:303`, `:314-326`); cannot delete `admin` (`:328`) | query param → `{success,message}` | sync | W `users`, `activity_log` | DB | — | low |
| GET | `/api/auth/executives` | `:350` | Any canonical role (`:352`) | → `{executives:[username]}` | sync | R `users` by role ×2 | DB | none | low |
| GET | `/api/auth/roles` | `:364` | Any canonical role (`:366`) | → static list of 6 role strings | sync | none | — | none | low |
| GET | `/api/auth/clearance-team` | `:378` | Any canonical role | → `{clearanceTeam:[...]}` | sync | R `users` by role | DB | none | low |
| GET | `/api/auth/tpc-team` | `:389` | Any canonical role | → `{tpcTeam:[...]}` (role literal `"TPC Team"`) | sync | R `users` | DB | none | low |
| GET | `/api/auth/mis-team` | `:400` | Any canonical role | → `{misTeam:[...]}` | sync | R `users` | DB | none | low |
| GET | `/api/auth/spec-team` | `:411` | Any canonical role | → `{specTeam:[...]}` (role literal `"Specification Team"`) | sync | R `users` | DB | none | low |

## ActivityLogController — `/api/activity-logs` (`controllers/ActivityLogController.java:14`)

| Method | Path | file:line | Roles | Req → Resp | Sync | R/W | Deps | Paginated | Cost |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/activity-logs?action=` | `controllers/ActivityLogController.java:20` | Admin (`VIEW_AUDIT`, `:23`) | → `{logs:[ActivityLog]}` | sync | R `activity_log`, either everything or filtered by action, ordered by timestamp (`:26-28`) | DB | **none** (unbounded) | med→high (grows with every PATCH/upload; no index declared on `activity_log`) |

## AnalyticsController — `/api/analytics` (`controllers/AnalyticsController.java:22`)

| Method | Path | file:line | Roles | Req → Resp | Sync | R/W | Deps | Paginated | Cost |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/analytics` | `controllers/AnalyticsController.java:31` | Any canonical role (`:36`). Executives are scoped to their own tenders, Clearance to spec-assigned tenders; Admin, MIS and TPC see all (`:41-49`) | → `{metrics,deadlines,sectors,authorities,valueBrackets}` | sync | R `tenders`: a 15-column projection over **all rows** for Admin, MIS and TPC (`repositories/TenderRepository.java:37-42`), resolved per row in Java, plus 4 native aggregate queries (deadlines, sectors, authorities, brackets; `:136-207`). The native queries are **not** scoped for Clearance (only `isExec`) | DB | none | **high** at 100K (full projection + 4 GROUP BYs) |
| GET | `/api/analytics/executive-performance` | `:256` | **No `WorkflowPermissions` check.** Scope is chosen from the **client-supplied `x-user-role` header** (`:261`), so any authenticated user sending `x-user-role: Admin` gets the all-tenders path | headers only → `{timeWindows,statusDistribution}` | sync | R `tenders` projection: all rows, or rows for the username taken from the `x-user-username` header | DB | none | high if the header says Admin or MIS Team |

## ApprovalController — `/api/approvals` (`controllers/ApprovalController.java:31`)

Full request-path breakdown: `04-workflow-map.md` §Approval endpoints.

| Method | Path | file:line | Roles | Req → Resp | Sync | R/W | Deps | Paginated | Cost |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/approvals/counts?status=` | `controllers/ApprovalController.java:360` | Admin, MIS Team, Clearance Team, TPC (`isAuthorized` `:76-82`, checked `:365`). **Tender Executive gets 403** | → `{counts,pendingCounts,historyCounts,statusCounts,username,role}` | sync | **Runs `reconcileStaleAndDuplicateApprovals()` first (`:371`)**: R all PENDING approvals, **R all `tenders` (full entity, `:237`)**, then per-tender queries and writes on `tender_approval_requests` and `tenders`. After that, 3 GROUP BY counts plus a global status count (`:383-415`) | DB | none | **high** (O(all tenders) + N+1) |
| GET | `/api/approvals/pending?stage=&search=&status=&team=&role=` | `:498` | Same as `/counts` (`:509`) | → `{approvals:[ApprovalSummaryDto],total}` | sync | Same reconcile (`:515`), then a role-specific approval list query (unbounded; `ALL`/`HISTORY` return every matching row), `findAllById(tenderIds)` (full tenders), and in-memory search/team/role filters (`:580-643`) | DB | **none** | **high** |
| POST | `/api/approvals/{approvalId}/review` | `:666` (`@Transactional` `:667`) | MIS Team (MIS stages), Clearance Team (SPEC_CLEARANCE), TPC (TPC_PRICING). **Admin is explicitly refused (`:675-678`)**. Tender Executive is refused (`:680`). Plus a stage-permission check (`:732`) and a queue-ownership check (`:747-794`) | `{action: APPROVED\|REJECTED\|CHANGES_REQUESTED, comment (required), lossReasonMis?, tpcPurchasePrice?, misFinalPrice?, outcome?, complianceType?, assignedMisMember?, tenderId?, stage?}` → `{success,message,newTenderStage}`; 409 if the tender is at a different stage | sync | R/W `tender_approval_requests`, `tenders`, `tender_workflow_states`, `tender_comments`, `tender_document_manifest` (via WorkflowSyncService) | DB + **filesystem walk** (`services/TenderFolderScannerService.java:78-97`) on SPEC_CLEARANCE and DOC_VERIFICATION approval | none | med (bounded per tender; DOC_VERIFICATION and SPEC_CLEARANCE add a disk walk inside the transaction) |

## DocumentDownloadController (`controllers/DocumentDownloadController.java`)

| Method | Path | file:line | Roles | Req → Resp | Sync | R/W | Deps | Paginated | Cost |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/documents/{id}/{fileName:.+}` | `controllers/DocumentDownloadController.java:15` | Spring Security: `permitAll` (`config/SecurityConfig.java:66`). The handler delegates to `TenderController.downloadDocumentFile`, which requires `VIEW_TENDERS` (`controllers/TenderController.java:2340`), so an anonymous call gets 403. INFERRED. **Deeper paths such as `/documents/{id}/confidential/x.pdf` do not match this pattern and fall through to the static handler with no auth check.** INFERRED from `config/WebConfig.java:20-25` + `permitAll` | → file stream, or 302 to an S3 presigned URL | sync | R `tenders` (only when the name contains `emd_receipt`) | file / S3 | — | med (file I/O) |

## HealthController — `/api` (`controllers/HealthController.java:14`)

| Method | Path | file:line | Roles | Req → Resp | Sync | R/W | Deps | Paginated | Cost |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/health` | `controllers/HealthController.java:20` | Public (`config/SecurityConfig.java:65`) | → `{status,database}` 200/503 | sync | `SELECT 1` | DB | — | low |

## NoticeDeskController — `/api/noticedesk` (`controllers/NoticeDeskController.java:10`)

None of these handlers checks a role. Any authenticated principal is allowed (VERIFIED). State is an in-memory static `ArrayList` (`:13`).

| Method | Path | file:line | Roles | Req → Resp | Sync | R/W | Deps | Paginated | Cost |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/noticedesk/notices` | `:39` | any authenticated | → `{notices}` | sync | in-memory list | none | none | low |
| POST | `/api/noticedesk/fetch-jamku` | `:45` | any authenticated | `{clientCode?}` → fabricated notice | sync | **mutates the static `ArrayList` (not thread-safe, `:59`); grows without bound** | none (no real external call) | — | low (concurrent calls risk `ArrayList` corruption; INFERRED) |
| POST | `/api/noticedesk/classify-issue` | `:65` | any authenticated | `{noticeText}` → keyword classification | sync | none | none | — | low |
| POST | `/api/noticedesk/verify-kanoon` | `:85` | any authenticated | `{citation}` → canned result | sync | none | none (no real external call) | — | low |

## ProductCatalogueController — `/api` (`controllers/ProductCatalogueController.java:18`)

None of these handlers checks a role (VERIFIED). The username comes from the JWT, falling back to the `x-user-username` header (`:40-49`). The class also carries a `@CrossOrigin` for localhost:3000/8085 (`:19`).

| Method | Path | file:line | Roles | Req → Resp | Sync | R/W | Deps | Paginated | Cost |
|---|---|---|---|---|---|---|---|---|---|
| POST | `/api/products/models/upload` (multipart) | `:51` | any authenticated | `file, model_number, make?, product_category, description?` → `{model}` | sync | W `product_models`, `product_spec_items`; file write (`services/ProductCatalogueService.java:94`) | **AI** (`services/ProductCatalogueService.java:115`) called **inside `@Transactional`** (`:69`), so a DB connection is held for the whole AI call. INFERRED | — | **high** |
| GET | `/api/products/models?category=&status=` | `:76` | any authenticated | → `{models,count}` | sync | R `product_models` (+ specs) | DB | none | med |
| GET | `/api/products/models/{id}` | `:84` | any authenticated | → `{model}` | sync | R by id | DB | — | low |
| PUT | `/api/products/models/{id}/specifications` | `:92` | any authenticated | `[ProductSpecificationDto]` → `{model}` | sync | W `product_spec_items` (`@Transactional` `services/ProductCatalogueService.java:183`) | DB | — | low-med |
| POST | `/api/products/models/{id}/verify` | `:108` | any authenticated | `{verified_item_ids?}` → `{model}` | sync | W spec items (`:213`) | DB | — | low |
| DELETE | `/api/products/models/{id}` | `:133` | any authenticated | → `{success}` | sync | W (`:242`) | DB | — | low |
| POST | `/api/tenders/{id}/offered-models` | `:142` | any authenticated | `{selected_model_id?, schedule_models?{}}` → `{success}` | sync | W `tenders` (`:249`) | DB | — | low |
| GET | `/api/tenders/{id}/offered-models` | `:175` | any authenticated | → `{data}` | sync | R `tenders`, `product_models` | DB | — | low |

## SignatureController — `/api/signatures` (`controllers/SignatureController.java:19`)

| Method | Path | file:line | Roles | Req → Resp | Sync | R/W | Deps | Paginated | Cost |
|---|---|---|---|---|---|---|---|---|---|
| POST | `/api/signatures/upload` (multipart) | `:25` | any authenticated. **The username comes from the spoofable `x-user-username` header (default `executive`)** | `file` → `{imageUrl}` | sync | W `user_signatures`; writes `public/images/signatures/<user>_signature.png` **and overwrites the global `public/images/signature.png` (`:46-47`)** | file | — | low-med |
| GET | `/api/signatures/{username}` | `:60` | any authenticated | → `{signature}` | sync | R `user_signatures` | DB | — | low |

## SpaForwardController (`controllers/SpaForwardController.java`)

| Method | Path | file:line | Roles | Req → Resp | Sync | R/W | Deps | Paginated | Cost |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/tenders/{id:[^\.]*}`, `/tenders/**` | `controllers/SpaForwardController.java:13` | Public (`anyRequest().permitAll()`, `config/SecurityConfig.java:68`) | → forward to `/index.html`; the HTML is rewritten by `ComplianceProgressUiInjectionFilter` (buffers the full body) | sync | none | static file | — | low |

## TenderController — `/api/tenders` (`controllers/TenderController.java:44`)

| Method | Path | file:line | Roles | Req → Resp | Sync | R/W | Deps | Paginated | Cost |
|---|---|---|---|---|---|---|---|---|---|
| POST | `/api/tenders/sync-gem` | `:226` | String check (`:229`): Admin, MIS Team, "MIS Executive", Tender Executive. **Clearance and TPC get 403** | → `{success,message}` immediately | **async** (`CompletableFuture.runAsync` on the common pool, `:235`). **No re-entrancy guard**, so each call starts another full scrape (`services/GeMScraperService.java:138-150`). INFERRED | W `tenders` (scraper) | **external HTTP (GeM portal)** | — | **high** (do not include in a load test) |
| POST | `/api/tenders/sync-emails` | `:250` | Same as sync-gem (`:253`) | → `{success,message,importedCount:0}` | **async** (`:259`) | W `tenders` | **IMAP** | — | high (exclude) |
| POST | `/api/tenders/trigger-due-alerts` | `:273` | **No role check at all**; any authenticated principal | → `{success,message}` | **sync**: `processDailyNotifications` runs in the request thread (`services/EmailNotificationService.java:64-66`) | R `tenders` (due today, due in 3 days, unreviewed), R all PENDING approvals, R `users`, W `email_notification_logs` | **SMTP** (up to 3 attempts per recipient with sleeps; `services/EmailNotificationService.java:513-533`) | — | **high** (exclude: sends real email) |
| GET | `/api/tenders?search=&status=&location=&sector=&mis_executive=&minCost=&maxCost=&sortBy=&order=&page=&limit=` | `:286` | Any canonical role (`:302`). Executives see their own tenders (DB-scoped, `:308-309`). Clearance and TPC are filtered in Java after a full load. Admin and MIS see all | → `{tenders[summary copies],totalElements,totalPages,currentPage,filters{locations,sectors}}` | sync | **R `tenders` `findAll()` (full entity, every column) for Admin, MIS, TPC and Clearance (`:313`)**, then a Java loop with status resolution, filtering, sorting and BeanUtils copies; 2 DISTINCT queries for the filter options (`:465-474`) | DB | **manual, in-memory**: `page`/`limit` applied after the full load (`:476-485`); with no `limit` the **whole list is returned** | **high**. Note: the dashboard polls this endpoint without `page`/`limit` every 1.5 s per open session (`frontend/src/app/page.tsx:956-1037`) |
| GET | `/api/tenders/{id}` | `:762` | Any canonical role. Executive: own tender only (`:780-783`). Clearance: assigned or at SPEC_CLEARANCE (`:784-791`). TPC: pricing-related only (`:792-799`). Admin/MIS: any | → `{tender,history:[],summaries}` | sync | R `tenders` by PK | DB | — | low |
| POST | `/api/tenders` | `:831` | Any canonical role **except Admin**: `allowedPatch({"status":…})` returns false for Admin (`:846` + `config/WorkflowPermissions.java:113-120`). Non-Admins may not set workflow or pricing fields (`:837-845`) | Tender JSON (snake_case; `id,title,original_url` required) → `{success,message}`; 409 if the id exists | sync | R/W `tenders` | DB | — | low |
| PATCH | `/api/tenders/{id}` | `:877` | Any canonical role, with **field-level** rules in `WorkflowPermissions.allowedPatch` (`config/WorkflowPermissions.java:102-208`) and assignee checks for approval-status fields (`:1434-1498`). **No ownership check**: any Executive can edit any tender's non-workflow fields | partial map of ~60 snake/camel keys → `{success,message,tender}` | sync, **not `@Transactional`** | R `tenders`; **W `tenders` (all columns, last writer wins)**; W `status_history`, `tender_approval_requests` (assignee sync, WIN_LOSS resolution), `activity_log` | DB (+ disk existence checks via `isBidDocsProvided` `:1766-1783`) | — | low-med (lost-update risk; see 04) |
| DELETE | `/api/tenders/{id}` | `:1602` | MIS Team only (`:1608`) | → `{success}` | sync | W `tenders`, `activity_log`; child approvals and comments **not** deleted | DB | — | low |
| POST | `/api/tenders/{id}/generate-bid-docs` | `:1632` | Tender Executive (`GENERATE_BIDS`, `:1643`); spec must be Approved (`:1663`); no ownership check | `Map<String,String>` template fields → `{downloadUrl,pdfDownloadUrl,status}` | sync | R/W `tenders` (sets `current_stage` to `EMD_PAYMENT` or `DUAL_TRACK`, `:1695`); W `activity_log` | **PDF + DOCX generation** (`services/DocumentGeneratorService`), **file write ×N mirrors** or **S3 upload** (`:138-182`) | — | **high** (CPU + I/O) |
| GET | `/api/tenders/{id}/tech-spec-progress` | `:1785` | Any canonical role | → in-memory progress snapshot | sync | none (in-memory map) | none | — | low (UI polls it every 1 s during upload, `frontend/src/app/page.tsx:1326-1338`) |
| POST | `/api/tenders/{id}/upload-tech-spec` (multipart) | `:1800` | Tender Executive (`UPLOAD_SPEC`, `:1816`); no ownership check; **creates the tender row if the id does not exist (`:1829-1839`)** | `file` (pdf/docx/doc/txt/xlsx/xls ≤ 50 MB) + offeredModel, scheduleNo, … → `{generated,products,pdf/docx/xlsxDownloadUrl,clauseCount,metrics}` | **sync for the whole conversion** (minutes); progress is exposed via the endpoint above | R/W `tenders`; W `activity_log`; files | **AI** (Azure OpenAI primary, Gemini fallback): `services/DocumentGeneratorService.java:1931-1960` starts a **per-request pool of up to 5 threads**; **OCR** fallback up to 60 pages (`:1705-1710`); PDF/DOCX/XLSX render; file/S3 writes; also writes to `~/Downloads` if that directory exists (`:2076-2085`) | — | **very high** |
| POST | `/api/tenders/{id}/generate-tech-specs` | `:2148` | Tender Executive (`:2155`) | `Map` → `{downloadUrl,pdfDownloadUrl,status}` | sync | R/W `tenders`, `activity_log` | PDF+DOCX generation, file/S3 | — | high |
| GET | `/api/tenders/{id}/comments` | `:2233` | Any canonical role | → `{comments}` from `tender_workflow_comments` | sync | R `tender_workflow_comments` by tender_id (no index declared) | DB | none | low-med |
| POST | `/api/tenders/{id}/comments` | `:2240` | Any canonical role | `{comment,phase}` → `{comment}` | sync | W `tender_workflow_comments` | DB | — | low |
| GET | `/api/tenders/stats` | `:2262` | Any canonical role | → `{stats[per executive]}` | sync | R native `status_history JOIN tenders`, **unbounded** (`repositories/TenderRepository.java:92-93`) | DB | none | med→high (grows with status changes) |
| GET | `/api/tenders/documents/{id}/{fileName:.+}` | `:2336` | Any canonical role; files named `emd_receipt*` limited to Admin, the assigned Executive and the assigned/queue MIS member (`:2343-2353`) | → file / 302 presigned | sync | R `tenders` (EMD receipts only) | file / S3 (`exists` + presign per call) | — | med |
| POST | `/api/tenders/{id}/upload-emd-receipt` (multipart) | `:2432` | No `WorkflowPermissions` gate. Admin refused (`:2448`). Allowed: the assigned Executive (or any Executive if none assigned) and MIS (assigned, queue, or unassigned) via `isAuthorizedForEmdReceipt` (`:733-760`) | `file` → `{emd_receipt_doc_path}` | sync | W `tenders` | file / S3 | — | med |

## UpdateController — `/api/update` (`controllers/UpdateController.java:11`)

None of these handlers checks a role. **Any authenticated user can trigger a JVM exit** (VERIFIED: `services/AutoUpdateService.java:132-147`, which calls `System.exit(0)` after 1.5 s when an update jar is present).

| Method | Path | file:line | Roles | Req → Resp | Sync | R/W | Deps | Paginated | Cost |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/update/status` | `:17` | any authenticated | → version/update map | sync | none | none | — | low |
| POST | `/api/update/check` | `:22` | any authenticated | → result | sync | writes `TenderPocket-update.jar` if found | **external HTTP (api.github.com + jar download)** (`services/AutoUpdateService.java:56-117`) | — | high (exclude) |
| POST | `/api/update/apply` | `:28` | any authenticated | → `{success}` then **process exit** | sync + background thread | writes `.restart_trigger` | process | — | **never call during a load test** |

## WorkflowController — `/api/tenders` (`controllers/WorkflowController.java:29`)

| Method | Path | file:line | Roles | Req → Resp | Sync / Tx | R/W | Deps | Paginated | Cost |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/tenders/{id}/workflow-details` | `:70` | Any canonical role (`:76`). **No per-tender scoping**: any role can read any tender's approval requests and comments | → `{currentStage,status,…,tpcPurchasePrice (null for Executive),approvalRequests,comments}` | sync | R `tenders`, `tender_approval_requests` by tender_id, `tender_comments` by tender_id (neither table declares an index) | DB | none | low-med |
| POST | `/api/tenders/{id}/clearance-request` | `:116` | Tender Executive (`UPLOAD_SPEC`, `:129`); spec status must be Generated, Rejected, Pending or Approved, and downloaded_docs must be non-empty (`:140-145`) | `{assignedClearanceRep?,note?}` → `{success,message}` | sync, `@Transactional` `:117` | W `tenders` (stage `SPEC_CLEARANCE`, spec status `Pending`), upsert of a SPEC_CLEARANCE approval, W `tender_comments` | DB | — | low |
| POST | `/api/tenders/{id}/approve-clearance` (JSON / octet-stream) | `:222` | Clearance Team (`APPROVE_SPEC`, `:259`); spec status must be `Pending` (`:265`); assigned-rep check (`:271-279`) | `{complianceType?,comment?}` → `{complianceType,currentStage,message}` | sync, `@Transactional` `:223` | W `tenders`, `tender_workflow_states`, approvals, comments, `tender_document_manifest` | DB + **disk walk** (via `recordFinalTechSpec` → `scanAndSyncFolder`) | — | med |
| POST | `/api/tenders/{id}/approve-clearance` (multipart) | `:233` | Same | `complianceType, comment, pdfFile?, docxFile?/wordFile?, xlsxFile?/excelFile?` → same | sync, `@Transactional` `:234` | Same, plus writes each uploaded file to **6 directories** (`:183-201`) and deletes old ones (`:204-219`) | file I/O + disk walk | — | med-high |
| POST | `/api/tenders/{id}/tpc-price` | `:511` | **Admin, TPC Pricing Team, MIS Team** (`SET_TPC_PRICE`, `:518`; Admin is allowed by `config/WorkflowPermissions.java:47`); spec Approved and EMD settled (`:526-533`) | `{tpcPurchasePrice,assignedMisMember?/misAssignee?}` → `{success,message}` | sync, `@Transactional` `:512` | W `tenders`, workflow state, TPC/MIS approvals, comments | DB | — | low |
| POST | `/api/tenders/{id}/mis-price` | `:601` | MIS Team (`SET_MIS_PRICE`, `:607`); spec Approved, EMD settled | `{misFinalPrice}` → `{success,message}` | sync, **not `@Transactional`** | W `tenders`, approvals, workflow state, comments | DB | — | low |
| POST | `/api/tenders/{id}/payment-request` | `:666` | **MIS Team only** (`RECORD_PAYMENT`, `:673`), although the code comment and default header say "executive"; requires `verification_status = Approved` (`:691`) | `{assignedMisExecutive?,emdAmount?,transferMode?,transferRefNo?,receiptFileUrl?,comment?}` → `{success,message}` | sync, `@Transactional` `:667` | W `tenders` (stage `PAYMENT_APPROVAL`), approval upsert, comment | DB | — | low |
| POST | `/api/tenders/{id}/doc-verification-request` | `:736` | Tender Executive (`GENERATE_BIDS`, `:743`); spec Approved and EMD settled (`:753-760`) | `{assignedMisExecutive?,workingPath?,comment?,downloadedDocs?}` → `{success,message}` | sync, `@Transactional` `:737` | W `tenders` (stage `DOC_VERIFICATION`, **`working_path` set to an arbitrary client string**), approval upsert, comment | DB | — | low (but see the disk-walk note in 04) |
| POST | `/api/tenders/{id}/submission-request` | `:803` | **MIS Team only** (`RECORD_SUBMISSION`, `:810`); payment Approved (`:816`) | `{note?}` → `{success,message}` | sync, `@Transactional` `:804` | W `tenders` (stage `SUBMISSION_PENDING`), approval upsert, comment | DB | — | low |
| POST | `/api/tenders/{id}/win-loss-request` | `:857` | **MIS Team only** (`RECORD_OUTCOME`, `:864`); no stage precondition | `{status?: Won\|Lost, lossReason?}` → `{success,message}` | sync, `@Transactional` `:858` | W `tenders` (stage `WIN_LOSS_PENDING`), approval upsert, comment | DB | — | low |
| POST | `/api/tenders/{id}/review-approval` | `:915` | MIS, Clearance, TPC (`:929-933`) for the stage of the **latest** request (`:943-946`); Admin refused (`:924`); queue ownership (`:954-965`) | `{action?(default APPROVED),comment?,lossReasonMis?,tpcPurchasePrice?,misFinalPrice?,outcome?}` → `{success,message,currentStage}` | sync, `@Transactional` `:916` | Same write set as `/api/approvals/{id}/review` | DB + disk walk (DOC_VERIFICATION, SPEC_CLEARANCE) | — | med |
| POST | `/api/tenders/{id}/unable-to-submit` | `:1172` | **MIS Team only** (`RECORD_OUTCOME`, `:1178`) | `{reason?}` → `{success,message}` | sync, **not `@Transactional`** | W `tenders` (stage `UNABLE_TO_SUBMIT`, status `Missed Opportunity`), inserts an approval with status `SUBMITTED`, comment | DB | — | low |
| GET | `/api/tenders/{id}/workflow-comments` | `:1200` | Any canonical role | → `{comments}` from `tender_comments` | sync | R `tender_comments` | DB | none | low-med |
| POST | `/api/tenders/{id}/workflow-comments` | `:1208` | Any canonical role | `{commentText}` → `{comment}` | sync | R `tenders`, W `tender_comments` | DB | — | low |

## WorkflowSyncController — `/api/v2/workflow` (`controllers/WorkflowSyncController.java:28`)

None of these handlers is `@Transactional`; each delegates to a `@Transactional` method in `services/WorkflowSyncService.java`. The role comes from `canonicalRole` (`:45-53`). **There are no ownership checks and almost no stage preconditions** (VERIFIED: only `final-submission` checks `canFinalSubmit`).

| Method | Path | file:line | Roles | Req → Resp | Sync | R/W | Deps | Paginated | Cost |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/v2/workflow/{tenderId}/state` | `:60` | Any canonical role | → step, statuses and prices (TPC price masked for Executive; EMD receipt path masked) | sync | R `tender_workflow_states`; **W: lazily INSERTs a state row on first GET** (`services/WorkflowSyncService.java:46-137`); R `tenders` | DB | — | low (write on GET) |
| GET | `/api/v2/workflow/{tenderId}/manifest` | `:122` | Any canonical role; confidential files hidden unless MIS or Admin | → `{documents[...],totalCount,verifiedCount}` | sync | **W `tender_document_manifest` on every GET** (`scanAndSyncFolder` saves one row per file, `services/TenderFolderScannerService.java:148`) | **disk walk** of `{uploadDir}/{id}` and the tender's `working_path` | none | med→high (depends on `working_path`) |
| POST | `/api/v2/workflow/{tenderId}/assign-executive` | `:165` | MIS Team (`:170`) | `{executive}` → `{state}` | sync | W `tenders` (`mis_executive`, status Participating), state step 2. **Does not change `tenders.current_stage`** | DB | — | low |
| POST | `/api/v2/workflow/{tenderId}/spec-clearance` (multipart) | `:196` | Clearance Team (`:208-211`). **No `Pending` precondition** (unlike `/approve-clearance`) | `file?/pdfFile?, docxFile?/wordFile?, xlsxFile?/excelFile?, complianceType, remarks?` → `{message,currentStage,finalTechSpec}` | sync | file writes to 6 directories; W `tenders`, state, approvals, comments, manifest | file I/O + disk walk | — | med-high |
| POST | `/api/v2/workflow/{tenderId}/bid-docs-prep` | `:389` | Tender Executive (`:394`) | `{workingPath?}` → `{currentStep,stepName,isEmdSkipped}`; NPE → 500 if the tender is missing (`:401`). INFERRED | sync | W `tenders` (`working_path` = client string), state, approvals (dual track if exempt), comments, manifest | **disk walk of the client-supplied path** | — | med→high |
| POST | `/api/v2/workflow/{tenderId}/emd-applicability` | `:415` | Tender Executive (`:420`) | `{applicable\|emdApplicable}` → `{state}` | sync | W `tenders`, state, approvals (dual track), comments | DB | — | low |
| POST | `/api/v2/workflow/{tenderId}/emd-payment` (multipart) | `:447` | Tender Executive (`:456`) | `beneficiaryName, amount?, mode?, receiptFile?` → `{state}` | sync | file write to `public/documents/{id}/confidential/` (**served unauthenticated via `/documents/**`**, INFERRED); W `tenders`, state, PAYMENT_APPROVAL approval, comments, manifest | file + disk walk | — | med |
| POST | `/api/v2/workflow/{tenderId}/verify-document/{manifestId}` | `:489` | MIS Team (`:494`) | — → `{document}` | sync | W `tender_document_manifest` (no check that manifestId belongs to tenderId) | DB | — | low |
| POST | `/api/v2/workflow/{tenderId}/verify-all-documents` | `:504` | MIS Team (`:509`) | `{remarks?}` → `{trackBDocStatus,canFinalSubmit}` | sync | W tenders, state, manifest (all rows), approvals, comments | disk walk | — | med |
| POST | `/api/v2/workflow/{tenderId}/reject-documents` | `:527` | MIS Team (`:532`) | `{remarks?}` → `{trackBDocStatus}` | sync | W tenders, state, approvals, comments | DB | — | low |
| POST | `/api/v2/workflow/{tenderId}/route-pricing` | `:553` | Tender Executive, MIS Team, **Admin** (`:558`) | `{route: TPC\|MIS, misMember?/assignedMisMember?}` → `{pricingRoute,trackAPricingStatus,state}` | sync | W tenders (stage `TPC_PRICING` or `MIS_PRICING`), state, deletes and creates approvals, comments | DB | — | low |
| POST | `/api/v2/workflow/{tenderId}/commercial-go-ahead` | `:595` | MIS Team (`:600`) | `{finalPrice}` → `{trackAPricingStatus,canFinalSubmit}`; NumberFormatException → 500 on a non-numeric price (`:605`). INFERRED | sync | W tenders, state, approvals, comments | DB | — | low |
| POST | `/api/v2/workflow/{tenderId}/final-submission` | `:624` | Tender Executive (`:629`); state `canFinalSubmit` must be true (`:634`) | `{ackDocPath?}` → `{state}` | sync | W tenders (status Submitted, stage `WIN_LOSS_PENDING`), state, WIN_LOSS approval, comments | DB | — | low |

---

## Frontend (Next.js) API routes

Produced by the frontend reviewer; merged here. The Next.js server is a second service tier in front of Spring: most routes proxy, some run local SQLite / Chromium / Python / OCR work.

Scope: `frontend/src/app/api/**/route.ts` at commit 68eb28ae (branch `load-testing`). Next.js 16.2.6 / React 19.2.4 (`frontend/package.json`). Read-only review; nothing was executed.

Labels: **VERIFIED** = read in code; **INFERRED** = reasoned from code; **UNKNOWN** = not determinable from the repo (says what would settle it).

### Summary counts (VERIFIED)

- 37 `route.ts` files, 48 exported HTTP method handlers.
- 29 files (39 handlers) are **pure pass-through** via `proxyToBackend()` (`frontend/src/lib/backendProxy.ts`).
- 4 files (4 handlers) call the Spring backend with **their own `fetch`** (not `backendProxy.ts`): `sync-emails`, `compliance-progress-client`, `tech-spec-progress`, `tech-spec-download`.
- 3 files (3 handlers) **touch the local SQLite DB directly** (`frontend/src/lib/db.ts`), mixed with file-system, backend and/or external calls: `upload-emd-receipt`, `generate-bid-docs`, `documents/[...filename]` (the last one also reaches SQLite through `scraper.ts`).
- 1 file (1 handler) is **pure local compute**, with no backend and no DB: `preview-doc`.
- There is no `proxy.ts`/`middleware.ts` (Next 16 renamed Middleware to Proxy: `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`). Nothing gates `/api/*` before the handlers run (VERIFIED: neither file exists in `frontend/` or `frontend/src/`).
- No route exports `dynamic`/`revalidate`/`fetchCache`. In Next ≥15, GET handlers are dynamic by default (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md:669`), so **nothing is cached**. All backend fetches use `cache: 'no-store'` (`backendProxy.ts:50`, `technicalSpecificationBackend.ts:64`, `sync-emails/route.ts:21`).

### Route table

Abbreviations: `P(x)` = `proxyToBackend(request, x)`. "Backend lands at" gives the Spring mapping this reviewer found (`backend/src/main/java/com/tenderpocket/controllers/...`). "Auth here" means a check done inside the Next handler. For pure proxies the only enforcement is the backend `JwtRequestFilter` plus per-controller `WorkflowPermissions` (`SecurityConfig.java:65-68` makes `/api/**` authenticated, except `/api/auth/login` and `/api/health`). Cost is INFERRED.

| # | Method | Path | file:line | What it does | Auth/role check performed here | Paginated? | Cost (INFERRED) |
|---|---|---|---|---|---|---|---|
| 1 | GET | /api/activity-logs | `frontend/src/app/api/activity-logs/route.ts:3` | (a) P(`/api/activity-logs?…`) → `ActivityLogController.java:20` | none (header pass-through) | No. Backend returns all logs (`ActivityLogController.java:28`) | med→high (grows with log table) |
| 2 | POST | /api/activity-logs | `activity-logs/route.ts:8` | (a) P(`/api/activity-logs`). **No backend POST mapping** (controller has GET only, `ActivityLogController.java:20`), so likely 405 (INFERRED) | none | n/a | low |
| 3 | GET | /api/analytics | `analytics/route.ts:3` | (a) P(`/api/analytics?…`) → `AnalyticsController.java:31` (whole-table projection `findAllForAnalytics`, `AnalyticsController.java:~48`) | none | No | med (**polled every 1.5 s by every dashboard user**) |
| 4 | GET | /api/approvals/counts | `approvals/counts/route.ts:3` | (a) P → `ApprovalController.java:360` | none | n/a (aggregates) | med |
| 5 | POST | /api/approvals/{id}/review | `approvals/[id]/review/route.ts:3` | (a) P → `ApprovalController.java:666` | none | n/a | med (workflow write) |
| 6 | GET | /api/approvals/pending | `approvals/pending/route.ts:3` | (a) P → `ApprovalController.java:498`. Params are stage/search/status/team/role; no page/limit | none | **No** | med |
| 7 | GET | /api/auth/executives | `auth/executives/route.ts:3` | (a) P → `AuthController.java:350` | none | No | low |
| 8 | POST | /api/auth/login | `auth/login/route.ts:3` | (a) P → `AuthController.java:63`. Backend runs 5 `existsById` seed checks before `findById` + `passwordEncoder.matches` on every login (`AuthController.java:73-90`) | none (public) | n/a | low-med (see backend reviewer for encoder cost, `SecurityConfig.java:29`) |
| 9 | GET | /api/auth/mis-team | `auth/mis-team/route.ts:3` | (a) P → `AuthController.java:400` | none | No | low |
| 10 | GET | /api/auth/spec-team | `auth/spec-team/route.ts:3` | (a) P → `AuthController.java:411` | none | No | low |
| 11 | GET | /api/auth/users | `auth/users/route.ts:3` | (a) P → `AuthController.java:109` | none | No | low |
| 12 | POST | /api/auth/users | `auth/users/route.ts:8` | (a) P → `AuthController.java:203` | none (UI gate only: `page.tsx:851`) | n/a | low |
| 13 | DELETE | /api/auth/users?username= | `auth/users/route.ts:12` | (a) P → `AuthController.java:296` | none (UI gate only: `page.tsx:899`) | n/a | low |
| 14 | GET | /api/compliance-progress-client | `compliance-progress-client/route.ts:5` | (a′) own fetch via `fetchSpecificationBackend` to backend static `/compliance-progress.js` (`backend/src/main/resources/static/compliance-progress.js`). Response is `no-store` (`:14`). **Loaded on every full page load** from `layout.tsx:19` | none. Forwards whatever role/token it finds (`technicalSpecificationBackend.ts:49-57`). Backend path is public (`SecurityConfig.java:66` `"/*.js"`) | n/a | low per call, but one per page view, uncached |
| 15 | POST | /api/preview-doc | `preview-doc/route.ts:4` | (c) local CPU only: HTML template rendering (`documentTemplates.ts`). No DB, no backend | **none at all** | n/a | low-med CPU (body-controlled size) |
| 16 | POST | /api/process-email | `process-email/route.ts:3` | (a) P(`/api/process-email`). **No backend mapping found** (grep of `backend/src/main/java`), so likely 404 (INFERRED). UI caller `handleImportSubmit` (`page.tsx:1129`) is not wired to any form (INFERRED: only reference is its definition) | none | n/a | low |
| 17 | GET | /api/products/models/{id} | `products/models/[id]/route.ts:3` | (a) P → `ProductCatalogueController.java:84` | none | n/a | low |
| 18 | DELETE | /api/products/models/{id} | `products/models/[id]/route.ts:11` | (a) P → `ProductCatalogueController.java:133` | none | n/a | low |
| 19 | PUT | /api/products/models/{id}/specifications | `products/models/[id]/specifications/route.ts:3` | (a) P → `ProductCatalogueController.java:92` | none | n/a | low |
| 20 | POST | /api/products/models/{id}/verify | `products/models/[id]/verify/route.ts:3` | (a) P → `ProductCatalogueController.java:108` | none | n/a | low |
| 21 | GET | /api/products/models | `products/models/route.ts:3` | (a) P → `ProductCatalogueController.java:76` | none | UNKNOWN (backend params not reviewed) | low-med |
| 22 | POST | /api/products/models/upload | `products/models/upload/route.ts:3` | (a) P (multipart, buffered via `request.formData()`, `backendProxy.ts:33-34`) → `ProductCatalogueController.java:51` | none | n/a | med-high (upload + backend parsing) |
| 23 | POST | /api/tenders/{id}/approve-clearance | `tenders/[id]/approve-clearance/route.ts:3` | (a) P (JSON or multipart with up to 3 files) → `WorkflowController.java:222/233` | none | n/a | med (multipart) |
| 24 | POST | /api/tenders/{id}/clearance-request | `tenders/[id]/clearance-request/route.ts:3` | (a) P → `WorkflowController.java:116` | none | n/a | low-med |
| 25 | GET | /api/tenders/{id}/comments | `tenders/[id]/comments/route.ts:3` | (a) P → `TenderController.java:2233` (`findByTenderIdOrderByCreatedAtAsc`) | none | No | low per call (**polled every 1.5 s on the detail page**) |
| 26 | POST | /api/tenders/{id}/comments | `tenders/[id]/comments/route.ts:11` | (a) P → `TenderController.java:2240` | none | n/a | low |
| 27 | GET | /api/tenders/{id}/documents/{...filename} (also `/documents/:id/:filename*` via rewrite, `next.config.ts:8-14`) | `tenders/[id]/documents/[...filename]/route.ts:9` | **mix (b)+(c)**: (1) if the filename contains "receipt", reads SQLite `SELECT * FROM tenders WHERE id=?` (`:47-48`, dynamic import of db.ts). (2) Probes 5 local dirs with sync `fs.existsSync/statSync/readdirSync` (`:76-109`). (3) If not found locally: backend `GET {BACKEND_URL}/documents/{id}/{file}` with no timeout (`:129-133`), then either a 302 pass-through (`:137`) or a fully buffered body (`:140`). (4) Otherwise **live GeM download**: up to 3 `axios.get` to `bidplus.gem.gov.in`, 15 s timeout each (`:164-179`). (5) Then the **Tender247 scraper** `downloadAndSaveTenderDocuments` (`:196`, `scraper.ts:1446`): Tender247 API calls (10 s timeouts, `scraper.ts:1475-1561`), file downloads, ZIP extraction, SQLite reads and an `UPDATE tenders` (`scraper.ts:1461,1516,1697,1779,1838`), and possibly **synchronous OCR** via `execSync` pdftotext/pdftoppm/tesseract (`scraper.ts:1863,1893,1916`). (6) Finally `fs.readFileSync` of the whole file into memory (`:232`) | `getAuthFromRequest` (`:12`). That check can be forged; see auth.ts below. Extra EMD-receipt rule (`:43-73`) uses non-canonical role strings | n/a | **very high on a cache miss** (external I/O plus event-loop-blocking `execSync` OCR). Med on a hit (sync FS plus full file buffered) |
| 28 | POST | /api/tenders/{id}/generate-bid-docs | `tenders/[id]/generate-bid-docs/route.ts:285` | **mix (b)+(c)**: backend `GET /api/tenders/{id}` with no timeout (`:325`). SQLite fallback `SELECT * FROM tenders WHERE id=?` (`:335-336`) and sync `UPDATE tenders SET spec_verification_status…` (`:353-360`). Sync `execSync` python `extract_tender_specs.py`, 20 s timeout (`:128-131`), else sync `pdftotext`/zlib PDF parse (`:49,60`). **Launches a new headless Chromium per request** (`puppeteer.launch`, `:211`). Sync `execSync` python `generate_bid_docx.py` with **no timeout** (`:266`), falling back to `HTMLtoDOCX` (`:516`). Writes files to `public/documents/{id}` (`:450-518`). SQLite `UPDATE tenders SET downloaded_docs, current_stage, payment_status` (`:566-573`). Backend `PATCH /api/tenders/{id}` with 10 s abort (`:577-625`). SQLite `INSERT INTO activity_log` (`:629` → `db.ts:286-296`) | `workflowActor(request,'generateBids')` (`:289`). **If that fails, falls back to the raw `x-user-role` header** (`:293-301`), which bypasses even `REQUIRE_JWT_AUTH=true`. `canPerform` allows only `Tender Executive` (Admin returns early at `workflowAuthorization.ts:32-34`) | n/a | **very high** (Chromium launch, blocking child processes, FS writes) |
| 29 | POST | /api/tenders/{id}/generate-templates | `tenders/[id]/generate-templates/route.ts:3` | (a) P. **No backend mapping found** (backend has `/{id}/generate-tech-specs`, `TenderController.java:2148`, not `generate-templates`), so likely 404 (INFERRED). No UI caller found | none | n/a | low |
| 30 | POST | /api/tenders/{id}/mis-price | `tenders/[id]/mis-price/route.ts:3` | (a) P → `WorkflowController.java:601` | none | n/a | low-med |
| 31 | GET | /api/tenders/{id}/offered-models | `tenders/[id]/offered-models/route.ts:3` | (a) P → `ProductCatalogueController.java:175` | none | No | low |
| 32 | POST | /api/tenders/{id}/offered-models | `tenders/[id]/offered-models/route.ts:11` | (a) P → `ProductCatalogueController.java:142` | none | n/a | low |
| 33 | GET | /api/tenders/{id} | `tenders/[id]/route.ts:3` | (a) P → `TenderController.java:762` (findById plus summaries) | none | n/a | low-med per call (**polled every 1.5 s on the detail page**) |
| 34 | PATCH | /api/tenders/{id} | `tenders/[id]/route.ts:11` | (a) P → `TenderController.java:877` | none (the field-level rules in `forbiddenPatchFields`, `workflowAuthorization.ts:103`, are **not used by any Next route**) | n/a | med (workflow write) |
| 35 | DELETE | /api/tenders/{id} | `tenders/[id]/route.ts:19` | (a) P → `TenderController.java:1602` | none | n/a | low |
| 36 | GET | /api/tenders/{id}/tech-spec-download/{filename} | `tenders/[id]/tech-spec-download/[filename]/route.ts:9` | (a′) own fetch `GET {BACKEND_URL}/documents/{id}/{file}` (`:16-17`), streamed back (`:20`). Backend `/documents/**` is **permitAll** (`SecurityConfig.java:66`) | `workflowActor(request,'viewTenders')` (`:11`): passes for **any** recognised role (`workflowAuthorization.ts:31`) and is forgeable | n/a | med (file stream) |
| 37 | GET | /api/tenders/{id}/tech-spec-progress | `tenders/[id]/tech-spec-progress/route.ts:9` | (a′) own fetch → `TenderController.java:1785`. Rewrites download URLs (`technicalSpecificationBackend.ts:104`). Logs every non-NOT_STARTED poll (`:16-18`) | `workflowActor(…,'viewTenders')` (`:11`), forgeable. Backend also checks the forwarded JWT | n/a | low per call, but **polled at 2 req/s per uploading user** (see journeys doc) |
| 38 | POST | /api/tenders/{id}/tpc-price | `tenders/[id]/tpc-price/route.ts:3` | (a) P → `WorkflowController.java:511` | none | n/a | low-med |
| 39 | POST | /api/tenders/{id}/upload-emd-receipt | `tenders/[id]/upload-emd-receipt/route.ts:10` | **mix (b)+(c)**: buffers the whole file (`:28,48-49`). **Writes it synchronously to up to 5 directories** (`:52-67`). SQLite `UPDATE tenders SET emd_receipt_doc_path=?, emd_receipt_confidential=1` (`:73-78`). Forwards multipart to backend `/api/tenders/{id}/upload-emd-receipt` with no timeout, errors swallowed (`:97-104`; backend `TenderController.java:2432`). SQLite `INSERT INTO activity_log` (`:108` → `db.ts:286`) | `getAuthFromRequest` (`:15`), forgeable. Then `auth.role === 'Tender Executive'` exact string (`:36-43`). **Local side-effects happen even if the backend rejects the token**, and the response is `success:true` regardless (`:117`) | n/a | high (upload × 5 sync writes) |
| 40 | POST | /api/tenders/{id}/upload-tech-spec | `tenders/[id]/upload-tech-spec/route.ts:3` | (a) P multipart (buffered `formData()`, `backendProxy.ts:34`) → `TenderController.java:1800`. Backend conversion is synchronous (comment `technicalSpecificationBackend.ts:60-61`). Proxy fetch has no explicit timeout (`backendProxy.ts:46`) | none | n/a | **very high** (long-running AI/document conversion. The backend reviewer has the cost) |
| 41 | GET | /api/tenders | `tenders/route.ts:3` | (a) P(`/api/tenders?…`) → `TenderController.java:286`: `findAll()` (or `findByMisExecutive`) + in-memory filter/sort + 2 DISTINCT queries. Paginates only if `limit` is sent (`TenderController.java:306-313,477-484`), **and the UI never sends `limit`** | none | **Not in practice** (optional `page`/`limit`) | **high** (whole table per call, **polled every 1.5 s by every dashboard user**; Admin polls it twice per tick) |
| 42 | POST | /api/tenders | `tenders/route.ts:8` | (a) P → `TenderController.java:831` | none | n/a | low |
| 43 | GET | /api/tenders/stats | `tenders/stats/route.ts:3` | (a) P → `TenderController.java:2262` (`findStatusHistoryStats`) | none | n/a | med (**polled every 1.5 s for Admin and MIS Team**) |
| 44 | POST | /api/tenders/sync-emails | `tenders/sync-emails/route.ts:4` | (a′) own fetch `POST {BACKEND_URL}/api/tenders/sync-emails` with a **3 s abort** (`:9-22`; backend `TenderController.java:250`). On timeout or non-JSON it **returns a fake `success:true, importedCount:0`** (`:34-38`) | `workflowActor(…,'viewTenders')` (`:6`), forgeable. Any role. Backend checks the JWT | n/a | high on the backend (IMAP/email sync), cut off at 3 s on the Next side |
| 45 | POST | /api/tenders/sync-gem | `tenders/sync-gem/route.ts:3` | (a) P → `TenderController.java:226` (GeM portal sync), no timeout | none | n/a | **high** (external GeM scraping on the backend) |
| 46 | GET | /api/v2/workflow/{...path} | `v2/workflow/[...path]/route.ts:3` | (a) P(`/api/v2/workflow/…`) → `WorkflowSyncController.java:60,122` (`state`, `manifest`). **Drops the query string** (`:8`) | none | n/a | low-med |
| 47 | POST | /api/v2/workflow/{...path} | `v2/workflow/[...path]/route.ts:12` | (a) P → `WorkflowSyncController.java:165-624` (assign-executive, spec-clearance, emd-applicability, verify-all-documents, reject-documents, route-pricing, …). UI also calls `/{id}/action` (`tenders/[id]/page.tsx:3933`), which has **no backend mapping** (INFERRED 404) | none | n/a | med |
| 48 | PUT | /api/v2/workflow/{...path} | `v2/workflow/[...path]/route.ts:21` | (a) P. No PUT mapping found in `WorkflowSyncController` (INFERRED 404/405) | none | n/a | low |

(Rows number handlers, not files. 48 handlers in 37 files.)

### `backendProxy.ts` (VERIFIED unless marked)

- Backend URL: `process.env.BACKEND_URL || 'http://localhost:8090'`, read once at module load (`frontend/src/lib/backendProxy.ts:3`). The same env var is re-read inline in `sync-emails/route.ts:7`, `upload-emd-receipt/route.ts:84`, `documents/[...filename]/route.ts:115`, `generate-bid-docs/route.ts:318`, and validated in `technicalSpecificationBackend.ts:31-44` (rejects a BACKEND_URL that points back at the frontend origin).
- Forwards only `authorization`, `x-user-role`, `x-user-username` (`:15-22`), plus `Content-Type` for text bodies (`:39`). **Cookies are not forwarded.** So a token that exists only as a cookie or `?token=` is lost for proxied routes (INFERRED: only `technicalSpecificationBackend.ts:51-57` and the document/EMD routes promote cookie/query tokens to a Bearer header).
- Body handling: multipart is fully parsed and buffered via `request.formData()` (`:33-34`) and re-encoded by `fetch`. Other bodies are read fully with `request.text()` (`:36`). **No streaming**, so memory per in-flight upload ≈ file size × 2 (INFERRED).
- Response handling: fully buffered with `response.json()` or `response.text()` (`:55,58`), so **binary responses would be corrupted** (none of the proxied routes appear to return binary: INFERRED).
- **No timeout / AbortSignal** on the backend fetch (`:46-51`). The client abort is not propagated either. Effective timeout is Node/undici defaults (UNKNOWN for this Node version. Check the runtime Node version and undici `headersTimeout`/`bodyTimeout`). Long backend calls such as `upload-tech-spec` and `sync-gem` hold a Next request open for their full duration.
- No connection pooling/keep-alive configuration. The global `fetch` (undici) default agent is used (INFERRED).
- On exception it returns HTTP 500 `{success:false,error}` (`:61-67`), so backend unavailability shows up as 500, not 502/503.

### `db.ts` (local SQLite, not the Spring DB) (VERIFIED unless marked)

- Engine: **better-sqlite3** (synchronous, in-process), file `process.env.DATABASE_PATH || <cwd>/tenders.db` (`frontend/src/lib/db.ts:1,5`). It is **not a connection pool**: one `Database` handle per Node process (`:14-21`). There is no `busy_timeout`, `journal_mode` (WAL) or pragma configuration anywhere in the file. better-sqlite3's default busy timeout applies (UNKNOWN exact value for the installed version. Check `node_modules/better-sqlite3` docs).
- **Every query blocks the Node event loop** (synchronous driver, INFERRED from library semantics). Under load, any route touching db.ts stalls all other in-flight Next requests in that process for the query duration.
- Module import side effects run on first import in each process: `CREATE TABLE/TRIGGER IF NOT EXISTS` for 7 tables (`:24-174`), 6 data-migration `UPDATE`s on every start (`:115-124`), ~46 `ALTER TABLE` attempts (`:227-252`), and **user seeding that overwrites the password hashes of 5 default users on every cold start** (`:260-276`; SHA-256 unsalted, `:255-257`). So the first request in a cold process pays this cost (INFERRED).
- Tables written by Next routes: `tenders` (`upload-emd-receipt/route.ts:73`, `generate-bid-docs/route.ts:353,566`, `scraper.ts:1779,1838`) and `activity_log` (`db.ts:286-296`). Read: `tenders` (`documents/[...filename]/route.ts:48`, `generate-bid-docs/route.ts:335`, `scraper.ts:1461,1516,1686,1697`). The `status_history` insert triggers fire on `tenders` updates (`db.ts:85-112`).
- INFERRED: this SQLite DB is a **second, divergent store**. The Spring backend has its own DB (`backend/.../config/DatabaseConfig.java`, `PostgresBackupInitConfig.java`: exact engine for the backend reviewer). Writes here (EMD receipt path, bid-doc metadata, activity log) are best-effort mirrors. `generate-bid-docs` also PATCHes the backend (`:606`). `upload-emd-receipt` forwards the file (`:97`).
- With more than one Next instance/process sharing a `tenders.db` file, concurrent writers would contend on the SQLite file lock (INFERRED. Deployment topology UNKNOWN).
- Dead code: `frontend/src/lib/approvalsSync.ts` and `frontend/src/lib/gemSyncEngine.ts` import db.ts but are imported by nothing (VERIFIED by grep of `src/`). `ProductCatalogue.tsx` is also not imported anywhere.

### `auth.ts` and `workflowAuthorization.ts` (server side) (VERIFIED unless marked)

- Token extraction order (`frontend/src/lib/auth.ts:18-46`): `Authorization: Bearer`, then the `?token=` / `?auth=` query param (`:26`), then the `token` / `auth_token` cookie (`:39`).
- Verification (`auth.ts:57-126`): HMAC HS256/384/512 with `process.env.JWT_SECRET || '<REDACTED>…'` (`:5`). The backend signs with `jwt.secret=${JWT_SECRET:<REDACTED>}` (`backend/src/main/resources/application.properties:19`). **The two defaults differ**, so unless the same `JWT_SECRET` env is given to both processes, every real token fails the local signature check.
- **Signature-mismatch branch accepts the token anyway** (`auth.ts:85-93`). If the signature does not match, it decodes the payload and returns `{sub, role}` **without checking signature, `exp` or `nbf`**. This branch runs before the `REQUIRE_JWT_AUTH` check (`:99`), so **any forged JWT-shaped string with an HS* header and `{sub, role}` payload is accepted by every Next-side check, even with `REQUIRE_JWT_AUTH=true`**.
- Header fallback (`auth.ts:107-123`): without a token (and unless `REQUIRE_JWT_AUTH === 'true'`), `x-user-username` + `x-user-role` headers are trusted if the role is in a fixed list (`:113-120`).
- `workflowAuthorization.ts`: `canonicalRole` (`:7-26`) maps aliases. `canPerform` (`:28-49`) returns true for `viewTenders`/`viewAudit` for any recognised role (`:31`). Admin may only `manageUsers`/`viewTpcPrice`/`setMisPrice` (`:32-34`), so the later `|| canonical === 'Admin'` clauses (`:37,39,40`) are dead. `workflowActor` (`:51-55`) wraps `getAuthFromRequest`.
- Client-side token storage (`frontend/src/app/page.tsx`): `localStorage.token` + `localStorage.currentUser` set on login (`:1966-1968`). A non-HttpOnly, non-Secure, session-lifetime cookie `token=…; path=/; SameSite=Lax` (`:1970`) is re-written on every `fetchWithAuth` call (`:161`) and on mount (`:547`). Logout clears localStorage but **not the cookie** (`:934-939`).
- Expiry: there is no client-side `exp` check (mount only checks presence, `page.tsx:541-557`). The backend default lifetime is `jwt.expiration=${JWT_EXPIRATION:315360000}` seconds, i.e. **10 years** (`application.properties:20`, used at `JwtUtil.java:70`). A 401 on non-workflow URLs clears the session (`page.tsx:168-182`). The tender detail page has no 401 handling (`tenders/[id]/page.tsx:325-346`).
- Role derivation:
  - **Client:** `currentUser.role` comes from the login response stored in localStorage (user-editable). It drives tab visibility and is sent as `x-user-role` / `x-user-username` on every call (`page.tsx:155-156`, `tenders/[id]/page.tsx:328-329`).
  - **Backend:** the role comes from the verified JWT (`JwtRequestFilter.java:28-54`, `TenderController.java:200-208`).
  - **Next routes:** the role comes from the JWT payload (possibly unverified) or the headers (above).

### Routes where authorization is client-only or absent (flags)

1. **No auth at all, server-side:** `POST /api/preview-doc` (`preview-doc/route.ts:4`) is an unauthenticated CPU endpoint (template rendering of an attacker-sized body). `GET /api/compliance-progress-client` (`compliance-progress-client/route.ts:5`) serves a public static JS (acceptable, but uncached).
2. **Next-side auth that can be forged, guarding local side-effects that never reach backend auth:**
   - `GET /api/tenders/{id}/documents/{…}`. Local files are served after only `getAuthFromRequest` (`:12`), and a cache miss triggers GeM, Tender247 and OCR work (`:164-196`). The backend `/documents/**` it falls back to is itself `permitAll` (`SecurityConfig.java:66`).
   - `POST /api/tenders/{id}/generate-bid-docs` with the raw-header fallback (`:293-301`). A request with `x-user-role: Tender Executive` and no token runs Chromium and python, and writes files plus SQLite. The backend GET/PATCH just fail (`:325-331,614-616`).
   - `POST /api/tenders/{id}/upload-emd-receipt` writes 5 files plus SQLite plus activity_log before/independently of backend auth (`:52-115`).
   - `GET /api/tenders/{id}/tech-spec-download/{file}` proxies to the backend `/documents/**`, which is `permitAll`.
3. **Client-only gates (server relies entirely on the backend):** the Team/Audit/Work-summary/Approvals tabs and user create/delete are gated only in React (`page.tsx:2304,2314,2324,2359,851,899`). Every proxied route does **no** Next-side check (rows marked "none"), so correctness depends wholly on backend `WorkflowPermissions` (backend/RBAC reviewer to confirm per endpoint). `forbiddenPatchFields` (`workflowAuthorization.ts:103`) and `redactManufacturerPricing` (`:192`) are imported by no route (VERIFIED by grep). Their server-side equivalents, if any, live in the backend.
4. Tokens in URLs: `getDocDownloadUrl` appends `?token=<JWT>` to document links (`page.tsx:186-192`), which `auth.ts:26` accepts. The JWT therefore ends up in access logs, browser history and Referer headers (INFERRED).

### Open questions / UNKNOWN

- Which frontend is deployed: the Next server (`next start`, so these route handlers run) or the Spring-served static export in `backend/src/main/resources/static` (route handlers don't exist there and `/api/*` hits Spring directly)? Settle via deployment manifests/Dockerfiles/reverse-proxy config. None of those were reviewed here.
- Whether `JWT_SECRET` is set identically for Next and Spring in production, and whether `REQUIRE_JWT_AUTH=true` is set. Check env/deployment config. (Even if both are set, the mismatch branch at `auth.ts:85-93` still accepts forged tokens.)
- Node/undici default timeouts for `proxyToBackend` (no explicit timeout). Check the runtime Node version.
- Number of Next processes/instances sharing `tenders.db`, and the better-sqlite3 version/busy timeout.
- Backend mappings for `POST /api/process-email`, `POST /api/tenders/{id}/generate-templates`, `POST /api/v2/workflow/{id}/action`, `PUT /api/v2/workflow/*` and `POST /api/activity-logs` were not found. Confirm with the backend inventory (expected 404/405).
- Whether `python3`, `pdftotext`, `pdftoppm`, `tesseract` and a Chromium binary exist in the production image. This decides which `generate-bid-docs` and document-OCR branches actually run.
- Payload sizes (row counts of `tenders`, `activity_log`, approvals) are not knowable from code. Get production row counts.

---

## Load-test triage from this inventory (INFERRED)

1. **Exclude (destructive or external side effects):** `POST /api/update/apply` (JVM exit), `POST /api/update/check` (GitHub), `POST /api/tenders/sync-gem` (GeM), `POST /api/tenders/sync-emails` (IMAP), `POST /api/tenders/trigger-due-alerts` (SMTP), `DELETE /api/auth/users`, and `POST /api/auth/users` with an existing username (overwrites that user's password).
2. **Must include (high read cost that scales with tender count):** `GET /api/tenders` (full table on every dashboard poll), `GET /api/approvals/counts`, `GET /api/approvals/pending` (full-table reconcile on every call), `GET /api/analytics`, `GET /api/auth/users` as Admin, `GET /api/tenders/stats`, `GET /api/activity-logs`.
3. **Include at low rates with stubbed providers:** `POST /api/tenders/{id}/upload-tech-spec` (AI/OCR, minutes per call, 5 threads per call), `POST /api/products/models/upload` (AI inside a DB transaction), `generate-bid-docs` and `generate-tech-specs` (CPU-heavy document rendering).
4. **Concurrency probes:** `POST /api/approvals/{id}/review` racing on the same id; racing Track A and Track B approvals on the same tender; `PATCH /api/tenders/{id}` racing an approval. Details in `04-workflow-map.md`.

## Open questions / UNKNOWN

- UNKNOWN: whether the production DB has indexes on `tender_approval_requests(tender_id, stage, status, assigned_to)`, `tender_comments(tender_id)`, `tender_workflow_comments(tender_id)`, `activity_log(action, timestamp)` or `status_history(tender_id)`. No entity or SQL in the repo declares them (VERIFIED for `models/*.java` and `backend/src/main/resources/*.sql`). `ddl-auto=update` does not add indexes that are not declared. Needs `\d+` on the target DB.
- UNKNOWN: whether the target environment runs PostgreSQL or the silent SQLite fallback (`config/DatabaseConfig.java:99-112`). Check the startup log line `[DatabaseConfig] Configured PostgreSQL DataSource successfully.`
- UNKNOWN: whether `aws.s3.enabled=true` in the target environment, which changes the cost of the document endpoints. Check the deployment env.
- UNKNOWN: the actual Tomcat thread count and JVM heap in deployment. Neither is set in `application.properties`; check the container or JVM flags (`DEPLOYMENT.md` was not trusted over code).
- UNKNOWN: the real latency of the Azure OpenAI and Gemini providers. Load tests should stub them; the code sets a 30 s connect and 180 s read timeout (`services/AISpecificationIntelligenceService.java:996-997`).
- UNKNOWN: the frontend API route set and its direct DB access (`frontend/src/lib/db.ts`); another reviewer covers this.
