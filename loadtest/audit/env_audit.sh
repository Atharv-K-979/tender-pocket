#!/usr/bin/env bash
# Tender Pocket load-test — EC2-2 environment audit (READ-ONLY).
#
# Run ON EC2-2:   bash env_audit.sh [--out DIR]
# Writes one timestamped text file (default ./audit-out/) and prints its path.
#
# Guarantees:
#   * read-only: docker inspect/ps/logs/exec (env, which), psql SELECT/SHOW only, host stats;
#   * env var VALUES are never printed (G4) — only NAME=<set>/<empty>. The single exception
#     is JAVA_TOOL_OPTIONS (explicitly allowed by the brief);
#   * psql runs inside the postgres container with that container's own POSTGRES_USER /
#     POSTGRES_DB (never echoed), in a READ ONLY transaction.
#
# Override container names with env vars: BACKEND, FRONTEND, POSTGRES.
# Review references: 01 §(a)-(g), 07 §Open questions, 09 §Open questions, 11 §Open questions.
set -u

BACKEND="${BACKEND:-tender-pocket-backend}"
FRONTEND="${FRONTEND:-tender-pocket-frontend}"
POSTGRES="${POSTGRES:-tender-pocket-postgres}"
OUTDIR="./audit-out"
if [ "${1:-}" = "--out" ] && [ -n "${2:-}" ]; then OUTDIR="$2"; fi
mkdir -p "$OUTDIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUTDIR/env-audit-$TS.txt"

exec > >(tee "$OUT") 2>&1

section() { printf '\n==================== %s ====================\n' "$*"; }
run() { printf '\n$ %s\n' "$*"; bash -c "$*" 2>&1 | sed 's/^/  /'; }

# Print env var names of a container, values stripped. Category regex selects names.
env_names() {
  local c="$1" re="$2"
  docker exec "$c" sh -c 'env' 2>/dev/null \
    | awk -F= -v re="$re" '$1 ~ re { name=$1; val=substr($0, length($1)+2);
        if (name == "JAVA_TOOL_OPTIONS") { print "  " name "=" val }
        else if (val == "") { print "  " name "=<empty>" }
        else { print "  " name "=<set>" } }' | sort
}

section "Audit metadata"
echo "UTC: $(date -u '+%Y-%m-%d %H:%M:%S')   IST: $(TZ=Asia/Kolkata date '+%Y-%m-%d %H:%M:%S')"
echo "host: $(hostname)   kernel: $(uname -r)"
run "uptime"
run "docker version --format 'client={{.Client.Version}} server={{.Server.Version}}'"

section "Docker compose projects and containers"
run "docker compose ls 2>/dev/null || docker-compose ls 2>/dev/null"
run "docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'"
echo
echo "Per-container restart count, start time, limits (0 = unlimited):"
for c in $(docker ps -a --format '{{.Names}}'); do
  docker inspect --format \
    '  {{.Name}} restarts={{.RestartCount}} started={{.State.StartedAt}} oomkilled={{.State.OOMKilled}} restart_policy={{.HostConfig.RestartPolicy.Name}} mem_limit={{.HostConfig.Memory}} memswap={{.HostConfig.MemorySwap}} nano_cpus={{.HostConfig.NanoCpus}} cpu_quota={{.HostConfig.CpuQuota}} shm={{.HostConfig.ShmSize}} log={{.HostConfig.LogConfig.Type}}' "$c" 2>&1
done
echo
echo "Image build times (detects images built from modified working trees, 01 open question 3):"
for c in "$BACKEND" "$FRONTEND" "$POSTGRES"; do
  img="$(docker inspect --format '{{.Image}}' "$c" 2>/dev/null)"
  [ -n "$img" ] && docker image inspect --format "  $c image={{index .RepoTags 0}} created={{.Created}} labels={{json .Config.Labels}}" "$img" 2>&1
done

section "Environment variable NAMES (values stripped; JAVA_TOOL_OPTIONS shown)"
CAT='^(SPRING_MAIL_|MAIL_|IMAP_|SMTP_|AZURE_OPENAI_|GEMINI_|OPENAI_|AI_|TECHSPEC_|AWS_|S3_|JWT_|REQUIRE_JWT_AUTH|SPRING_DATASOURCE_|DATABASE_|DB_|POSTGRES|PG|JAVA_TOOL_OPTIONS|JAVA_OPTS|SERVER_|SPRING_JPA_|LOGGING_|GEM_|HTTP_PROXY|HTTPS_PROXY|NO_PROXY|BACKEND_URL|NODE_OPTIONS|NODE_ENV|FILE_UPLOAD_DIR|FILE_TEMPLATE_DIR|ALLOWED_ORIGINS|.*_DEFAULT_PASSWORD|APP_)'
for c in "$BACKEND" "$FRONTEND"; do
  echo "[$c]"
  env_names "$c" "$CAT"
