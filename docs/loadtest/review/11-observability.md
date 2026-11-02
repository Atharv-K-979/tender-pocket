# 11 — Observability available today

Scope: branch `load-testing` @ `68eb28ae`. Labels: **VERIFIED** / **INFERRED** / **UNKNOWN**.

## 1. Actuator / metrics

- `spring-boot-starter-actuator`: **absent** from `backend/pom.xml:24-113` (dependencies: web, security, data-jpa, mail, AWS s3, sqlite-jdbc, postgresql, hibernate-community-dialects, jjwt, jsoup, poi-ooxml, openhtmltopdf, test). VERIFIED.
- Micrometer / Prometheus registry: absent (VERIFIED). No `management.*` properties, no management port (`application.properties` has none). VERIFIED.
- Consequence (INFERRED): no `/actuator/metrics`, no `http.server.requests` timers, no Hikari pool gauges, no JVM/GC metrics over HTTP. JVM-level data must come from `docker stats`, `jcmd`/`jstat` (if present in the `eclipse-temurin:21-jre-alpine` image — UNKNOWN; JRE images usually lack `jcmd`) or JMX (not enabled by any flag).
- Next.js: no `instrumentation.ts`, no OpenTelemetry package (`frontend/package.json` dependencies). VERIFIED.

## 2. Health checks

| Check | Evidence | What it proves |
|---|---|---|
| `GET /api/health` (public) | `backend/src/main/java/com/tenderpocket/controllers/HealthController.java:20-40`; permitted at `SecurityConfig.java:65` | runs `SELECT 1` through the pool; 200 `{"status":"UP","database":"UP"}` or 503. Does **not** reveal whether the pool is Postgres or the SQLite fallback (INFERRED). |
| Compose healthcheck — backend | `docker-compose.yml:71-75` `wget --spider http://localhost:8090/api/health`, every 15 s, timeout 5 s, retries 3 | adds 4 requests/min and one pool checkout every 15 s during the test (negligible) |
| Compose healthcheck — postgres | `docker-compose.yml:12-16` `pg_isready` every 10 s | — |
| Frontend healthcheck | none (`docker-compose.yml:79-98`) | — |
| Dockerfile `HEALTHCHECK` | none in `backend/Dockerfile` or `frontend/Dockerfile` | — |

Conflict: `DEPLOYMENT.md:825-829` says the compose healthcheck uses `curl`; code uses `wget` (`docker-compose.yml:72`). Code wins.

## 3. Logging

- No `logback.xml` / `logback-spring.xml` (resources contain only `application.properties`, fonts, SQL, static, templates — VERIFIED) and no `logging.*` properties → Spring Boot default: Logback to console, INFO, plain-text pattern, **not JSON** (INFERRED).
- Application code uses **`System.out/err` exclusively**: 173 call sites, 0 SLF4J loggers (VERIFIED by grep over `backend/src/main/java`). These lines bypass Logback → no timestamp, level or thread name on app messages (INFERRED); only framework lines (Spring, Hibernate, Hikari) are formatted.
- No request-ID / MDC / correlation header anywhere (VERIFIED by grep).
- Stack traces: compiled with `-g:none` (`backend/pom.xml:122-126`) → no line numbers in traces (INFERRED).
- Docker log driver/rotation: compose sets no `logging:` → Docker default `json-file`, no rotation unless configured in the daemon (INFERRED). `docker logs --timestamps` adds the timestamps app lines lack.
- Next.js: `console.log/warn/error` in route handlers (e.g. `backendProxy.ts:62` on proxy error; `documents/[...filename]/route.ts:153`, `:173`; `generate-bid-docs/route.ts:272`, `:487`, `:618`). `next start` prints no access log (INFERRED).
- Local dev: `start.sh:112-116` tees to `logs/backend.log` / `logs/frontend.log` (not used in Docker).

## 4. Request logging

- None: no `CommonsRequestLoggingFilter`, no `server.tomcat.accesslog.*` (→ access log disabled by default, INFERRED), no Next.js middleware (VERIFIED absence).
- Only request-related app logs: `JwtRequestFilter.java:42` (invalid JWT), `[API Trigger]` lines for sync/alerts (`TenderController.java:234`, `:258`, `:276`).

