# 12 — Existing test, seed, fixture and benchmark assets

Scope: branch `load-testing` @ `68eb28ae`, tracked files plus notable gitignored local files in the working tree (marked **[local, gitignored]**). Labels: **VERIFIED** / **INFERRED** / **UNKNOWN**. Binary files were listed, not read.

## 1. Headline answers

- **Load-test tooling in the repository (tracked): none.** No k6, Locust, JMeter (`.jmx`), Gatling, Artillery, autocannon or wrk script exists in tracked files, and no such file name appears anywhere in git history (`git log --all --name-only`). VERIFIED.
- **Historical 50K / 100K results or scripts: not in the repository.** VERIFIED for tracked files and history. The only prior benchmark material is **gitignored local** output in `frontend/scratch/` (section 2), and it states that 50,000 and 100,000-tender tiers were **intentionally not executed** (`frontend/scratch/optimized_benchmark_final_report.md:269-271`). The k6 scenario script, dataset manager and raw k6 JSON it references live only on an EC2 host path `/home/ubuntu/tender-pocket/artifacts/load-test/run-20261029-benchmark/` (`…final_report.md:227-249`) — not in this repo (UNKNOWN whether still on that host).
- `DEPLOYMENT.md:115` gives a planning workload (20–30k historical tenders, 15–30 active users) — a statement, not a result.

## 2. Prior 17-user benchmark artefacts **[local, gitignored by `.gitignore:30` `scratch/`]**

| File | What it is | External/DB access | Reusable? |
|---|---|---|---|
| `frontend/scratch/optimized_benchmark_final_report.md` (21 KB) | Report of a 17-VU k6 run at 100 / 1k / 5k / 10k tenders on an "isolated testing EC2", DB `tender_pocket_isolated_uat` (`:32-38`), dated runs 2026-10-29. Claims pre/post "optimization" (DB-level pagination of `GET /api/tenders`, `:44-60`). | — | **Partly** — useful as a baseline narrative and acceptance criteria. **Conflict (VERIFIED):** it says the optimized build was "68eb28ae (modified working tree)" (`:32-33`); HEAD `TenderController.java:307-313` still uses unpaginated `findAll()`, so the "optimized" numbers do **not** describe committed code. It also claims scrapers/AI/e-mail/backups were "strictly disabled" (`:38`) though HEAD has no switch for `SyncScheduler`. |
| `frontend/scratch/optimized_benchmark_complete_matrix.json` (74 KB) | Machine-readable results: keys `generated_at` (2026-10-29 18:09:49 UTC), `environment` (`ec2_host`, `git_commit`, `database`, `vus`, `workload_script`), `tiers` 100/1000/5000/10000, `individual_runs` (per-endpoint p50/p95/p99, RPS, resources). | — | **Yes** as a comparison baseline (same 17-VU shape). |
| `frontend/scratch/execute_optimized_matrix.py` (505 lines) | Orchestrator meant to run **on the EC2 host**: `docker stats` sampling (`:51-53`), `docker exec … psql` (`:88`, `:112-119`), dataset scaling via `reversible_dataset_manager.py set-target` (`:127-128`), `k6 run` (`:211`), targets an EC2 IP at `:358`, `:479`. | Host Docker + Postgres directly; **destructive** dataset pruning via `set-target`. | **Partly** — good template for resource sampling and tiering; must not be run as-is (hard-coded host, depends on missing `benchmark_17users.js` / `reversible_dataset_manager.py`). |
| `frontend/scratch/endpoint_stats.py`, `inspect_matrix.py` | Pretty-printers for the matrix JSON (hard-coded path from another machine, `:3`). | — | Yes (trivial). |
| `frontend/scratch/e2e-role-test.cjs` (12 KB), `verify-premerge.cjs` (9.6 KB) | Role-based HTTP smoke tests against a hard-coded UAT base URL (`e2e-role-test.cjs:4`, `verify-premerge.cjs:4`) with plaintext account passwords (`e2e-role-test.cjs:6-12` — secret values present in working tree, not reproduced here). | Remote UAT over HTTP | **Partly** — the per-role request list is reusable as a scenario catalogue; credentials/URL must be replaced. |

Note: the two hosts named in these files (orchestrator target vs UAT URL) differ; which one is EC2-1 vs EC2-2 is UNKNOWN.

## 3. Backend JUnit tests — `backend/src/test/java/com/tenderpocket/` (25 classes, VERIFIED)

None uses `@SpringBootTest`/`@WebMvcTest`; they are Mockito or plain unit tests (no app context, no DB).