done
echo
echo "Booleans derived without printing values:"
docker exec "$BACKEND" sh -c '[ "${AWS_S3_ENABLED:-}" = "true" ] && echo "  AWS_S3_ENABLED equals true: YES" || echo "  AWS_S3_ENABLED equals true: no"' 2>&1
docker exec "$BACKEND" sh -c 'case "${AZURE_OPENAI_ENDPOINT:-}" in *azure.com*) echo "  AZURE_OPENAI_ENDPOINT points at *.azure.com: YES (real provider)";; "") echo "  AZURE_OPENAI_ENDPOINT: empty -> hard-coded real default endpoint (05 §6)";; *) echo "  AZURE_OPENAI_ENDPOINT points at *.azure.com: no";; esac' 2>&1

section "Backend log: datasource, scheduler, auto-update (07 §0.3, 01 §g)"
run "docker logs --timestamps $BACKEND 2>&1 | grep -E 'Configured PostgreSQL DataSource|Falling back to SQLite|SQLite' | tail -n 5"
run "docker logs --timestamps $BACKEND 2>&1 | grep -F '[Scheduler]' | tail -n 8"
run "docker logs --timestamps $BACKEND 2>&1 | grep -E 'AutoUpdate' | tail -n 5"
run "docker logs --timestamps $BACKEND 2>&1 | grep -E 'Picked up JAVA_TOOL_OPTIONS|Started TenderPocketApplication' | tail -n 3"
run "docker logs --timestamps --since 24h $BACKEND 2>&1 | grep -cE 'Connection is not available|Connection leak detection|OutOfMemoryError'"
run "docker exec $BACKEND sh -c 'ls -la /app/TenderPocket-update.jar /app/.restart_trigger 2>&1 | sed s/^/\ \ /'"

section "Host resources"
run "nproc"
run "free -m"
run "df -h"
run "docker system df"
run "cat /etc/docker/daemon.json 2>/dev/null || echo 'no /etc/docker/daemon.json'"

section "Host schedulers (01 §g)"
run "crontab -l 2>&1"
run "sudo -n crontab -l 2>&1 || echo 'sudo crontab -l: needs a password — run manually with sudo'"
run "ls -la /etc/cron.d 2>&1"
run "systemctl list-timers --all 2>&1 | head -n 40"
run "ls ~/.config/systemd/user /etc/systemd/system 2>/dev/null | grep -iE 'tender|backup|k6|loadtest' || echo 'no matching units'"

section "Reverse proxy (09 §6)"
if command -v nginx >/dev/null 2>&1; then
  run "sudo -n nginx -T 2>/dev/null | grep -nE 'listen|server_name|proxy_pass|proxy_(read|send|connect)_timeout|client_max_body_size|keepalive_timeout|limit_req|log_format' || echo 'nginx -T needs sudo — run: sudo nginx -T | grep -E timeout'"
else
  echo "  nginx binary not found on host"
fi
run "docker ps --format '{{.Names}} {{.Image}}' | grep -iE 'nginx|caddy|traefik|haproxy' || echo 'no proxy container'"

section "Frontend image tools (06 §1, 13 C9)"
run "docker exec $FRONTEND sh -c 'for b in chromium chromium-browser google-chrome python3 pdftotext pdftoppm tesseract node; do printf \"%-18s \" \$b; command -v \$b || echo MISSING; done'"
run "docker exec $FRONTEND sh -c 'node --version; python3 -c \"import docx, pypdf; print(\\\"python-docx+pypdf OK\\\")\" 2>&1; python3 -c \"import fitz\" 2>&1 | tail -n1'"
run "docker exec $BACKEND sh -c 'command -v tesseract; ls \$JAVA_HOME/bin 2>/dev/null | tr \"\\n\" \" \"'"