## 5. SQL logging and slow queries

- `spring.jpa.show-sql=${SPRING_JPA_SHOW_SQL:false}` (`application.properties:11`); `hibernate.format_sql=true` (`:12`) only matters when show-sql is on. show-sql prints to stdout without timings (INFERRED).
- `hibernate.generate_statistics`, `org.hibernate.SQL`/`orm.jdbc.bind` log levels, slow-query threshold (`hibernate.session.events.log.LOG_QUERIES_SLOWER_THAN_MS`): not set (VERIFIED absence).
- Postgres: compose passes no `command:` (`docker-compose.yml:2-18`) → `log_min_duration_statement` off, `pg_stat_statements` not loaded (INFERRED image defaults). `pg_stat_activity` / `pg_stat_user_tables` / `pg_locks` are always available for sampling.
- Hikari: `leakDetectionThreshold=60000` (`DatabaseConfig.java:94`) → Hikari logs a WARN with stack trace when a connection is held > 60 s (INFERRED Hikari behaviour). Expect one warning shortly after boot from `PostgresBackupInitConfig.java:25` (unclosed connection).

## 6. Timing logs for AI / OCR / document generation

| Area | What exists | Evidence |
|---|---|---|
| Spec conversion (AI) — metrics object | `ComplianceConversionMetrics` (per upload): `durationsMs.api` (sum of Azure call latencies), `durationsMs.extraction`, `durationsMs.rendering`, `durationsMs.total`, `apiAttempts`, tokens, retries (validation/ocr/split/rateLimit), pages, batches, clauses | `backend/src/main/java/com/tenderpocket/services/ComplianceConversionMetrics.java:33-60`, `:165-215` |
| — where it is exposed | **in the HTTP response body** of `POST /api/tenders/{id}/upload-tech-spec` as `metrics` (success and failure) | `TenderController.java:2028`, `:2038`, `:2126`, `:2135`, `:2143`; passed through by Next.js (`backendProxy.ts:54-56`) |
| — where it is hidden | `GET …/tech-spec-progress` strips durations/tokens, keeps only `document` + `warnings` | `ComplianceProgressService.java:166-173` |
| — phase markers | extraction `DocumentGeneratorService.java:1731`/`:1803`; rendering `TenderController.java:2058`/`:2097`; API latency per Azure attempt `AISpecificationIntelligenceService.java:987`, `:1006`, `:1012`, `:1032`, `:1106-1111` | |
| — gaps | Gemini fallback attempts are **not** timed (`recordApiAttempt` only on the Azure path); `api` is a **sum** across up to 5 concurrent batch threads, so it can exceed wall time (INFERRED); metrics are not logged, only returned | |
| AI log lines | `[AISpecificationIntelligence] Attempting Azure OpenAI deployment …` `:982`; HTTP-status line `:1027`; Gemini model attempts `:1093`, errors `:1197` — no durations printed | VERIFIED |
| OCR (tesseract) | no timing; only an `ocr` retry counter (`DocumentGeneratorService.java:2046`) and a "tesseract not found" message (`:2778`) | VERIFIED |
| Backend doc-gen (`generate-bid-docs`, `generate-tech-specs`) | no timing logs (`TenderController.java:1632`, `:2148`) | VERIFIED (grep for elapsed/ms prints) |
| Next.js doc-gen (python DOCX + Chromium PDF) | success/fallback messages only (`generate-bid-docs/route.ts:272`, `:487`, `:618`), no durations | VERIFIED |
| GeM sync | per-keyword/per-page progress lines (`GeMScraperService.java:148`, `:163`), start/finish (`SyncScheduler.java:24`, `:40`, `:48`) — no durations | VERIFIED |
| E-mail digest | per-recipient success/failure (`EmailNotificationService.java:228`, `:232`); metrics map returned to caller only for internal use | VERIFIED |

## 7. Activity / audit tables usable as post-test evidence

