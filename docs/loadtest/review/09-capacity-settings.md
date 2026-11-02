# 09 — Capacity settings found in code and config

Scope: branch `load-testing` @ `68eb28ae`. Labels: **VERIFIED** / **INFERRED** / **UNKNOWN**. "Not set in code → framework default" is stated only where the default is well known; such defaults are labelled INFERRED because the running container can override them via env.

Topology implied by root `docker-compose.yml` (VERIFIED): `postgres` (no published port) ← `tender-pocket-backend` :8090 (no published port, `:20-77`) ← `tender-pocket-frontend` :8085 published (`:79-98`, `BACKEND_URL` default `http://tender-pocket-backend:8090`, `:93`). Browsers hit Next.js; Next.js route handlers mostly proxy to Spring (`frontend/src/lib/backendProxy.ts:45-51`). Two other compose files exist and differ: `backend/docker-compose.yml` (backend alone, SQLite volume `./tenders.db`, `:17-20`) and `frontend/docker-compose.yml` (Next.js alone, SQLite at `/app/data/tenders.db`, `:14`). Which one EC2-2 uses is UNKNOWN.

## 1. Database connection pools

### 1.1 Spring HikariCP (the only real pool) — VERIFIED
Built by hand in `backend/src/main/java/com/tenderpocket/config/DatabaseConfig.java` (so `spring.datasource.hikari.*` properties would **not** be bound — INFERRED, the bean never reads them):

| Setting | Value | Line |
|---|---|---|
| maximumPoolSize | 25 | `:88` |
| minimumIdle | 5 | `:89` |
| connectionTimeout | 15 000 ms | `:90` |
| idleTimeout | 30 000 ms | `:91` |
| maxLifetime | **60 000 ms** | `:92` |
| keepaliveTime | 30 000 ms | `:93` |
| leakDetectionThreshold | 60 000 ms | `:94` |
| poolName / autoCommit / statement cache | not set → Hikari defaults (INFERRED) | — |

- maxLifetime of 60 s means every connection is retired roughly once a minute (INFERRED: ~25 reconnects/min at full pool, each a TCP + auth handshake to Postgres; SSL is disabled by default URL `?sslmode=disable`, `application.properties:5`).
- **Silent SQLite fallback**: if Postgres is unreachable at startup, `DatabaseConfig.java:99-112` builds a SQLite pool (`maximumPoolSize 10`, `:111`) at `DATABASE_PATH` or `tenders.db`. `/api/health` would still return UP (INFERRED: `HealthController` only runs `SELECT 1`).
- Second "datasource": `createDatabaseIfNotExist` opens a one-off `DriverManager` connection to the `postgres` DB at startup (`DatabaseConfig.java:116-137`); not a pool.
- `PostgresBackupInitConfig.java:25` calls `getConnection()` without closing it → one pool connection leaked per boot (VERIFIED code; INFERRED effect: 24 usable connections, and one Hikari leak warning ~60 s after boot).
- `spring.jpa.open-in-view=false` (`application.properties:16`) → connections are not held for the whole web request (INFERRED).
- `spring.jpa.hibernate.ddl-auto=update` (`application.properties:10`) → schema diff on every boot.

### 1.2 Next.js — no Postgres pool
- `frontend/src/lib/db.ts:1`, `:5`, `:14-15`: **better-sqlite3** (synchronous, single connection, in-process), path `DATABASE_PATH` or `<cwd>/tenders.db`. There is no `pg` dependency (`frontend/package.json`). No `PRAGMA journal_mode`/`busy_timeout` set (VERIFIED by grep) → SQLite defaults (INFERRED).
- Root compose does not set `DATABASE_PATH` for the frontend (`docker-compose.yml:90-94`) → `/app/tenders.db` inside the container, lost on recreate (INFERRED).
- SQLite is used at runtime only by: `generate-bid-docs/route.ts:335`, `:353`, `:566`; `upload-emd-receipt/route.ts:73`; `documents/[...filename]/route.ts` (via `scraper.ts:6`). Every SQLite call blocks the Node event loop (INFERRED, better-sqlite3 is synchronous).

