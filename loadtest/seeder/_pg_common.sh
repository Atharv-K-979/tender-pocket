#!/usr/bin/env bash
# Shared helpers for backup.sh / dump_tier.sh / reset.sh / restore_backup.sh (run ON EC2-2).
# psql/pg_dump run inside the postgres container with its own $POSTGRES_USER/$POSTGRES_DB
# (values never echoed). Override with PG_CONTAINER, LT_WORKDIR.
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-tender-pocket-postgres}"
LT_WORKDIR="${LT_WORKDIR:-/var/tmp/tp-loadtest}"
APPROVED=0
TIER=""
FILE=""
TRIGGERS="auto"          # auto | replica | fire
TRUNCATE_CHANGELOG="yes" # yes | no

# App tables managed by the seeder (load order). users is fully reloaded from the tier dump.
LT_TABLES=(users tenders tender_workflow_states tender_approval_requests tender_comments
           tender_workflow_comments status_history activity_log tender_document_manifest)

parse_common_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --approved) APPROVED=1 ;;
      --tier) TIER="$2"; shift ;;
      --file) FILE="$2"; shift ;;
      --pg-container) PG_CONTAINER="$2"; shift ;;
      --workdir) LT_WORKDIR="$2"; shift ;;
      --triggers) TRIGGERS="$2"; shift ;;
      --truncate-changelog) TRUNCATE_CHANGELOG="$2"; shift ;;
      -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
      *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
    shift
  done
}

pg_sh() {   # run a command string inside the postgres container
  docker exec -i "$PG_CONTAINER" sh -c "$1"
}

psql_ro() { # read-only scalar query
  printf '%s\n' "$1" | docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$PG_CONTAINER" \
    sh -c 'psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}"'
}

psql_rw() { # read SQL from stdin, write session
  docker exec -i "$PG_CONTAINER" sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}"'
}

banner() {
  echo "=============================================================================="
  echo "DATABASE WRITE ON EC2-2 — planned action:"
  printf '  %s\n' "$@"
  echo "=============================================================================="
}

require_approved() {
  if [ "$APPROVED" != "1" ]; then
    echo "refusing: re-run with --approved (G6)" >&2
    exit 6
  fi
}

trigger_state() { # prints: <tracking_trigger_count> <changelog_exists t/f> <superuser t/f>
  local n e s
  n="$(psql_ro "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'trg_track_%';")"
  e="$(psql_ro "SELECT to_regclass('public.db_change_log') IS NOT NULL;")"
  s="$(psql_ro "SELECT rolsuper FROM pg_roles WHERE rolname = current_user;")"
  echo "$n $e $s"
}
