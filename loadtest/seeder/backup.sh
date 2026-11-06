#!/usr/bin/env bash
# Full pg_dump (custom format) of the current EC2-2 database BEFORE the first seeding (G6).
#
#   bash backup.sh --approved [--pg-container NAME] [--workdir DIR]
#
# Output: $LT_WORKDIR/backups/full-<UTC>.dump (+ .toc listing). load.py refuses to seed
# until at least one backup exists. Read-only on the database; requires --approved anyway
# because it is the first step of the destructive seeding sequence.
source "$(dirname "$0")/_pg_common.sh"
parse_common_args "$@"

mkdir -p "$LT_WORKDIR/backups"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$LT_WORKDIR/backups/full-$TS.dump"
SIZE="$(psql_ro "SELECT pg_size_pretty(pg_database_size(current_database()));")"
FREE="$(df -h "$LT_WORKDIR" | awk 'NR==2 {print $4}')"
banner "pg_dump --format=custom of the whole database (size $SIZE) from container $PG_CONTAINER" \
       "to $OUT (free space in $LT_WORKDIR: $FREE)" \
       "No data is modified."
require_approved

pg_sh 'pg_dump --format=custom --no-owner -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}"' > "$OUT.partial"
mv "$OUT.partial" "$OUT"
docker exec -i "$PG_CONTAINER" pg_restore --list < "$OUT" > "$OUT.toc"
echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1)); $(grep -c 'TABLE DATA' "$OUT.toc") table-data entries"
echo "restore (emergency only): bash restore_backup.sh --file $OUT --approved"