### 1.3 Postgres server
- `max_connections`, `shared_buffers`, `work_mem`: **not set in code** (`docker-compose.yml:2-18` passes no `command:`/config) → image defaults (INFERRED: `max_connections=100`). Pool 25 + backup scripts + psql sessions is well below 100.
- Write amplification: `backend/src/main/resources/schema-backup-triggers.sql:33-73`, `:75-118` — every INSERT/UPDATE/DELETE on 9 business tables copies the full row as JSONB into `db_change_log`. Re-applied on each boot (`PostgresBackupInitConfig.java:28-31`). Nothing in the app prunes it (`PostgresBackupService` is never invoked). **Reconciled by lead reviewer:** whether these triggers exist in the DB is UNKNOWN. `PostgresBackupInitConfig.java:27-30` runs the script through Spring `ResourceDatabasePopulator` with the default `;` separator and `continueOnError=true`; the plpgsql body between `$$` (`schema-backup-triggers.sql:34-71`) contains semicolons, so the function is likely split and fails to create, and the triggers then fail silently (INFERRED). Confirm on EC2-2: `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;`.
- Indexes added by the same script `:157-160`.

## 2. Web server threads and timeouts (Spring Boot 3.4.1 / Tomcat, `backend/pom.xml:9-10`)

| Property | Value | Evidence |
|---|---|---|
| `server.tomcat.threads.max` | not set → 200 (INFERRED Boot default) | absent from `application.properties` |
| `server.tomcat.threads.min-spare` | not set → 10 (INFERRED) | — |
| `server.tomcat.accept-count` | not set → 100 (INFERRED) | — |
| `server.tomcat.max-connections` | not set → 8192 (INFERRED) | — |
| `server.tomcat.connection-timeout` | **180 000 ms** | `application.properties:71` |
| keep-alive timeout | not set → falls back to connection-timeout, i.e. 180 s (INFERRED Tomcat behaviour) | — |
| `server.tomcat.max-swallow-size` | 50 MB | `application.properties:72` |
| `spring.mvc.async.request-timeout` | 180 000 ms | `application.properties:70` (no async controllers seen → little effect, INFERRED) |
| `server.port` | `SPRING_PORT` default 8090 | `application.properties:2` |

## 3. Executors, async work, background threads

- No `@EnableAsync`, no `TaskExecutor`/`ThreadPoolTaskExecutor` beans (VERIFIED by grep).
- `TenderController.java:235`, `:259`: `CompletableFuture.runAsync(...)` with **no executor** → `ForkJoinPool.commonPool()` (parallelism = vCPU − 1), or a new thread per task when the common pool parallelism is < 2 (INFERRED from JDK behaviour; vCPU count of EC2-2 UNKNOWN). Long blocking GeM/IMAP syncs run there.
- `DocumentGeneratorService.java:1931-1932`: per-conversion `newFixedThreadPool(min(5, batches))`, shut down at `:2001-2014`. With N concurrent spec uploads → up to 5N worker threads making Azure calls (INFERRED).
- Spring scheduler: `@EnableScheduling` (`TenderPocketApplication.java:14`), no `spring.task.scheduling.pool.size` → single scheduler thread (INFERRED). See `01-safety-checklist.md (g)`.
- Global AI pacing: `AISpecificationIntelligenceService.java:753-768` — `techspec.min-request-interval-ms` default **4000 ms** guarded by a **static lock** (`:756`) → at most one Gemini request per 4 s across the whole JVM, all users (VERIFIED; applies to the Gemini path `postOnce` `:1136`, not to Azure).
- Gemini key cooldown 12 h (`:805`), inline 429 wait up to 75 s (`:746`).
- GeM pacing 2.5 s between portal requests (`GeMScraperService.java:87-88`, `:356`).

## 4. JVM and Node memory

