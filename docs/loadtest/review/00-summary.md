# 00 — Phase 0–1 review summary

**Commit reviewed:** `68eb28aeab5ab8f46ce38a9356967f83290b1a89`, 2026-10-27 14:44 UTC ("fix(spec): detect scans stored as thin image strips"). This is `upstream/main` (anuthibhansali07/tender-pocket), checked out on branch `load-testing`.
**Method:** read-only code review by five parallel reviewers (backend API and RBAC; AI and document generation; data model and queries; infrastructure, safety and observability; frontend). The lead reviewer re-checked a sample of every reviewer's key citations against the code. Nothing was run, no host or database was contacted, and no application file was changed. Secret values found in tracked files are redacted in these documents.
**Scope found:** 80 Spring handler methods across 14 controllers, plus 48 Next.js route handlers across 37 files; 15 Postgres tables; 6 storable roles; no single 8-stage model (16-value stage enum, 7-step v2 state, 7 reviewable approval stages).

## Top 10 findings

| # | Finding | Evidence | Label |
|---|---|---|---|
| 1 | Every `GET /api/approvals/counts` and `/pending` runs a reconcile. It loads **all tenders**, then does **one unindexed approvals query per active tender**, with no transaction (self-invocation) and errors swallowed. It **writes during GETs**. The UI fires it 3× per Approvals page load | `ApprovalController.java:140-352` (`:237`, `:112`, `:349`, calls at `:371,:515`) | VERIFIED |
| 2 | `GET /api/tenders` (list **and** search) calls `findAll()` on every request and does filter, search, sort and paging in Java. Search never reaches SQL | `TenderController.java:313, 349-357, 476-485` | VERIFIED |
| 3 | The UI polls every **1.5 s** with no visibility pause and no overlap guard. Per tab that is 80–160 requests/min on the dashboard (role-dependent) and 80/min on the detail page. Each dashboard tick includes the full-table `GET /api/tenders` with no limit, plus analytics (5 full passes) | `frontend/src/app/page.tsx:950-1040`; `tenders/[id]/page.tsx:384-397` | VERIFIED |
| 4 | No index on `tender_approval_requests`, `tender_comments`, `tender_workflow_comments`, `status_history` or `activity_log`. The schema comes from Hibernate `ddl-auto=update`, with no migrations | 07 §1, §3; `application.properties:10` | VERIFIED (code); DB state UNKNOWN |
| 5 | No optimistic or pessimistic locking anywhere, and full-column updates. Concurrent Dual-Track approvals or PATCHes **silently lose updates**; double-approval succeeds | 04 §4 | VERIFIED (absence); outcomes INFERRED |
| 6 | Spec upload is **synchronous** on the request thread, with a 5-thread AI pool per upload and **no global cap** (17 uploads → up to 85 concurrent Azure calls). The whole PDF is held in heap, and per-call base64 copies make it about 5× the batch size | `TenderController.java:1800-2146`; `DocumentGeneratorService.java:1931` | VERIFIED; memory multiplier INFERRED |
| 7 | The Azure endpoint can be mocked **by env only** (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`). Gemini's URL is hard-coded, and its fallback is serialised JVM-wide (one call per 4 s) | `AISpecificationIntelligenceService.java:1679-1697, 1137, 753-768` | VERIFIED |
| 8 | The UI's bid package is built in **Next.js**. Each request launches a new Chromium and runs `execSync` Python, which blocks the Node event loop and stalls every other request | `generate-bid-docs/route.ts:210-283` | VERIFIED; stall INFERRED |
| 9 | Unswitchable side effects. GeM and IMAP sync run 15 s after every boot and every 6 h, and there is a daily 08:00 IST e-mail digest. `trigger-due-alerts` (real e-mail) and `update/apply` (`System.exit`) are open to **any** authenticated user | `SyncScheduler.java:22,29`; `EmailNotificationService.java:55`; `TenderController.java:273`; `AutoUpdateService.java:142-147` | VERIFIED |
| 10 | The backend silently falls back to **SQLite** if Postgres fails at boot, and health still reports UP. Hikari pool is 25, timeout 15 s, `maxLifetime` 60 s. Heap is `-Xmx3g` in a 5 GB container; frontend and DB containers have no limits | `DatabaseConfig.java:88-113`; `docker-compose.yml:25,32` | VERIFIED |

## Top risks for the breaking-point test
- **Approvals reconcile (finding 1).** Most likely saturates the 25-connection pool first. Its cost scales with *active-workflow* tenders, which fits a flat ~55 s at 50K and 100K, possibly clipped by a ~60 s client or proxy timeout (08 §A, INFERRED).
- **Full-table list, search and analytics under 1.5 s polling (findings 2, 3).** This drives heap and GC pressure on a 3 GB heap, the leading hypothesis for search growing super-linearly from 2.9 s to 8.6 s (08 §B, INFERRED).
- **Positive feedback loop.** Polling has no overlap guard, so in-flight requests multiply once latency passes 1.5 s.
- **Next.js event-loop stalls (finding 8)** will distort latency on unrelated endpoints in mixed runs.
- **AI uploads (finding 6)**: thread and heap exhaustion with no global limit.

## Blockers (must be resolved before any run)
1. **The source of the historical 55 s and 8.6 s figures is unknown.** The only prior benchmark found says the 50K/100K tiers were not run (12 §1–2).
2. **GeM/IMAP scheduler cannot be disabled by config.** It needs a network block, a wait-after-boot rule, or an approved code switch.
3. **E-mail safety.** The EC2-2 `users.email` contents and SMTP settings are unknown (01 §c).
4. **AI.** Needs your approval to point Azure at a mock and to unset Gemini on EC2-2.
5. **DB snapshot and restore.** Approvals reads and reviews mutate the seed, so runs are not repeatable without a restore.
6. **No Postgres seeder in the repo** (the `frontend/scripts/seed-*.js` scripts target SQLite). A realistic seeder must be written in Phase 2 (07 §6).

## Decisions needed from you
These are listed in full in 13 §4. The key ones:
- **Test scope:** the MUST/SHOULD/COULD/EXCLUDE set in 13 §1.
- **Load model:** N tiers; the 17-user role mix; polling tabs or think-time journeys; SLOs that define "breaking point".
- **EC2-2 config changes:** Azure mock; `pg_stat_statements` and GC logging; Tomcat access log.
- **Scheduler handling.**
- **Security findings:** whether to report the out-of-scope ones separately (13 §4 #15).

## Files
`01-safety-checklist.md`, `02-service-inventory.md`, `03-rbac-matrix.md`, `04-workflow-map.md`, `05-ai-extraction-pipeline.md`, `06-document-generation.md`, `07-data-model.md`, `08-query-risk-register.md`, `09-capacity-settings.md`, `10-frontend-journeys.md`, `11-observability.md`, `12-existing-test-assets.md`, `13-test-candidates.md`, and this file.
