# 01 — Safety checklist: external side effects a load test can trigger

Scope: read-only review of branch `load-testing` @ `68eb28ae`. Labels: **VERIFIED** (read in code), **INFERRED** (reasoned from code), **UNKNOWN** (needs a check on the host). Code/config wins over Markdown; conflicts are recorded. No secret values are reproduced here.

## 0. Summary — kill switches available in code

| # | Side effect | Fires during a test because of | Code-level switch | Risk |
|---|---|---|---|---|
| 1 | Live GeM scraping (bidplus.gem.gov.in) + PDF download + python parse | `SyncScheduler` 15 s after **every** backend start, then every 6 h, plus 08:00 IST; `POST /api/tenders/sync-gem`; Next.js document route on missing file | **None** for the scheduler. Only `gem.*` tuning props. | HIGH |
| 2 | IMAP mailbox mutation (marks mail SEEN) + Tender247 API login | Same `SyncScheduler` run; `POST /api/tenders/sync-emails` | Empty `IMAP_USERNAME` or `IMAP_PASSWORD` → skipped | HIGH if creds present |
| 3 | Real SMTP e-mail to users' addresses in the DB | `EmailNotificationService` 08:00 IST cron; `POST /api/tenders/trigger-due-alerts` (no role check) | Point `SPRING_MAIL_HOST` at a sink / leave creds empty (sends then fail) | HIGH if DB has real e-mails |
| 4 | Paid AI calls (Azure OpenAI gpt-5-nano, Gemini fallback) | `upload-tech-spec`, `generate-tech-specs`, `products/models/upload`, offered-model matching | Empty `AZURE_OPENAI_API_KEY` and `GEMINI_API_KEY`; or `AZURE_OPENAI_ENDPOINT` → stub | HIGH (cost + 12 h key cooldown) |
| 5 | Writes to S3 bucket | Any upload / GeM doc download when `AWS_S3_ENABLED=true` | `AWS_S3_ENABLED=false` (default) | MEDIUM–HIGH if prod bucket |
| 6 | Self-update / process exit | `AutoUpdateService` hourly GitHub check; `POST /api/update/apply` → `System.exit(0)` | None (no flag) | MEDIUM |
| 7 | CI/CD on push of `load-testing` | — | Workflow only triggers on other branches | NONE (VERIFIED) |

---

## (a) GeM integration — real portal, not a stub

**Evidence (VERIFIED)**
- `backend/src/main/java/com/tenderpocket/services/GeMScraperService.java:680` GET `https://bidplus.gem.gov.in/all-bids` to obtain cookie/CSRF; `:624` POST `https://bidplus.gem.gov.in/all-bids-data` per keyword/page; `:203`, `:282` bid documents `https://bidplus.gem.gov.in/showbidDocument/{id}`; `:556-558` download via `RestTemplate` (`:98`, no timeouts configured → INFERRED infinite).
- `:104-136` hard-coded keyword list (130 keywords). `:71-95` tuning: `gem.sort` (default `Bid-Start-Date-Latest`), `gem.max-pages-per-keyword` (15), `gem.stop-after-known` (20), `gem.request-pause-ms` (2500), `gem.first-page-index` (1). None of these appear in `application.properties` → defaults apply. **There is no enable/disable property.**
- `:356` `Thread.sleep(requestPauseMs)` between requests; `:500` `ProcessBuilder("python3","scripts/parse-gem-pdf.py",…)`, `:510` `waitFor()` without timeout; `:212`, `:486-490` uploads PDFs to S3 when S3 is enabled.
- `:577-578` optional outbound proxy via env `HTTP_PROXY_HOST` / `HTTP_PROXY_PORT` (applies only to the `HttpClient` built at `:572`, not to the `RestTemplate` doc downloads — INFERRED from code structure).