| Class (lines, @Test count) | Covers | External / DB | Reusable for load testing |
|---|---|---|---|
| `controllers/TenderControllerTest` (1344, 67), `TenderControllerStorageTest` (311, 13), `ApprovalControllerTest` (158, 5), `ApprovalControllerWorkflowTest` (362, 9), `WorkflowControllerClearanceTest` (136, 3), `AnalyticsControllerTest` (219, 5) | controller logic with mocked repositories | none | **No** (no HTTP), but useful to learn request shapes/roles per endpoint |
| `config/WorkflowPermissionsTest` (202, 6) + `src/test/resources/workflow-permissions.json` | role → action matrix | none | **Partly** — authoritative role/permission matrix for building the 17-user role mix |
| `services/EmailSyncServiceTest` (606, 17) + `src/test/resources/fixtures/email-*.eml/.html` (6 pairs, 18–20 KB each) | Tender247 e-mail parsing | none (mocked) | **Partly** — fixtures are realistic e-mail payloads; not needed unless `process-email` is in scope |
| `services/EmailNotificationServiceTest` (694, 14) | digest grouping/dedupe | none (mocked) | No |
| `services/GeMScraperDeduplicationEnrichmentTest` (194, 6), `GeMScraperServiceStorageTest` (109, 2) | GeM dedupe/storage | none (mocked) | No |
| `services/PostgresBackupServiceTest` (322, 16), `S3ObjectStorageServiceTest` (206, 13), `LocalStorageServiceTest` (75, 4) | backup/storage | none (mocked) | No |
| `services/SinglePassComplianceTest` (389, 18) | spec conversion with a **local stub Azure server** (`:109-121`, `com.sun.net.httpserver` on 127.0.0.1 `/responses`) | local stub only | **Yes (pattern)** — shows how to run conversion against a fake `AZURE_OPENAI_ENDPOINT`; basis for an AI stub during load tests |
| `services/ComplianceSheetConversionTest` (1059, 32) | conversion pipeline; one live benchmark gated by `RUN_LIVE_GEMINI=true` + `TENDER_SAMPLE_PDF` (`:993-1013`, prints `[LiveBenchmark]`) | **Gemini (live) when enabled** | Partly — single-request latency probe, not load |
| `services/TechnicalOnlyLiveTest` (68, 1) | live run gated by `RUN_LIVE_LOW_REASONING=true` (`:29`) | **Azure/Gemini (live) when enabled** | No |
| `services/GenerateRecentTenderPdfTest` (236, 1) | reads `../.env`, requires `AZURE_OPENAI_API_KEY`/`ENDPOINT` (`:30-51`), reads `public/documents/<id>/Bid_Document_<id>.pdf` (`:116`) | **Azure (live)** | No (cost); could be adapted as a single-request AI timing probe |
| `services/ExcelSpecificationUploadTest` (432, 11), `SpecificationSheetOutputTest` (385, 14), `CombinedSpecificationSheetTest` (242, 5), `SpecificationProductLabelsTest`, `SpecificationTableCoverageTest`, `SpecificationUploadContractTest`, `SourceRequirementRowsTest`, `TechnicalOnlyDiscoveryTest`, `PortraitPdfReviewTest`, `ProductCatalogueEvidenceMatchingTest`, `utils/TenderClassifierTest` | rendering / parsing / classification | none | No (unit), but `SpecificationUploadContractTest` documents the upload request contract |

Local build output **[local, gitignored by `backend/.gitignore:2`]**: `backend/target/surefire-reports/` (38 files) and test output dirs (`combined-sheet-tests`, `specification-sheet-tests`, …) — previous unit-test runs, not performance data.

## 4. Root `scripts/`

| File | Covers | External / DB | Reusable |
|---|---|---|---|
| `scripts/test_postgres_backup.py` (683) | backup/restore test suite (CI job `.github/workflows/postgres-backup.yml:50-59`) | Postgres directly (`USE_DIRECT_PSQL=1`) | No |
| `scripts/postgres-backup-daily.py` (513), `postgres-backup-monthly.py` (439) | `pg_dump` via `docker exec`, upload to `POSTGRES_BACKUP_S3_BUCKET`, SMTP alert on failure (`:27-37`) | Postgres, **S3**, **SMTP** | No — must not run during a test |
| `scripts/postgres-restore-test.py` (467) | restore into a disposable DB with guardrails, `DROP/CREATE DATABASE` (`:427-460`) | Postgres (destructive on target DB), SMTP | Partly — the guardrail approach is reusable for resetting a load-test DB; do not run unmodified |
| `scripts/generate-pdf.js` (341) | renders `WORKFLOW_SYSTEM_ARCHITECTURE_REVIEW.md` → PDF with Puppeteer | none | No |
| `scripts/crontab.sample` | backup cron sample | — | n/a |

## 5. `frontend/scripts/` (93 tracked files) — `backend/scripts/` is mostly a copy