section "PostgreSQL (read-only; SELECT/SHOW only)"
PSQL_SQL=$(cat <<'SQL'
\set ON_ERROR_ROLLBACK on
BEGIN TRANSACTION READ ONLY;
\echo '--- settings'
SHOW server_version; SHOW max_connections; SHOW shared_buffers; SHOW work_mem; SHOW effective_cache_size;
SHOW shared_preload_libraries; SHOW log_min_duration_statement; SHOW wal_level; SHOW TimeZone;
\echo '--- extensions'
SELECT extname, extversion FROM pg_extension ORDER BY 1;
\echo '--- table rows / sizes'
SELECT relname, n_live_tup, n_dead_tup, pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
       last_analyze, last_autoanalyze
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC;
\echo '--- exact row counts (key tables)'
SELECT 'tenders' t, count(*) FROM tenders UNION ALL
SELECT 'tender_approval_requests', count(*) FROM tender_approval_requests UNION ALL
SELECT 'tender_workflow_states', count(*) FROM tender_workflow_states UNION ALL
SELECT 'tender_comments', count(*) FROM tender_comments UNION ALL
SELECT 'tender_workflow_comments', count(*) FROM tender_workflow_comments UNION ALL
SELECT 'status_history', count(*) FROM status_history UNION ALL
SELECT 'activity_log', count(*) FROM activity_log UNION ALL
SELECT 'tender_document_manifest', count(*) FROM tender_document_manifest UNION ALL
SELECT 'email_notification_logs', count(*) FROM email_notification_logs UNION ALL
SELECT 'users', count(*) FROM users;
\echo '--- tender row width (07 §6.1)'
SELECT round(avg(pg_column_size(t.*))) AS avg_bytes,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY pg_column_size(t.*)) AS p95_bytes FROM tenders t;
\echo '--- tenders by status x current_stage'
SELECT coalesce(status,'<null>') status, coalesce(current_stage,'<null>') current_stage, count(*)
FROM tenders GROUP BY 1,2 ORDER BY 3 DESC;
\echo '--- tenders sub-status distribution (04 Open questions)'
SELECT current_stage, spec_verification_status, payment_status, verification_status,
       submission_status, outcome_status, count(*)
FROM tenders GROUP BY 1,2,3,4,5,6 ORDER BY 7 DESC LIMIT 60;
\echo '--- approvals by stage x status'
SELECT stage, status, count(*) FROM tender_approval_requests GROUP BY 1,2 ORDER BY 1,2;
\echo '--- duplicate PENDING approvals'
SELECT count(*) AS duplicate_pending_groups FROM (
  SELECT tender_id, stage FROM tender_approval_requests WHERE status='PENDING'
  GROUP BY 1,2 HAVING count(*) > 1) d;
\echo '--- users by role'
SELECT role, count(*) FROM users GROUP BY 1 ORDER BY 1;
\echo '--- users.email containing @ (01 §c — real addresses would receive mail)'
SELECT count(*) FILTER (WHERE email LIKE '%@%') AS with_at,
       count(*) FILTER (WHERE email LIKE '%@%' AND email NOT ILIKE '%.invalid' AND email NOT ILIKE '%example.%') AS non_test_domain,
       count(*) AS total FROM users;
\echo '--- recent e-mail notification attempts'
SELECT sent_date, status, count(*) FROM email_notification_logs GROUP BY 1,2 ORDER BY 1 DESC LIMIT 10;
\echo '--- triggers (07 §4)'
SELECT tgname, tgrelid::regclass AS table_name, tgenabled FROM pg_trigger WHERE NOT tgisinternal ORDER BY 2,1;
SELECT proname FROM pg_proc WHERE proname = 'fn_track_db_changes';
SELECT to_regclass('public.db_change_log') AS db_change_log_exists;
\echo '--- indexes on key tables (07 §3)'
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE tablename IN ('tenders','tender_approval_requests','tender_workflow_states','tender_comments',
                    'tender_workflow_comments','status_history','activity_log','tender_document_manifest')
ORDER BY 1,2;
\echo '--- identity / serial columns'
SELECT table_name, column_name, is_identity, column_default FROM information_schema.columns
WHERE table_schema='public' AND (is_identity='YES' OR column_default LIKE 'nextval%') ORDER BY 1;
\echo '--- connection usage now'
SELECT datname, usename, state, count(*) FROM pg_stat_activity GROUP BY 1,2,3 ORDER BY 4 DESC;
COMMIT;
SQL
)
printf '\n$ docker exec -i %s psql (read-only transaction)\n' "$POSTGRES"
printf '%s\n' "$PSQL_SQL" | docker exec -i "$POSTGRES" sh -c 'psql -X -P pager=off -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}"' 2>&1 | sed 's/^/  /'
printf '\n  db_change_log size (only if the table exists):\n'
printf "BEGIN TRANSACTION READ ONLY; SELECT CASE WHEN to_regclass('public.db_change_log') IS NULL THEN 'absent' END; COMMIT;\n" \
  | docker exec -i "$POSTGRES" sh -c 'psql -X -A -t -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}"' 2>&1 | sed 's/^/  /'
printf "BEGIN TRANSACTION READ ONLY; SELECT count(*), pg_size_pretty(pg_total_relation_size('db_change_log')) FROM db_change_log; COMMIT;\n" \
  | docker exec -i "$POSTGRES" sh -c 'psql -X -A -t -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}"' 2>&1 | sed 's/^/  /'

section "Network egress hints (01 §a open question 5) — no probes are made"
echo "  Not probed by design. Check the EC2-2 security group / NACL egress rules manually."

section "Done"
echo "Audit written to: $OUT"
echo "Send this file back. It contains no env values except JAVA_TOOL_OPTIONS."