| Item | Value | Evidence |
|---|---|---|
| Backend `ENTRYPOINT` | `java -jar app.jar` — no flags | `backend/Dockerfile:38` |
| Root compose JVM flags | `JAVA_TOOL_OPTIONS: "-Xmx3g -Xms512m"` | `docker-compose.yml:32` |
| `backend/docker-compose.yml` | no JVM flags → JDK 21 default max heap 25 % of container/host RAM (INFERRED) | `backend/docker-compose.yml:9-16` |
| GC / thread-stack / metaspace flags | not set → JDK defaults (G1 for ≥2 CPUs/≥1792 MB, INFERRED) | — |
| Debug info | compiled with `-g:none` | `backend/pom.xml:122-126` |
| Node memory | no `NODE_OPTIONS` / `--max-old-space-size` anywhere (VERIFIED by grep) → V8 default heuristics (exact value UNKNOWN) | `frontend/Dockerfile:50-52`, `frontend/docker-entrypoint.sh:11` |
| Next.js mode | `next start -p 8085` (production) | `frontend/package.json` scripts |
| Heavy off-heap work | tesseract per page at 200 DPI (`DocumentGeneratorService.java:2860-2877`), python per GeM bid (`GeMScraperService.java:500`), **Chromium launched per bid-doc PDF** (`generate-bid-docs/route.ts:210-233`, called `:477`) | — |

## 5. Container CPU / memory limits

| Compose file | Service | Limits | Evidence |
|---|---|---|---|
| `docker-compose.yml` | postgres | none; no `shm_size` (Docker default 64 MB /dev/shm, INFERRED) | `:2-18` |
| `docker-compose.yml` | tender-pocket-backend | `mem_limit: 5g`; no CPU limit | `:25` |
| `docker-compose.yml` | tender-pocket-frontend | none | `:79-98` |
| `backend/docker-compose.yml` | tender-pocket-spring | none | `:4-20` |
| `frontend/docker-compose.yml` | app | none | `:4-41` |

No `deploy.resources`, `cpus`, `ulimits` anywhere (VERIFIED by grep). Restart policies: `always` (root, backend), `unless-stopped` (frontend standalone).

## 6. Reverse proxy

- **No nginx / Caddy / Traefik / HAProxy config in the repository** (VERIFIED: `git ls-files` search). `DEPLOYMENT.md:845-880` prescribes Nginx (TLS, body limits) in front of `localhost:8085` — documentation only; whether it exists on EC2-2, and its `client_max_body_size`, `proxy_read_timeout`, `limit_req` settings, is UNKNOWN.
- Without a proxy, port 8085 of the frontend container is published directly (`docker-compose.yml:88-89`).

## 7. Rate limiting

- None inbound: no bucket4j/resilience4j in `backend/pom.xml`, no rate-limit filter (filters present: `JwtRequestFilter`, `ComplianceProgressUiInjectionFilter`), no `frontend/src/middleware.ts` (VERIFIED file list). A 17-user test will not see HTTP 429 from the app.
- Outbound only: Gemini 4 s pacing, GeM 2.5 s pacing (section 3).

## 8. Request body / multipart limits

| Layer | Limit | Evidence |
|---|---|---|
| Spring multipart | `max-file-size=50MB`, `max-request-size=50MB` | `application.properties:75-77` |
| Tomcat swallow | 50 MB | `application.properties:72` |
| Next.js route handlers | no `bodySizeLimit` configured (`next.config.ts` has only `serverExternalPackages`, `images`, `rewrites`, `:3-16`); handlers buffer the whole multipart body (`backendProxy.ts:34`, `upload-emd-receipt/route.ts:28`) | VERIFIED; framework-level cap UNKNOWN (no middleware, so a middleware body cap does not apply — INFERRED) |
| Reverse proxy | UNKNOWN (no config in repo) | — |

## 9. HTTP client timeouts

| Client | Connect / read | Evidence |
|---|---|---|
| Next.js → Spring generic proxy (`fetch`) | **no timeout / no AbortSignal** → undici defaults (INFERRED ~300 s headers/body) | `frontend/src/lib/backendProxy.ts:46-51` |
| Next.js → Spring for tech-spec (`fetchSpecificationBackend`) | follows client abort (`request.signal`), no own timeout | `frontend/src/lib/technicalSpecificationBackend.ts:62-64` |
| Next.js sync-emails → Spring | 3 s abort | `frontend/src/app/api/tenders/sync-emails/route.ts:15` |
| Next.js generate-bid-docs → Spring notify | 10 s abort | `generate-bid-docs/route.ts:579` |
| Next.js documents route → Spring | no timeout | `documents/[...filename]/route.ts:129` |
| Next.js → GeM (axios) | 15 s | `documents/[...filename]/route.ts:179` |
| Next.js python spec extractor | `execSync` 20 s | `generate-bid-docs/route.ts:128-131` |
| Next.js python DOCX generator | **`execSync` without timeout** (blocks event loop) | `generate-bid-docs/route.ts:266-269` |
| Spring `RestTemplate` (GeM docs, Tender247) | not configured → no timeout (INFERRED) | `GeMScraperService.java:98`, `EmailSyncService.java:56` |
| Spring `HttpClient` (GeM search) | connect 15 s | `GeMScraperService.java:572-575` |
| IMAP | 5 s / 5 s | `EmailSyncService.java:73-74` |
| Azure OpenAI / Gemini | 30 s / 180 s | `AISpecificationIntelligenceService.java:996-997`, `:1143-1144` |
| GitHub update check | 5 s / 10 s | `AutoUpdateService.java:60-61` |
| tesseract / GeM python subprocess | `waitFor()` without timeout | `DocumentGeneratorService.java:2877`; `GeMScraperService.java:510` |