| Table | Written by | Timestamp column | Use |
|---|---|---|---|
| `activity_log` | 16 save sites in controllers (VERIFIED count); model `backend/src/main/java/com/tenderpocket/models/ActivityLog.java:6-30` | `timestamp` (**string**, normalised at boot `TenderPocketApplication.java:84`) | count business actions per user/time window; read via `GET /api/activity-logs` (`ActivityLogController.java:20`) |
| `status_history` | status changes | — | workflow transitions |
| `email_notification_logs` | `EmailNotificationService.java:543-546` | `sent_date` | proves whether mail was attempted during the test |
| `db_change_log` | Postgres trigger on 9 tables (`schema-backup-triggers.sql:33-118`) | `created_at` = `CURRENT_TIMESTAMP` (transaction start) | **write throughput per table per second** after the run (`select date_trunc('second',created_at), table_name, operation, count(*) …`) — INFERRED best existing write-rate source | (Only if the triggers actually exist — UNKNOWN, see 07 §4 and 09 §1.3.)
| `backup_runs` | backup scripts / service | `started_at`, `completed_at` | confirms no backup ran during the window |

## 8. What can be separated today

| Timing component | Separable without code change? | How / what is missing |
|---|---|---|
| App total (client-observed) | **yes** | Load tool's own per-request timings at the Next.js port 8085. |
| Next.js proxy hop | **partly** | Run the same request against Spring directly (`:8090`, not published by root compose → needs a client inside the Docker network or a temporary port mapping) and subtract. No server-side timing in Next.js; event-loop stalls from `execSync`/SQLite are invisible except as latency. |
| Spring server time | **partly** | No access log or actuator. Only via direct-to-8090 client timing; Tomcat access log could be enabled by env (`SERVER_TOMCAT_ACCESSLOG_ENABLED=true`, pattern with `%D`) — config, not code, but it changes the container env (INFERRED Boot relaxed binding). |
| DB | **partly** | Sample `pg_stat_activity` / `pg_stat_user_tables` and `db_change_log` counts during the run; enabling `log_min_duration_statement` or `pg_stat_statements` requires a Postgres config change (not code). No per-request DB time in the app. |
| AI (Azure) | **partly / yes for uploads** | `metrics.durationsMs.api` + `apiAttempts` in the `upload-tech-spec` response body; summed across threads; Gemini fallback untimed; Azure-side latency only via Azure portal metrics. |
| OCR | **no** | Only a retry counter; OCR time is folded into `durationsMs.extraction`. Needs timing around `DocumentGeneratorService.java:2860-2877`. |
| Doc-gen (backend spec sheet render) | **partly** | `durationsMs.rendering` for spec conversion only. Backend `generate-bid-docs`/`generate-tech-specs`: nothing. |
| Doc-gen (Next.js bid docs: python + Chromium) | **no** | Only total client latency of `POST /api/tenders/{id}/generate-bid-docs`; host-level `pidstat`/`docker stats` can show python/Chromium CPU but not per-request time. |
| Network (client ↔ EC2-2) | **partly** | Load-tool connect/TLS/TTFB breakdown (e.g. k6 `http_req_connecting`, `http_req_waiting`); server side has no data. |
| Resource usage (CPU/mem per container) | **yes** | `docker stats --no-stream` sampling (the ignored local report `frontend/scratch/execute_optimized_matrix.py:51-53` already did this). |

## Open questions / UNKNOWN

1. Does the EC2-2 backend image contain `jcmd`/`jstat`? → `docker exec tender-pocket-backend sh -c 'ls $JAVA_HOME/bin'`.
2. Docker daemon log rotation on EC2-2 → `cat /etc/docker/daemon.json`; `docker inspect tender-pocket-backend --format '{{.HostConfig.LogConfig}}'`.
3. Is CloudWatch agent / any APM installed on EC2-2 (`DEPLOYMENT.md:58`, `:142` mention CloudWatch)? → `systemctl status amazon-cloudwatch-agent`; AWS console.
4. Are `SPRING_JPA_SHOW_SQL` or any `LOGGING_LEVEL_*` env vars set on EC2-2 (they would add stdout I/O during the test)? → `docker inspect` env names.
5. Postgres logging settings on EC2-2 → `psql -c 'show log_min_duration_statement; show shared_preload_libraries;'`.
6. Whether a reverse proxy on EC2-2 writes access logs with upstream timings (`$request_time`, `$upstream_response_time`) → `sudo nginx -T | grep log_format`.
