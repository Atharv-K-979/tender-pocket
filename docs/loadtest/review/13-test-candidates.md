# 13 — Load-test candidates (decision document)

Commit reviewed: `68eb28aeab5ab8f46ce38a9356967f83290b1a89` (2026-10-27, branch `load-testing`).
Every row draws on files 01–12, which hold the file:line evidence. Labels: **VERIFIED** (read in code), **INFERRED** (reasoned from code), **UNKNOWN** (needs a runtime or EC2-2 check).

Load model facts that shape everything below (all VERIFIED unless marked):
- Browser traffic goes **Next.js (port 8085) → Spring (8090) → Postgres**. 29 of the 37 Next.js route files are thin proxies. A few do their own work: SQLite, Chromium, Python, OCR, and outbound GeM/Tender247 fetches (02, Frontend section).
- **The UI polls every 1.5 s, and every open tab keeps polling** (no visibility pause). On the dashboard that is 80, 120 or 160 requests/min per tab, depending on role; on the tender detail page it is 80/min. The dashboard loop has no overlap guard, so in-flight requests pile up as latency rises (INFERRED). See 10 §0.
- `GET /api/tenders` loads **every tender row** (`findAll()`, `TenderController.java:313`), then filters, searches, sorts and pages in Java. The dashboard poll sends no `limit`. See 08 Q01.
- Every `GET /api/approvals/counts` and `/pending` runs a **reconcile**. It loads all tenders (`ApprovalController.java:237`), then runs one unindexed approvals query per active tender (`:112`) with no transaction (self-call at `:371,:515`), and **writes** to the DB. See 08 §A and 04 §5a.
- There is **no `@Version` and no locking** anywhere, and saves write every column. Concurrent writes to the same tender lose updates silently (04 §4).
- Spec upload runs **synchronously** with AI calls on the request thread, using a 5-thread pool per upload and no global cap (05 §0).

## 1. Catalogue

Column "Driven by": **N** = tender count; **U** = concurrent users (of the 17); **F** = file size or page count; **—** = none.