## 10. Caches and in-memory state

- No `@EnableCaching`, `@Cacheable`, Caffeine, Hibernate 2nd-level cache (VERIFIED by grep) → every request hits the DB.
- `ComplianceProgressService.java:17` `ConcurrentHashMap<tenderId, Progress>` — never evicted (bounded by number of tenders; ≤100 events each, `:16`, `:150`). Keyed by tender ID: concurrent uploads on the **same** tender overwrite each other's progress/metrics (INFERRED).
- `AISpecificationIntelligenceService.java:709` static `RATE_LIMITED_KEYS`.
- `NoticeDeskController.java:13`, `:59` static `ArrayList` (not thread-safe) grows on every `POST /api/noticedesk/fetch-jamku`.
- `GeMScraperService.java:100-101` cached GeM cookie/CSRF.
- Next.js: proxy uses `cache: 'no-store'` (`backendProxy.ts:50`); no server caches.

## 11. Client-side request generators that define the real load

- Dashboard poll every **1.5 s** per open tab: `/api/tenders?…` + `/api/analytics` (+ `/api/tenders?status=Participating` for Admin, + `/api/tenders/stats`) — `frontend/src/app/page.tsx:956-1037`; another 4 s timer `:1054`.
- Tender detail page poll every **1.5 s**: tender details + comments — `frontend/src/app/tenders/[id]/page.tsx:391-396`.
- During spec upload: progress poll every **1 s** — `page.tsx:1326-1338`, `tenders/[id]/page.tsx:1155`.
- `GET /api/tenders` loads all rows for non-executive roles (`TenderController.java:307-313`, `findAll()`), filters in memory. `GET /api/approvals/counts` and `/pending` run `reconcileStaleAndDuplicateApprovals()` (`ApprovalController.java:371`, `:515`) which scans all tenders (`:237`).

## Settings that could cap or distort a 17-user test