`backend/scripts/` (66 files): 56 byte-identical to `frontend/scripts/`, 8 differ (`force-sync.js`, `inspect-emails.js`, `reset-today-sync.js`, `send-alerts.js`, `sync-emails.js`, `test-docx-generation.js`, `test-generate-templates.js`, `verify-summaries.js`), 2 backend-only (`compliance-upload.browser.cjs`, `update_templates.py`). VERIFIED by `cmp`. Classification below is by grep of each file for external hosts / DB drivers (VERIFIED), behaviour INFERRED from names and those hits.

| Group | Files | External / DB | Reusable for load testing |
|---|---|---|---|
| **Seeds** | `seed-approvals.js`, `seed-test-approvals.js`, `dedup-approvals.js` | frontend **SQLite** `tenders.db` only | **No** — runtime data lives in Postgres behind Spring; SQLite seeds don't reach it |
| | `seed-workflow-tenders.js` (334) | SQLite + Spring HTTP with **self-minted HS512 JWTs** (`:209-219`) | **Partly** — the token-minting function is a ready way to create per-role tokens for 17 VUs (needs `JWT_SECRET` of the target); data setup goes to SQLite, so only the HTTP part is useful |
| | `seed-complete-approvals.js` (368) | SQLite + Spring login and `/api/approvals/counts` read (`:338-368`) | Partly (login flow example) |
| **Workflow / RBAC tests** | `test-complete-workflow-suite.js` (547): 8-stage lifecycle, locks, rejections, dedupe, cross-role masking; seeds via SQLite deletes/inserts (`:42-47`) then 21 HTTP calls to `BASE_URL` (default `http://localhost:8085`, `:19`) | SQLite + Next.js HTTP | **Partly** — best existing catalogue of the end-to-end workflow request sequence per role; its SQLite seeding is stale vs. the Postgres backend (INFERRED) |
| | `test-workflow-role-http.cjs` (223): spawns real `next start` with an isolated SQLite DB, `REQUIRE_JWT_AUTH=true`, and a **stub Java backend** (`:21-75`) | local only | **Yes (pattern)** — isolates the Next.js hop from Spring; reusable to measure proxy overhead |
| | `test-approvals-center-doc-review.js`, `test-admin-approvals-viewonly.cjs`, `test-admin-view-only-permissions.cjs`, `test-stage-resolve.js`, `test-pipeline-stages.cjs`, `test-mis-participation-assignment.ts`, `test-classification-display.ts` (`npm test`) | SQLite / pure functions | No (functional) |
| | `test-tech-spec-upload.cjs` (551): upload-tech-spec proxy contract with mocked hosts (`frontend.test`, `java.test`) | none (mocked) | Partly — documents upload/progress/download request flow |
| | `compliance-admin-upload.browser.cjs`, `compliance-progress.browser.cjs` (+ backend `compliance-upload.browser.cjs`) | Playwright from `../target/compliance-browser/node_modules` (directory **absent**) against `http://compliance.test` routes | No (missing dependency) |
| **Doc generation (local)** | `test-docx-generation.js`, `test-docx-local.js`, `test-pdf-generation.js`, `test-generate-templates.js`, `test_full_word_gen.ts`, `test_sections.ts`, `test_sig_align.ts`, `test_verify_fix.ts`, `test_word_header_footer.ts`, `test_footer_debug.ts`, `inspect_word_footer.ts` | local files; some call local HTTP | Partly — `test-generate-templates.js`/`test-docx-generation.js` exercise doc-gen endpoints once |
| **Runtime Python (not tests)** | `generate_bid_docx.py`, `extract_tender_specs.py`, `parse-gem-pdf.py` | used by `generate-bid-docs/route.ts` / GeM sync | n/a — part of the system under test |
| **External scraping probes (Tender247)** | `test-api-*.ts`, `test-find-*.ts`, `test-list-*.ts`, `test-search-*`, `test-query-list.js`, `test-key-login.js`, `test-token-header.ts`, `test-rsc.ts`, `decode-next-stream.ts`, `trace-list-page.ts`, `trace-network.ts`, `test-resolve.ts`, `test-tender-scrape.ts`, `test-all-links.ts`, `test-inline-scripts.ts`, `test-parser.ts`, `test-eml-parse.ts`, `test-corrigendum.js`, `download-all-docs.ts`, `test-document-download.ts` | **tender247.com live** | **No** — must not be run during tests |
| **GeM probes / sync** | `sync-gem.js`, `fetch-todays-gem.js`, `test-gem-fetch.js` | **bidplus.gem.gov.in live** + SQLite | **No** |
| **Mail** | `sync-emails.js`, `force-sync.js`, `reset-today-sync.js`, `inspect-emails.js` (IMAP); `send-alerts.js` (SMTP to `MANAGER_EMAIL`); `test-send-alerts.js` (**executes `send-alerts.js`**, `:118`) | **IMAP / SMTP live** | **No** |
| **Migrations / utilities** | `migrate-existing-metadata.ts`, `migrate-tenders-status.js`, `sync-pg-to-sqlite.js` (Spring → SQLite copy), `compile-tender-details.ts`, `inspect-emd.js`, `verify-summaries.js`, font/PDF inspectors (`*.py`) | SQLite / Spring HTTP | No |
| **Cron wrappers** | `cron-sync.sh`, `cron-sync-gem.sh` | run mail + GeM scripts | No |

