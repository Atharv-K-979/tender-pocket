#!/usr/bin/env bash
# Data-only dump of the seeded app tables for one tier (run right after load.py + validate.py).
#
#   bash dump_tier.sh --tier 1000 --approved [--pg-container NAME] [--workdir DIR]
#
# Output: $LT_WORKDIR/dumps/tier_<N>.sql.gz (plain SQL: COPY blocks + setval) and .meta.
# reset.sh reloads it in one transaction. Reads the database only.
source "$(dirname "$0")/_pg_common.sh"
parse_common_args "$@"
[ -n "$TIER" ] || { echo "--tier is required" >&2; exit 2; }

mkdir -p "$LT_WORKDIR/dumps"
OUT="$LT_WORKDIR/dumps/tier_${TIER}.sql.gz"
TENDERS="$(psql_ro "SELECT count(*) FROM tenders;")"
banner "pg_dump --data-only of: ${LT_TABLES[*]}" \
       "current tenders rows: $TENDERS  ->  $OUT" \
       "No data is modified."
require_approved

TARGS=""
for t in "${LT_TABLES[@]}"; do TARGS="$TARGS --table=public.$t"; done
pg_sh "pg_dump --data-only --no-owner --no-privileges $TARGS -U \"\$POSTGRES_USER\" -d \"\${POSTGRES_DB:-\$POSTGRES_USER}\"" \
  | gzip -3 > "$OUT.partial"
mv "$OUT.partial" "$OUT"
{
  echo "tier=$TIER"
  echo "dumped_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for t in "${LT_TABLES[@]}"; do echo "rows.$t=$(psql_ro "SELECT count(*) FROM $t;")"; done
} > "$LT_WORKDIR/dumps/tier_${TIER}.meta"
echo "dump ok: $OUT ($(du -h "$OUT" | cut -f1))"