**Triggers (VERIFIED)**
1. `backend/src/main/java/com/tenderpocket/scheduler/SyncScheduler.java:22` `@Scheduled(initialDelay = 15000, fixedDelay = 21600000)` → runs **15 s after every backend start** and every 6 h; `:29` cron `0 0 8 * * *` Asia/Kolkata. Both call `performSync()` → e-mail sync `:39` then GeM sync `:47`. `@EnableScheduling` at `backend/src/main/java/com/tenderpocket/TenderPocketApplication.java:14`.
2. `backend/src/main/java/com/tenderpocket/controllers/TenderController.java:226-247` `POST /api/tenders/sync-gem` — roles Admin / MIS Team / MIS Executive / Tender Executive; runs `CompletableFuture.runAsync` (`:235`) with **no concurrency guard** → every call starts another full sync in parallel (INFERRED).
3. Next.js proxy `frontend/src/app/api/tenders/sync-gem/route.ts:4`.
4. Next.js document route `frontend/src/app/api/tenders/[id]/documents/[...filename]/route.ts:162-189`: when a requested PDF is not on local disk and the backend returns non-2xx, it fetches **three live GeM URLs** (`:165-167`, axios 15 s timeout `:179`) and then falls back to the Tender247 scraper (`:192-196` → `frontend/src/lib/scraper.ts:1446` `downloadAndSaveTenderDocuments`, which calls `t247_api.tender247.com`, `:1476-1561`). Also reached via the rewrite `/documents/:id/:filename*` in `frontend/next.config.ts:8-14`.
5. `frontend/src/lib/gemSyncEngine.ts:4` (`syncGeMTenders`) is **not imported by any route** (VERIFIED by grep) → not reachable at runtime.
6. Manual/cron scripts only: `frontend/scripts/sync-gem.js` (`:616`, `:367`, `:417-419`), `frontend/scripts/fetch-todays-gem.js:9`, `:48-49`; wrapper `frontend/scripts/cron-sync-gem.sh:23` (identical copy `backend/scripts/cron-sync-gem.sh`). Hard-codes `/usr/local/bin/node` and pings google.com — macOS/dev-laptop style. Tracked log `frontend/cron-sync-gem.log` (8.7 MB) shows it ran on some machine (INFERRED).

**Risk during load test**: unavoidable live scraping of a government portal after every backend restart (≥130 keywords × ≥1 page × 2.5 s pause ≈ ≥5.4 min, up to 130×15 pages), plus CPU/DB load from python parsing and inserts that distort results; repeated `sync-gem` calls multiply it; document-download scenarios with missing files hit GeM/Tender247 per request.

**Confirm on EC2-2**
- `docker logs tender-pocket-backend 2>&1 | grep -E "\[Scheduler\]|GeM Java Sync Engine|Querying GeM" | tail` (does the startup sync run, and is it reaching GeM?).
- `docker exec tender-pocket-backend env | grep -E '^(GEM_|HTTP_PROXY_)' | cut -d= -f1` (any overrides present — names only).
- `crontab -l; sudo crontab -l; ls /etc/cron.d` — is `cron-sync-gem.sh` / `cron-sync.sh` installed?
- Egress: `docker exec tender-pocket-backend wget -q -T5 --spider https://bidplus.gem.gov.in/all-bids; echo $?` (only if outbound access policy allows a probe; otherwise check the security group / NACL egress rules).

---

## (b) Payment / EMD gateway

**Evidence (VERIFIED)**: no payment-gateway SDK or URL in server code (grep for razorpay/paytm/payu/stripe/ccavenue/billdesk/cashfree/sbi epay in `backend/src`, `frontend/src`, `pom.xml`, `package.json` → no hits). "EMD Payment Gateway" is only a **workflow stage label** (`frontend/src/lib/tenderStatus.ts:7`, `:269`; `frontend/src/app/components/ApprovalsCenter.tsx:116`).
- EMD = receipt file upload + DB state: `TenderController.java:2432` `POST /api/tenders/{id}/upload-emd-receipt`; `backend/src/main/java/com/tenderpocket/controllers/WorkflowSyncController.java:415` `emd-applicability`, `:447` `emd-payment` (stores receipt `emd_receipt_<ts>_…` at `:465`).
- Next.js route `frontend/src/app/api/tenders/[id]/upload-emd-receipt/route.ts:28` reads the whole form into memory, `:65` writes to local disk, `:73` writes SQLite, `:97` forwards to backend.

**Risk**: no money moves. Only disk/S3 growth and DB writes. **Confirm on EC2-2**: none needed for payments; for storage see (e).

---

## (c) E-mail, SMS, push / notifications