| # | Service / flow | What to measure | Driven by | Risk of degradation | Cost / side effects | Prerequisites | Rec. |
|---|---|---|---|---|---|---|---|
| C1 | **Dashboard background polling**: `GET /api/tenders` (no limit), `GET /api/analytics`, `GET /api/tenders/stats`, `GET /api/tenders?status=Participating` | p50/p95/p99 per endpoint, RPS, response bytes, backend heap/GC, Hikari wait, CPU | N × U | **H**. A full-table load plus a Java pipeline per call, 2–4 calls per user every 1.5 s. Analytics makes 5 full passes per call (08 Q01, Q13, Q14, Q17) | No external calls. Read-only | Realistic seed (07 §6); per-role users; script that reproduces the 1.5 s tick per role | **MUST**. This is the dominant real load and the main N-driven risk |
| C2 | **Tender search / list with filters**: `GET /api/tenders?search=&status=&…&page=&limit=` | p95 at each N tier (reproduce 2.9 s → 8.6 s), response bytes, GC | N, U | **H**. Search never reaches SQL; every request scans everything (08 §B) | Read-only | Seed at several N tiers; fixed search-term set; record whether `limit` is sent | **MUST** |
| C3 | **Approvals Center**: `GET /api/approvals/counts` + `GET /api/approvals/pending` (3 calls per page load, 2 more after each review) | p95/max per call, pool waits (`Connection is not available…`), dead tuples, duplicate PENDING rows, 5xx rate | N_active (tenders in workflow) × approval rows; U | **H (critical)**. N+1 seq scans over an unindexed table, no transaction, errors swallowed (08 Q04–Q09) | **Writes on GET**: the reconcile changes approval rows and tenders, so the seed is consumed and drifts between runs | Seed with a controlled active-workflow share **scaled with N**; DB snapshot or restore between runs; `pg_stat_statements` | **MUST**. Most likely source of the ~55 s p95 |
| C4 | **Approval review**: `POST /api/approvals/{id}/review` per stage | p95, lock waits, rollbacks (`UnexpectedRollbackException`), correctness (double-apply, lost Dual-Track update) | U; contention with C3 | **M–H**. Transaction holds row locks during seq scans plus a disk walk (08 Q23) | **Consumes state**: each pending approval can be reviewed once; creates comment and approval rows | A pool of distinct PENDING approvals per virtual user, per stage; restore DB after the run | **SHOULD** |
| C5 | **Tender detail page**: `GET /api/tenders/{id}` + `GET /api/tenders/{id}/comments` every 1.5 s; `GET /api/auth/users` on mount | p95; Admin/MIS `auth/users` cost | U (detail), N (`auth/users` does `findAll()`; comments table unindexed) | **M** detail/comments; **H** `auth/users` for admin roles (08 Q18, Q21) | Read-only | Seeded comments per tender | **SHOULD** (as part of journeys) |
| C6 | **Workflow write journey**: clearance-request → approve-clearance → payment-request → tpc-price / mis-price → doc-verification → submission → win-loss; v2 `/api/v2/workflow/{id}/*` steps; `PATCH /api/tenders/{id}` | p95 per step, error rate, end state consistent (stage vs v2 state row) | U | **M**. Mostly per-tender PK work plus unindexed approval lookups; risk is lost updates rather than latency (04 §4b) | **Consumes state**; writes comments, status history, manifests; disk scans in the doc-verification steps | Tenders seeded at each starting stage; one tender per virtual user (no sharing); restore after the run. `approve-clearance` / `spec-clearance` multipart need a sample file | **SHOULD** |
| C7 | **Same-tender concurrency probe**: two users approving the same approval id, Dual-Track A+B at the same time, PATCH during review | Correctness only: duplicates, lost track status, 500s | — (2–3 users) | n/a (correctness, not capacity) | Consumes state | Dedicated tenders | **COULD**. Functional evidence of 04 §4b; small and cheap |
| C8 | **Tech-spec upload (AI extraction)**: `POST /api/tenders/{id}/upload-tech-spec` + `GET …/tech-spec-progress` (1 s polls ×2) | End-to-end time per page count, Tomcat/worker threads, heap, AI calls per upload (`metrics` in the response), failure rate | F (pages, scanned vs text), U | **H**. Synchronous; 5 AI threads per upload with no global cap; about 5× batch size in heap per call; OCR at 200 DPI (05 §0, §14) | **AI spend** (Azure gpt-5-nano), Gemini fallback (rate-limit 12 h cooldown), files written to disk or S3 | **Azure mock** via `AZURE_OPENAI_ENDPOINT` + dummy key; `GEMINI_API_KEY` **unset** in env and property; S3 off or test bucket; a distinct tender id per upload (progress map keyed by tender); sample PDFs (text, scanned, large) | **SHOULD with mock**. Measures the app's own concurrency and memory. **COULD** only as a small, approved real-AI pilot for cost per upload |
| C9 | **Bid package generation (Next.js)**: `POST /api/tenders/{id}/generate-bid-docs` | Its own p95, **plus the latency of all other endpoints while it runs** (`execSync` blocks Node), Chromium/Python CPU and RAM | U | **H**. New Chromium per request plus blocking Python with no timeout (06 §3.1) | Writes files to local disk; SQLite writes; calls only Spring (`GET` + `PATCH /api/tenders/{id}`, `route.ts:325,606`), no third-party call (VERIFIED) | Chromium, Python and pdftotext present in the deployed Next.js image (UNKNOWN); tenders seeded with `spec_verification_status='Approved'`, otherwise the route returns 409 (06 §3.1) | **SHOULD**. Run in isolation first, then a low rate inside the mix |
| C10 | **Activity log**: `GET /api/activity-logs` (admin screen, `page.tsx:813`) | p95 against log size | N (log rows) | **H**. Whole table, unindexed, unpaginated (08 Q19) | Read-only | Seeded activity_log rows (3–8 per tender) | **SHOULD** (low frequency in the mix, measured at each N tier) |
| C11 | **Login**: `POST /api/auth/login` | p95 | U | **L**. SHA-256 compare plus PK lookups; tokens last 10 years | None | 17 test users | **COULD**. Only needed for setup; not a meaningful capacity test |
| C12 | **Document download**: Spring `/documents/{id}/{file}`, Next.js `/api/tenders/{id}/documents/[...filename]`, `tech-spec-download` | Throughput and p95 by file size | F, U | **M**. The Next.js route reads whole files into memory | **External fetch to GeM / Tender247 when a file is missing** (06 §0 #6); redirects break under S3 (INFERRED) | Every referenced file present on disk; S3 setting known | **COULD**, only with files guaranteed present |
| C13 | **EMD receipt / signature / approve-clearance multipart uploads** | p95 by file size | F | **L–M** | Disk or S3 writes; SQLite write (EMD, Next.js) | S3 off or a test bucket | **COULD** |
| C14 | **v2 manifest**: `GET /api/v2/workflow/{id}/manifest` | p95 | Files in `working_path` | **M–H** (disk walk; duplicate manifest rows under concurrency) | Writes manifest rows | Realistic `working_path` directories (UNKNOWN on EC2-2) | **COULD** |
| C15 | **Mixed realistic profile, ramp past 17 to the breaking point** (C1+C2+C3+C5+C6, plus C8 with mock and C9 at low rate) | Max sustainable users or RPS before p95 or error-rate SLO breach; first saturating resource (Hikari, heap/GC, Node event loop, CPU) | U at fixed N (100K) | **H** | Combined side effects of the components | Everything above, plus container metrics sampling | **MUST** |
| C16 | **N-scaling sweep** (C1, C2, C3, C10 at fixed U=17 across several N tiers) | Latency against N curves; flat vs linear vs super-linear | N | **H** | Read-mostly (C3 writes) | Restorable seeds per tier, with the active-workflow share scaled | **MUST** |
| C17 | Product catalogue (`/api/products/models*`, upload calls AI inside a DB transaction) | — | F | M | AI spend | — | **EXCLUDE** for now. The UI tab is removed (08 Q34; 10 §3.5). Revisit if it is re-enabled |
| C18 | Backend-direct `POST /api/tenders/{id}/generate-bid-docs` and `/generate-tech-specs` | — | — | H | **AI call with empty text** (06 §0 #3) | — | **EXCLUDE**. The UI uses the Next.js route instead |
| C19 | `POST /api/tenders/sync-gem`, `POST /api/tenders/sync-emails` | — | — | H | **Live GeM scraping, IMAP marks real mail read, Tender247 login**; unbounded common-pool threads | — | **EXCLUDE** |
| C20 | `POST /api/tenders/trigger-due-alerts` | — | — | — | **Real e-mail to users** (no role check) | — | **EXCLUDE** |
| C21 | `POST /api/update/check`, `POST /api/update/apply` | — | — | — | **GitHub download; `apply` calls `System.exit(0)`** for any authenticated user | — | **EXCLUDE**. Never call |
| C22 | `/api/noticedesk/*` | — | — | L | In-memory mock; `fetch-jamku` mutates a non-thread-safe static list | — | **EXCLUDE** (not a real service) |
| C23 | Scheduled jobs (GeM + IMAP sync 15 s after boot and every 6 h; 08:00 IST digest and sync; hourly AutoUpdate; host pg_dump cron) | — | — | Contend with the test | External calls, e-mail | Disable or keep out of the window (see §3) | **EXCLUDE** from measurement; must be neutralised |
| C24 | `POST /api/preview-doc` (Next.js, no auth), `GET /api/health`, SPA forwards | — | — | L | — | — | **EXCLUDE** (trivial). `/api/health` is useful only as a liveness probe |

## 2. Proposed priority order

1. **C16 N-scaling sweep for C2 and C3** at U=1, then U=17. This reproduces and explains the two historical regressions with the fewest moving parts.
2. **C1 dashboard polling** at U=17, per role mix. This is the actual steady-state load.
3. **C15 mixed profile with ramp to breaking point** at the top N tier. Without AI at first, then with the Azure mock (C8).
4. **C3 + C4 together**: approvals reads during concurrent reviews (lock waits, write churn).
5. **C8 upload concurrency with the Azure mock** (1, 5, 17 parallel uploads × small/large/scanned PDFs).
6. **C9 bid-pack generation** in isolation, then inside the mix (event-loop blocking).
7. **C5, C6, C10** as journey components inside C15, with per-endpoint thresholds.
8. **C7 concurrency probe** (correctness), then **C11–C14** if time allows.

## 3. Cannot be tested safely as-is

| Item | Why | What would make it safe |
|---|---|---|
| Any run on a backend started less than ~15 minutes before the window | `SyncScheduler` (`SyncScheduler.java:22`) starts live GeM scraping and IMAP sync 15 s after boot, and there is **no code switch** (01 §0 #1) | Empty `IMAP_USERNAME`/`IMAP_PASSWORD` stops IMAP only. For GeM: block outbound traffic to `bidplus.gem.gov.in` at the network or security-group level, or wait for `[Scheduler] GeM Sync completed` before starting. A code switch would need your approval (out of scope here) |
| Runs that cross 08:00 IST | The daily digest e-mails `users.email` and the daily sync runs (`EmailNotificationService.java:55`, `SyncScheduler.java:29`) | Schedule the window away from 08:00 IST and point `SPRING_MAIL_HOST` at a sink; use a DB whose `users.email` are not real |
| C8 with real AI | Paid calls; up to 85 concurrent Azure requests at 17 users; a Gemini 429 puts the key into a 12 h cooldown that could affect production if keys are shared | Azure mock via env (05 §17); Gemini key unset. Real AI only as an approved, capped pilot |
| C3/C4/C6 repeated runs on the same DB | The reconcile and the reviews mutate the seed; results drift run to run | Snapshot or restore the DB before every run |
| Anything when the backend is on SQLite | Silent fallback in `DatabaseConfig.java:99-113`; health still reports UP | Check the boot log for `Configured PostgreSQL DataSource successfully` before every run |
| C12 with missing files | The Next.js document route fetches from GeM / Tender247 | Make sure every referenced file exists, or exclude the route |
| Tests with S3 enabled against a production bucket | Uploads and GeM document downloads write to S3 | `AWS_S3_ENABLED=false` or a dedicated test bucket |
| Self-update | `AutoUpdateService` checks GitHub hourly and may stage a jar | Confirm the running image does not auto-apply (01 §f); never call `/api/update/*` |

## 4. Open questions you need to answer before the test plan is final

1. **Source of the historical numbers.** Where do "approval p95 ~55 s at 50K and 100K" and "search p95 2.9 s → 8.6 s" come from: which commit, script, endpoints, VU count, timeout, and error rate? The only prior benchmark found (a gitignored local report, `frontend/scratch/optimized_benchmark_final_report.md`) says the 50K/100K tiers were **not run**, and its "optimized" numbers came from an uncommitted working tree (12 §1–2). If the original k6 script and dataset manager exist on an EC2 host, can we get them?
2. **Which approval endpoint** produced the 55 s: `counts`, `pending` (which `status`/role), or `review`?
3. **Target environment.** Is EC2-2 the target, with which compose file and image, which ports are exposed (8085 only?), and is there an ALB/nginx in front (timeouts)? What instance size, and where does Postgres run?
4. **Database on EC2-2.** Is it a copy of production (real `users.email`)? Can we take and restore snapshots between runs?
5. **Production data shape.** Can we get `SELECT status, current_stage, count(*) FROM tenders GROUP BY 1,2` and the approvals stage/status distribution from production (counts only) to calibrate the seed, especially the **active-workflow share**?
6. **N tiers.** Which tiers do you want (e.g. 10K / 50K / 100K / 200K), and do they need to match the historical 50K/100K exactly?
7. **User model.** Is "17 users" 17 concurrent browser tabs with polling (C1 dominates), or 17 users following journeys with think time? Should hidden tabs be modelled as polling (the code does not pause them)?
8. **Role mix of the 17.** How many Admin, MIS Team, Tender Executive, Clearance Team and TPC Team users? Note the stored role string is `TPC Team`, not "TPC Pricing Team" (03 §1).
9. **SLOs.** What p95 and error-rate thresholds define "breaking point"?
10. **AI.** May we set `AZURE_OPENAI_ENDPOINT` to a mock on EC2-2 and unset `GEMINI_API_KEY` for the test? Do you want a small real-AI pilot for cost per upload, and with what budget cap?
11. **Scheduler.** GeM/IMAP sync cannot be disabled by config. Do you accept a network-level block or wait-after-boot, or do you want a code-level switch added (a separate, approved change)?
12. **Measurement access.** May we, on EC2-2 only: enable `pg_stat_statements`, set `log_min_duration_statement`, add `-Xlog:gc*` to `JAVA_TOOL_OPTIONS`, enable the Tomcat access log via env, and sample `docker stats`? None of these is a code change, but each changes runtime config (11 §8).
13. **Frontend build.** Is the Next.js server (8085) what users hit, or the Spring-served static export (stale build, 10 §6)?
14. **Next.js runtime dependencies.** Does the deployed Next.js image contain Chromium, Python, poppler and tesseract (needed for C9 and C12)?
15. **Security findings.** These are outside load-test scope but found in passing: forgeable-token acceptance in `frontend/src/lib/auth.ts:84-92`, unauthenticated `/api/preview-doc`, `x-user-role` header trust in `generate-bid-docs`, `/documents/**` permitAll, `System.exit` endpoint open to any user, hard-coded fallback secrets in tracked files (01 §Secrets; values redacted in these documents). Do you want these reported separately?