1. **UI polling dominates request volume (INFERRED).** 17 users on the dashboard at 1.5 s intervals ≈ 11 polls/s, each fanning out to 2–4 API calls, each `GET /api/tenders` being an unpaginated `findAll()` (`TenderController.java:313`). A script that models "think time" without the polling under-states load by an order of magnitude; one that models it will be dominated by list/analytics latency. Decide explicitly.
2. **Next.js event-loop blocking (VERIFIED code, INFERRED effect).** `generate-bid-docs` runs `execSync` python without a timeout (`route.ts:266`) and launches a Chromium per request (`:211`). While it runs, **every** Next.js request — including pure proxy calls — stalls. Mixed scenarios will show latency spikes on unrelated endpoints that are a Next.js artefact, not a backend limit. Synchronous SQLite calls add smaller stalls.
3. **Long synchronous AI uploads hold Tomcat threads and spawn 5 worker threads each (VERIFIED).** Azure read timeout 180 s, Tomcat connection-timeout 180 s, Next.js proxy with no timeout. 17 concurrent uploads → up to 85 concurrent Azure calls; the cap will be the Azure deployment's TPM/RPM quota (UNKNOWN), not the app. If Azure fails over to Gemini, the static 4 s pace lock serialises **all** users (`AISpecificationIntelligenceService.java:753-768`).
4. **Startup GeM sync (VERIFIED).** If the backend is (re)started shortly before the test, the scheduler starts a multi-minute GeM + IMAP sync 15 s later, competing for DB connections, CPU (python per new bid) and the single scheduler thread. Start measurements only after `[Scheduler] GeM Sync completed` or disable it.
5. **Hikari 25 vs Tomcat 200 (VERIFIED values).** Adequate for 17 users unless many requests hold connections for long (reconcile scans, uploads). Saturation shows as 15 s `connectionTimeout` errors, not queueing. maxLifetime 60 s adds periodic reconnect latency; one connection is leaked at boot (`PostgresBackupInitConfig.java:25`).
6. **Silent SQLite fallback (VERIFIED).** If Postgres is not reachable at boot, the backend runs on SQLite with pool 10 and health still reports UP — results would be meaningless. Check the boot log line `[DatabaseConfig] Configured PostgreSQL DataSource successfully.` (`DatabaseConfig.java:97`).
7. **Write amplification (VERIFIED in SQL; presence in DB UNKNOWN).** Each write also writes a JSONB copy into `db_change_log`; approval reads (`/counts`, `/pending`) may write during reconciliation. Write-heavy scenarios will look slower than the business logic alone, and `db_change_log` grows during the test. **Reconciled by lead reviewer:** whether these triggers exist in the DB is UNKNOWN. `PostgresBackupInitConfig.java:27-30` runs the script through Spring `ResourceDatabasePopulator` with the default `;` separator and `continueOnError=true`; the plpgsql body between `$$` (`schema-backup-triggers.sql:34-71`) contains semicolons, so the function is likely split and fails to create, and the triggers then fail silently (INFERRED). Confirm on EC2-2: `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;`.
8. **Memory headroom (INFERRED).** Backend heap 3 GB inside a 5 GB cgroup, tesseract/python/PDFBox off-heap in the same cgroup; frontend (Chromium per doc) and Postgres are unlimited and share the host. OOM-kill of the backend container is possible under parallel OCR + PDF rendering on a small instance. EC2-2 instance size UNKNOWN.
9. **Common-pool async syncs (INFERRED).** Repeated `sync-gem`/`sync-emails` calls run unbounded in `ForkJoinPool.commonPool()` and are never deduplicated — exclude these endpoints from the mix.
10. **No inbound rate limiting / no proxy in repo (VERIFIED absence).** Any limit seen on EC2-2 comes from an external proxy or AWS (UNKNOWN), not from the app.
11. **JWT lifetime 10 years** (`application.properties:20`, `315360000` s; `docker-compose.yml:39`) — tokens will not expire mid-test; login is a cheap SHA-256 compare (`SecurityConfig.java:30-55`), so login storms are not a meaningful CPU test.

## Open questions / UNKNOWN

1. Which compose file and which image build is running on EC2-2 → `docker compose ls`, `docker ps --format '{{.Names}} {{.Image}}'`, `docker inspect tender-pocket-backend --format '{{json .Config.Env}}' | tr ',' '\n' | cut -d= -f1`.
2. Effective JVM flags → `docker exec tender-pocket-backend sh -c 'echo $JAVA_TOOL_OPTIONS'`; `docker exec tender-pocket-backend jcmd 1 VM.flags` (if jcmd present in the JRE image) or the "Picked up JAVA_TOOL_OPTIONS" boot line.
3. Instance type / vCPU / RAM of EC2-2 → `nproc; free -m` on the host (determines common-pool parallelism and JVM default heap).
4. Effective Tomcat settings if overridden by env → `docker exec tender-pocket-backend env | grep -E '^SERVER_'`.
5. Postgres `max_connections`, `shared_buffers` → `docker exec tender-pocket-postgres psql -U <user> -c 'show max_connections; show shared_buffers;'`.
6. Reverse proxy presence and limits → `sudo nginx -T 2>/dev/null | grep -E 'client_max_body_size|proxy_read_timeout|limit_req'`; AWS ALB idle timeout if an ALB exists.
7. Azure OpenAI deployment quota (TPM/RPM) for the key on EC2-2 → Azure portal.
8. Next.js effective body-size limit for route handlers in Next 16.2.6 → test with a >50 MB upload against a non-production instance, or check Next.js docs for the installed version.
9. Whether the frontend container on EC2-2 sets `DATABASE_PATH` / `REQUIRE_JWT_AUTH` → `docker inspect tender-pocket-frontend` env names.