**What really sends mail (VERIFIED)** — only three `JavaMailSender` users exist:
1. `backend/src/main/java/com/tenderpocket/services/EmailNotificationService.java:55` `@Scheduled(cron = "0 0 8 * * *", zone = "Asia/Kolkata")` → `processDailyNotifications`; recipients are `users.email` looked up from the DB (`:206`, `:215`), sent at `:521-525` with 3 retries and 1 s/2 s sleeps (`:512-531`). De-duplication per (recipient, tender, type, date, `SENT`) via `email_notification_logs` (`:107`, `:131`, `:155`) — INFERRED: a second trigger the same day skips already-sent items. Also triggered by `TenderController.java:273` `POST /api/tenders/trigger-due-alerts` — **no role check** (any authenticated user), synchronous in the request thread.
2. `backend/src/main/java/com/tenderpocket/services/BackupEmailService.java:22` recipient `app.backup.alert-email` (default `admin@tenderpocket.com`), `:70` — only called from `PostgresBackupService` (`:114`, `:302`, `:342`), which has **no scheduler and no caller** in main code (VERIFIED by grep; only tests call it).
3. `backend/src/main/java/com/tenderpocket/services/AlertEngineService.java:38` `checkAndSendAlerts` — **no caller** (imported but unused in `SyncScheduler.java:3`).
- SMTP config: `backend/src/main/resources/application.properties:42-48` (`SPRING_MAIL_HOST` default smtp.gmail.com, port 465, `SPRING_MAIL_USERNAME`, `SPRING_MAIL_PASSWORD`). Because `spring.mail.host` always has a value, Spring Boot auto-configures `JavaMailSender` (INFERRED); with empty creds the send attempt fails (INFERRED) and is logged as FAILED.
- **IMAP (mailbox mutation)**: `backend/src/main/java/com/tenderpocket/services/EmailSyncService.java:61` skips when `IMAP_USERNAME`/`IMAP_PASSWORD` empty; otherwise opens INBOX `READ_WRITE` (`:93`) and sets `SEEN` (`:135`, `:236`) — real mailbox state change; then logs into Tender247 API (`:398-408`, `:495`). Triggered by `SyncScheduler` (above) and `TenderController.java:250` `POST /api/tenders/sync-emails` (async, no guard) / Next.js `frontend/src/app/api/tenders/sync-emails/route.ts:22`.
- **Nodemailer in Next.js**: `nodemailer` and `imapflow` are dependencies (`frontend/package.json`) but **not imported anywhere under `frontend/src`** (VERIFIED). Used only by scripts: `frontend/scripts/send-alerts.js:8`, `:308-322` (to `MANAGER_EMAIL`, `:17`), run by `frontend/scripts/cron-sync.sh:24`; `frontend/scripts/test-send-alerts.js:118` **executes `send-alerts.js` for real**. IMAP scripts: `sync-emails.js:1`, `force-sync.js:1`, `reset-today-sync.js:3`.
- Root backup scripts send SMTP alerts on failure: `scripts/postgres-backup-daily.py:34-37`, `:308-310` (recipient `BACKUP_ALERT_EMAIL`), same in `postgres-backup-monthly.py:284-286`, `postgres-restore-test.py:216-218`.
- `NoticeDeskController` (`/api/noticedesk/*`) is a mock: in-memory list, no outbound calls (`backend/src/main/java/com/tenderpocket/controllers/NoticeDeskController.java:13`, `:59`).
- **SMS / push / webhooks**: none (grep twilio/msg91/fcm/firebase/webpush/slack/webhook/sms in server code → no hits). VERIFIED.

**Risk**: if EC2-2's DB is a copy of production `users`, the 08:00 IST digest and any `trigger-due-alerts` call e-mail real staff; IMAP sync marks real mail as read.

**Confirm on EC2-2**
- `docker exec tender-pocket-backend env | grep -E '^(SPRING_MAIL_|IMAP_)' | sed 's/=.*/=<set>/'` (presence only).
- `docker exec tender-pocket-postgres psql -U <user> -d <db> -c "select count(*) filter (where email like '%@%') from users;"` and check the domains are test domains.
- `... -c "select sent_date,status,count(*) from email_notification_logs group by 1,2 order by 1 desc limit 10;"` before/after the test.
- Test window must avoid 08:00 IST or have mail disabled.

---

## (d) AI keys and endpoints

