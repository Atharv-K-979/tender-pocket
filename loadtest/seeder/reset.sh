#!/usr/bin/env bash
# Reset the EC2-2 database to a seeded tier: TRUNCATE app tables + reload the tier dump +
# ANALYZE, all in ONE transaction, WITHOUT restarting any container (G6).
#
#   bash reset.sh --tier 1000 --approved [--triggers auto|replica|fire] [--truncate-changelog yes|no]
#
# Trigger handling (review 07 §4; seed-design.md §5):
#   auto     superuser -> SET LOCAL session_replication_role=replica (tracking triggers do
#            not fire on the reload); otherwise triggers fire.
#   replica  force replica mode (fails if not superuser).
#   fire     let triggers fire.
#   --truncate-changelog yes  TRUNCATE db_change_log in the same transaction (if it exists),
#            so every run starts with the same changelog size.
# The tables are locked (ACCESS EXCLUSIVE) for the duration; run between test runs only.
source "$(dirname "$0")/_pg_common.sh"
parse_common_args "$@"
[ -n "$TIER" ] || { echo "--tier is required" >&2; exit 2; }
DUMP="$LT_WORKDIR/dumps/tier_${TIER}.sql.gz"
[ -f "$DUMP" ] || { echo "dump not found: $DUMP (run dump_tier.sh first)" >&2; exit 3; }

read -r NTRIG CHANGELOG SUPER <<<"$(trigger_state)"
REPLICA=0
case "$TRIGGERS" in
  auto) [ "$NTRIG" -gt 0 ] && [ "$SUPER" = "t" ] && REPLICA=1 ;;
  replica) REPLICA=1 ;;
  fire) REPLICA=0 ;;
  *) echo "bad --triggers $TRIGGERS" >&2; exit 2 ;;
esac
TRUNC_CL=0
[ "$TRUNCATE_CHANGELOG" = "yes" ] && [ "$CHANGELOG" = "t" ] && TRUNC_CL=1

QTABLES=""
for t in "${LT_TABLES[@]}"; do QTABLES="${QTABLES:+$QTABLES, }public.$t"; done
EXTRA=""
[ "$(psql_ro "SELECT to_regclass('public.email_notification_logs') IS NOT NULL;")" = "t" ] && EXTRA=", public.email_notification_logs"

banner "reset to tier $TIER from $DUMP ($(du -h "$DUMP" | cut -f1))" \
       "BEGIN; TRUNCATE $QTABLES$EXTRA" \
       "reload dump (COPY + setval); $( [ $TRUNC_CL = 1 ] && echo 'TRUNCATE db_change_log;' ) ANALYZE; COMMIT" \
       "tracking triggers present: $NTRIG; superuser: $SUPER; replica mode: $REPLICA" \
       "no container is restarted"
require_approved

T0=$(date +%s)
{
  echo "\\set ON_ERROR_STOP on"
  echo "BEGIN;"
  echo "SET LOCAL statement_timeout = 0;"
  [ $REPLICA = 1 ] && echo "SET LOCAL session_replication_role = replica;"
  echo "TRUNCATE $QTABLES$EXTRA;"
  gunzip -c "$DUMP"
  [ $TRUNC_CL = 1 ] && echo "TRUNCATE public.db_change_log;"
  for t in "${LT_TABLES[@]}"; do echo "ANALYZE public.$t;"; done
  echo "COMMIT;"
} | psql_rw > "$LT_WORKDIR/reset-last.log" 2>&1 || { tail -n 20 "$LT_WORKDIR/reset-last.log" >&2; echo "RESET FAILED (rolled back)" >&2; exit 7; }

echo "reset to tier $TIER ok in $(( $(date +%s) - T0 ))s; tenders=$(psql_ro 'SELECT count(*) FROM tenders;')"
printf '{"tier": %s, "reset_at_utc": "%s", "replica": %s, "truncated_changelog": %s}\n' \
  "$TIER" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$REPLICA" "$TRUNC_CL" > "$LT_WORKDIR/state/last_reset.json" 2>/dev/null || true