## 6. Sample data and fixtures (listed, binaries not read)

| File | Size | Possible use |
|---|---|---|
| `frontend/scratch/spec_test.pdf` (tracked) | 362 KB | candidate `upload-tech-spec` payload (content unverified) |
| `frontend/scripts/test-gem-doc.pdf` / `backend/scripts/test-gem-doc.pdf` | 134 KB | GeM bid document — candidate upload / parse payload |
| `frontend/scripts/test-downloaded-doc.pdf` / backend copy | 423 KB | downloaded tender document — candidate upload payload |
| `backend/src/main/resources/static/test-bid-documents.pdf` / `.docx` | 1.0 MB / 8.8 KB | shipped in the backend jar as static files (served publicly under `/` — INFERRED from `SecurityConfig.java:66`) |
| `frontend/template.pdf` | 2.0 MB | bid template reference |
| `frontend/scratch/downloaded-all-docs.zip` | 1.1 MB | Tender247 archive download sample |
| `frontend/scratch/boq_test.csv` | 11 KB | BOQ/spec sample |
| `frontend/compiled_tenders.csv` / `.md` | 24 KB | ~list of real tenders (Tender247 / GeM refs) — could seed realistic titles/authorities |
| `frontend/Untitled.csv`, `frontend/Untitled.numbers` | 3 KB / — | unknown content |
| `frontend/scripts/test-email.eml` (37 KB), `test-gem.html` (134 KB), `trace-output*.txt`, `rsc-stream.txt`, `e2e-output.txt` (13 KB; output of an EML-scrape run, not an HTTP e2e) | — | scraper debugging outputs |
| `backend/src/main/resources/templates/letterheads/*.docx` (4) | — | runtime templates |
| `frontend/scratch/extracted_images/*`, `gem_all_bids.html`, `page*.html` | — | scraping artefacts |
| `frontend/tenders.db` **[local, gitignored by `frontend/.gitignore:46`]** | 152 KB | local SQLite; not representative of Postgres volume |
| `frontend/cron-sync.log` (286 KB), `cron-sync-gem.log` (8.7 MB) (tracked) | — | historical sync logs — show real GeM/mail syncs ran on some machine |
| `WORKFLOW_SYSTEM_ARCHITECTURE_REVIEW.pdf` / `.md` | 1.3 MB | workflow description (stage order / roles) — useful for scenario design |

No `.har` captures, no CSV of user accounts for load, no seed for 10k+ Postgres tenders exists in the repo (VERIFIED).

## 7. What is reusable, in short

1. Role/permission matrix: `backend/src/test/resources/workflow-permissions.json`, `WorkflowPermissionsTest`.
2. Token minting for VUs: `frontend/scripts/seed-workflow-tenders.js:211-216` (HS512 over `{sub, role, iat, exp}`), compatible with `JwtRequestFilter` as long as the target's `JWT_SECRET` is used (INFERRED).
3. Workflow request sequence: `frontend/scripts/test-complete-workflow-suite.js` and the ignored `frontend/scratch/e2e-role-test.cjs`.
4. AI stub pattern: `SinglePassComplianceTest.java:109-121`; Spring stub pattern: `test-workflow-role-http.cjs:21-75`.
5. Prior baseline numbers (with the commit caveat): `frontend/scratch/optimized_benchmark_complete_matrix.json`.
6. Upload payload candidates: `spec_test.pdf`, `test-gem-doc.pdf`, `test-downloaded-doc.pdf`.

## Open questions / UNKNOWN

1. Do `benchmark_17users.js`, `reversible_dataset_manager.py`, `execute_optimized_matrix.py` and the raw k6 JSONs still exist on the host named in the report? → on that host: `ls -la /home/ubuntu/tender-pocket/artifacts/load-test/run-20261029-benchmark/`.
2. Is that host EC2-2, and does `tender_pocket_isolated_uat` still exist there? → `docker exec tender-pocket-postgres psql -U <user> -l`.
3. Which code was the "optimized" image built from (the modified working tree is not in git)? → `git stash list` locally (a stash `41336c56 … pre-loadtest` exists in history), and `docker image inspect` on the host for build time.
4. Do the 17 benchmark accounts named in the report (`…final_report.md:37`) exist in EC2-2's `users` table? → `select username, role from users;` on EC2-2.
5. Content suitability of `spec_test.pdf` / `test-gem-doc.pdf` as AI upload payloads (page count, scanned vs text) → open locally; not read in this review.