| Provider | Env / property | Read at | Endpoint |
|---|---|---|---|
| Azure OpenAI | `AZURE_OPENAI_API_KEY` → `azure.openai.api-key` (`application.properties:61`) | `AISpecificationIntelligenceService.java:36`, env fallback `:1681` | `AZURE_OPENAI_ENDPOINT` (`application.properties:62`), env read first `:1686`; **if empty, hard-coded default** `https://tenderpocket.services.ai.azure.com/api/projects/proj-default/openai/v1` (`:42-43`) + `/responses` |
| Azure model | `azure.openai.deployment` property is read (`:39`) but **ignored** — `getAzureOpenAiDeployment()` always returns `gpt-5-nano` (`:44`, `:1693-1695`) | | |
| Gemini | `GEMINI_API_KEY` → `gemini.api.key` (`application.properties:58`); also read from env `:134`, `:716`, from classpath props `:139-147`, and comma-separated multi-key support `:711-735`; `.env` loader copies it into system props `TenderPocketApplication.java:42-44` | | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=…` (`:1137`); models `:455`, `:1089` |
| Pricing (no calls) | `TECHSPEC_GPT_*`, `TECHSPEC_USD_TO_INR_RATE[_DATE]` (`application.properties:63-67`) | | |

- Call paths (VERIFIED): `TenderController.java:1800` `upload-tech-spec` → `DocumentGeneratorService` (`:1504`, `:1851`, `:1914-1963`, `:2045-2058`); `backend/src/main/java/com/tenderpocket/services/ProductCatalogueService.java:115` (`POST /api/products/models/upload`, `ProductCatalogueController.java:51`) and `:373` (offered-model matching). `TenderController.java:2148` `generate-tech-specs` renders PDF/DOCX from the request body (`:2167`, `:2173`) — no AI call seen there (INFERRED).
- Azure timeouts connect 30 s / read 180 s (`:996-997`); Gemini same (`:1143-1144`). Rate-limited Gemini keys are put on a **12-hour cooldown** in a static map (`:709`, `:805`) — INFERRED: a load test that provokes 429s can disable the shared key for production for 12 h if EC2-2 uses the same key.
- Next.js server code makes **no** AI calls (`@google/generative-ai` unused under `frontend/src`, VERIFIED).
- Code-supported isolation: set `AZURE_OPENAI_ENDPOINT` to a local stub (pattern exists in `backend/src/test/java/com/tenderpocket/services/SinglePassComplianceTest.java:109-121`) and leave `GEMINI_API_KEY` empty. Leaving the endpoint empty with a key set still reaches the real default endpoint.

**Confirm on EC2-2**: `docker exec tender-pocket-backend env | grep -E '^(AZURE_OPENAI_|GEMINI_API_KEY)' | sed 's/=.*/=<set>/'`; confirm `AZURE_OPENAI_ENDPOINT` value is a stub/test resource (show value only to the owner); confirm with the Azure resource owner which deployment/quota the key maps to.

---

## (e) File storage

- Switch `aws.s3.enabled=${AWS_S3_ENABLED:false}` (`application.properties:32`). `LocalStorageService` when false/missing (`backend/src/main/java/com/tenderpocket/services/LocalStorageService.java:14`), `S3ObjectStorageService` when true (`S3ObjectStorageService.java:22`), which **fails startup if bucket name blank** (`:33-34`). Bucket `AWS_S3_BUCKET_NAME` (`application.properties:31`), region `AWS_REGION` default `ap-south-1` (`:30`); credentials `DefaultCredentialsProvider` (`backend/src/main/java/com/tenderpocket/config/AwsS3Config.java:19-33`) → instance role or env keys.
- Local paths: `FILE_UPLOAD_DIR` default `public/documents` (`application.properties:38`), `FILE_TEMPLATE_DIR` (`:39`); static mapping `/documents/**` (`backend/src/main/java/com/tenderpocket/config/WebConfig.java:25-30`). Root compose mounts the named volume `backend_documents` at `/app/public/documents` in **both** backend and frontend (`docker-compose.yml:69-70`, `:95-96`).
- Next.js writes local disk directly: EMD receipts (`upload-emd-receipt/route.ts:65`), generated bid docs and temp JSON (`generate-bid-docs/route.ts:243`, `:266`), GeM/Tender247 on-demand downloads (`documents/[...filename]/route.ts:182`).
- DB backups (not app-triggered): `PostgresBackupService.java:33` `POSTGRES_BACKUP_S3_BUCKET` default `tender-pocket-postgres-backups`, `:210-211` shells out `aws s3 cp`; scripts `scripts/postgres-backup-daily.py:27-28`.

**Risk**: with `AWS_S3_ENABLED=true` and a production bucket/role, load-test uploads and generated docs are written to the production bucket. Local mode fills the EC2-2 volume.

**Confirm on EC2-2**: `docker exec tender-pocket-backend env | grep -E '^(AWS_S3_ENABLED|AWS_S3_BUCKET_NAME|AWS_REGION|FILE_UPLOAD_DIR)'` (bucket name is not a secret but confirm it is a test bucket); `curl -s http://169.254.169.254/latest/meta-data/iam/info` on the host (IMDSv2 token may be needed) to see which role is attached; `df -h` and `docker system df -v | grep backend_documents`.

---

## (f) CI/CD and self-update

- Only workflow: `.github/workflows/postgres-backup.yml:3-7` — `push` to `main`, `fix/postgres-backup`, `feature/postgresql-backup`; `pull_request` to `main`. Runs Python backup tests against an ephemeral Postgres service container on a GitHub runner (`:14-27`, `:50-59`). No deploy step, no repo secrets referenced. **A push of `load-testing` triggers nothing (VERIFIED).** Opening a PR from `load-testing` into `main` would run this test job only (VERIFIED).
- `backend/render.yaml:1-23`: Docker web service, `plan: free`, no `autoDeploy` / `branch` keys. If a Render Blueprint is linked to this repo, Render's default is auto-deploy on the linked branch (INFERRED; whether a Render service exists is UNKNOWN). `backend/src/main/java/com/tenderpocket/config/DatabaseConfig.java:44-45` hard-codes a Render Postgres host rewrite (historical Render usage — INFERRED).
- **AutoUpdateService** (`backend/src/main/java/com/tenderpocket/services/AutoUpdateService.java:51`): `@Scheduled(initialDelay = 10000, fixedDelay = 3600000)` calls `https://api.github.com/repos/{app.update.github-repo}/releases/latest` (`:56`; repo from `application.properties:84`, version `1.0.0` at `:83`). If a newer tag with a `.jar` asset exists it **downloads** it to `./TenderPocket-update.jar` (`:122`). No flag disables it.
- `backend/src/main/java/com/tenderpocket/controllers/UpdateController.java:28` `POST /api/update/apply` → writes `.restart_trigger` and calls `System.exit(0)` after 1.5 s (`AutoUpdateService.java:139-147`) if the jar exists. Protected only by "authenticated" (`SecurityConfig.java:67`), **no role check**. Docker `ENTRYPOINT java -jar app.jar` (`backend/Dockerfile:38`) does not use the downloaded jar; `restart: always` (`docker-compose.yml:26`) restarts the same image (INFERRED). No `git pull`, Watchtower or `.restart_trigger` consumer exists in the repo (VERIFIED by grep).

**Risk**: a fuzzing/crawl-style load script that POSTs to `/api/update/*` can kill the backend; an hourly outbound call + possible jar download occurs during long tests.

**Confirm on EC2-2**: `docker logs tender-pocket-backend 2>&1 | grep AutoUpdate | tail -3`; `docker exec tender-pocket-backend ls -la /app/TenderPocket-update.jar /app/.restart_trigger`; GitHub repo settings → Webhooks / Deploy keys; Render dashboard for any service linked to this repo; on the host `ls ~/.config/systemd/user /etc/systemd/system | grep -i tender`.

---

## (g) Scheduled / background jobs

| Job | Schedule | Evidence | Disable today |
|---|---|---|---|
| E-mail sync + GeM sync | 15 s after boot, then every 6 h (fixedDelay) | `SyncScheduler.java:22` | No flag. IMAP part off when creds empty; GeM part has no switch |
| E-mail sync + GeM sync | 08:00 IST daily | `SyncScheduler.java:29` | as above |
| Daily notification digest (SMTP) | 08:00 IST daily | `EmailNotificationService.java:55` | No flag; mail creds/host only |
| GitHub update check + jar download | 10 s after boot, then hourly | `AutoUpdateService.java:51` | No flag |
| Startup DB migration (ALTER TABLE ×14, UPDATE ×4) | every boot | `TenderPocketApplication.java:52-96` | — |
| Backup-trigger schema re-apply + `db_change_log` seed | every boot (Postgres only) | `backend/src/main/java/com/tenderpocket/config/PostgresBackupInitConfig.java:22-38`, `backend/src/main/resources/schema-backup-triggers.sql` | — |
| `PostgresBackupService.performDailyBackup` etc. | **not scheduled, no caller** | `PostgresBackupService.java:45`, `:251`, `:332` | n/a |
| Host cron: daily backup 02:00, monthly 03:00 on 1st, restore test 05:00 on 1st (IST) | sample only | `scripts/crontab.sample:38`, `:42`, `:46` (file itself says it is not proof of installation, `:25-28`) | `crontab -e` |
| Laptop-style cron wrappers | not in any crontab in repo | `frontend/scripts/cron-sync.sh:23-24`, `cron-sync-gem.sh:23` | — |
| Next.js server timers | none | only client-side `setInterval` in React pages (`frontend/src/app/page.tsx:956`, `:1326`; `frontend/src/app/tenders/[id]/page.tsx:391`, `:1155`) | — |
| `docker-entrypoint.sh` loops | none — just `mkdir` + `exec npm run start` | `frontend/docker-entrypoint.sh:1-11` | — |

- Spring's scheduler is single-threaded by default (no `spring.task.scheduling.*` in code → INFERRED pool size 1): a long GeM sync delays the 08:00 digest and the update check.
- Data-safety note: `scripts/postgres-restore-test.py:427-460` drops/creates a target DB behind `validate_safety_guardrails` — not app-triggered, but must not run against the load-test DB during a test.

**Confirm on EC2-2**: `crontab -l; sudo crontab -l; ls /etc/cron.d; systemctl list-timers --all | grep -i -E 'tender|backup'`; `docker logs --since 10m tender-pocket-backend 2>&1 | grep -E '\[Scheduler\]|\[AutoUpdate\]|EmailNotificationService'`; `TZ=Asia/Kolkata date` to plan around 08:00 IST and 02:00–05:00 IST.

---

## Secrets present in tracked files (names and locations only)

| File:line | Variable | Note |
|---|---|---|
| `backend/src/main/resources/application.properties:6` | `spring.datasource.username` default | secret value present in repo (real-looking default) |
| `backend/src/main/resources/application.properties:7` | `spring.datasource.password` default | secret value present in repo (real-looking default) |
| `backend/src/main/resources/application.properties:19`; `docker-compose.yml:38`, `:94` | `JWT_SECRET` default | secret value present in repo (default used if env unset) |
| `frontend/src/lib/auth.ts:5`; `frontend/scripts/seed-workflow-tenders.js:209` | `JWT_SECRET` fallback | secret value present in repo |
| `frontend/src/lib/db.ts:261-265` | `ADMIN/EXECUTIVE/CLEARANCE/MISTEAM/TPC_DEFAULT_PASSWORD` fallbacks | secret value present in repo |
| `.env.example:18-62`, `frontend/.env.example:14-47` | DB/JWT/SMTP/IMAP/Gemini/seed passwords | values look like placeholders (not verified as live) |
| `.github/workflows/postgres-backup.yml:19`, `:56` | `POSTGRES_PASSWORD`, `PGPASSWORD` | CI-only ephemeral container credential literal |
| `frontend/scratch/e2e-role-test.cjs:6-12` (gitignored, local only) | role account passwords + UAT base URL | secret value present in working tree (not tracked) |

Related: `frontend/src/lib/auth.ts:86-93`, `:104-124` — unless `REQUIRE_JWT_AUTH=true`, Next.js-local routes (generate-bid-docs, upload-emd-receipt, documents) accept an unsigned token's payload or `x-user-*` headers. `REQUIRE_JWT_AUTH` is not set in `docker-compose.yml:90-94`.

## Open questions / UNKNOWN

1. Is EC2-2's DB a copy of production (real `users.email`, real tender IDs)? → `psql … -c "select email from users"` reviewed by owner; check `SPRING_DATASOURCE_URL` host/db name in the backend container.
2. Which of `IMAP_*`, `SPRING_MAIL_*`, `AZURE_OPENAI_*`, `GEMINI_API_KEY`, `AWS_S3_*` are set on EC2-2 → `docker exec tender-pocket-backend env` (names only).
3. Was the GeM scheduler disabled in previous runs? The ignored local report `frontend/scratch/optimized_benchmark_final_report.md:38` claims scrapers/AI/e-mail/backups were "strictly disabled", but HEAD has no switch for `SyncScheduler` → the image on EC2-2 may be built from a modified working tree. Check `docker image inspect tender-pocket-backend` labels/created time and `docker exec tender-pocket-backend unzip -l app.jar | grep SyncScheduler`.
4. Is a host crontab / systemd timer installed for backups or the `cron-sync*.sh` wrappers? → `crontab -l`, `systemctl list-timers`.
5. Does EC2-2 have outbound internet (GeM, Tender247, GitHub, Azure, Gemini, SMTP)? → security-group egress rules / VPC endpoints.
6. Is a Render service or any GitHub webhook linked to this repo? → Render dashboard; repo Settings → Webhooks.
7. Is `frontend/scratch` `execute_optimized_matrix.py` (gitignored, local) or its EC2 copy scheduled anywhere? → check host crontab.
