#!/usr/bin/env bash
# EMERGENCY ONLY: restore the full pre-seeding backup made by backup.sh (G6).
#
#   bash restore_backup.sh --file /var/tmp/tp-loadtest/backups/full-<UTC>.dump --approved
#
# Runs pg_restore --clean --if-exists --single-transaction inside the postgres container.
# Every object in the dump is dropped and recreated. Stop load first; do not run during a test.
source "$(dirname "$0")/_pg_common.sh"
parse_common_args "$@"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "--file <backup.dump> is required and must exist" >&2; exit 2; }

banner "pg_restore --clean --if-exists --single-transaction of $FILE" \
       "into the database of container $PG_CONTAINER — ALL seeded data is replaced by the backup"
require_approved
docker exec -i "$PG_CONTAINER" sh -c \
  'pg_restore --clean --if-exists --single-transaction --no-owner -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}"' < "$FILE"
echo "restore ok"
