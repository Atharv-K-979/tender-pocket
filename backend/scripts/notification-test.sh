#!/usr/bin/env bash
# =============================================================================
# TenderPocket daily mails: local test helper
#
# Mail tests with large lists (sends real test mails to the addresses in .env.notification):
#   backend/scripts/notification-test.sh seed-bulk            add 940 bulk test tenders (NBULK-...)
#   backend/scripts/notification-test.sh mailtest 1           MIS, Pending, 480 tenders -> 200 in mail + Excel (480)
#   backend/scripts/notification-test.sh mailtest 2           Executive, Due, 190 long rows -> Excel (190)
#   backend/scripts/notification-test.sh mailtest 3           Executive, Pending, 60 tenders -> all in mail, no Excel
#   backend/scripts/notification-test.sh mailtest 4           Admin, Pending, 540 tenders -> 200 in mail + Excel (540)
#   backend/scripts/notification-test.sh mailtest 5           MIS, Due, 400 tenders -> mail + Excel (400)
#   backend/scripts/notification-test.sh mailtest all         all five, one after another
#   Add an address to send there instead:  mailtest 1 someone@gmail.com
#
# Other tools:
#   backend/scripts/notification-test.sh seed                 add 22 [TEST] tenders covering every step (NTEST-...)
#   backend/scripts/notification-test.sh summary              what every login would get right now
#   backend/scripts/notification-test.sh preview misteam pending [NBULK-]
#                                                             save that mail as HTML (and its Excel, if any)
#   backend/scripts/notification-test.sh preview-all          save all 10 daily mails (5 logins x Due/Pending)
#   backend/scripts/notification-test.sh run                  send today's daily mails now (needs NOTIFY_ENABLED=true)
#   backend/scripts/notification-test.sh log                  today's send log for the daily mails
#   backend/scripts/notification-test.sh reset-today          forget today's daily sends so "run" sends again
#   backend/scripts/notification-test.sh cleanup              remove all test tenders and today's send log
#
# Test mails (mailtest) are marked [TEST], never count toward the daily limit of two mails,
# and use only the NBULK- tenders, so the numbers above are exact.
#
# Talks to the running Docker containers. Override with environment variables:
#   PG_CONTAINER (tender-pocket-postgres), DB_NAME (tender_pocket),
#   BACKEND_CONTAINER (tender-pocket-backend), BACKEND_URL (unset: call the backend inside
#   its container; set e.g. http://localhost:8090 to call it directly with curl),
#   ADMIN_USER (admin), ADMIN_PASSWORD (asked for when unset), OUT_DIR (./notification-previews)
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PG_CONTAINER="${PG_CONTAINER:-tender-pocket-postgres}"
DB_NAME="${DB_NAME:-tender_pocket}"
DB_USER="${DB_USER:-postgres}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-tender-pocket-backend}"
BACKEND_URL="${BACKEND_URL:-}"
ADMIN_USER="${ADMIN_USER:-admin}"
OUT_DIR="${OUT_DIR:-$PWD/notification-previews}"
BULK_PREFIX="NBULK-"

psql_db() { docker exec -i "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

# http GET|POST path [token] [json-body] -> response body on stdout; fails on an HTTP error
http() {
  local method="$1" path="$2" token="${3:-}" body="${4:-}"
  if [[ -n "$BACKEND_URL" ]]; then
    local args=(-sS -f -X "$method" "$BACKEND_URL$path")
    [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
    [[ -n "$body" ]] && args+=(-H "Content-Type: application/json" --data "$body")
    [[ "$method" == "POST" && -z "$body" ]] && args+=(--data "")
    curl "${args[@]}"
  else
    local args=(wget -qO- -T 900)
    [[ -n "$token" ]] && args+=(--header "Authorization: Bearer $token")
    if [[ "$method" == "POST" ]]; then
      args+=(--header "Content-Type: application/json" --post-data "${body:-{\}}")
    fi
    docker exec "$BACKEND_CONTAINER" "${args[@]}" "http://localhost:8090$path"
  fi
}

login() {
  if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
    read -r -s -p "Password for TenderPocket login '$ADMIN_USER': " ADMIN_PASSWORD; echo >&2
  fi
  local body token
  body="$(python3 -c 'import json,sys; print(json.dumps({"username": sys.argv[1], "password": sys.argv[2]}))' "$ADMIN_USER" "$ADMIN_PASSWORD")"
  token="$(http POST /api/auth/login "" "$body" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))' 2>/dev/null || true)"
  if [[ -z "$token" ]]; then
    echo "Login as '$ADMIN_USER' failed. Check ADMIN_USER / ADMIN_PASSWORD and that the backend is running." >&2
    exit 1
  fi
  echo "$token"
}

pretty() { python3 -m json.tool --no-ensure-ascii 2>/dev/null || cat; }

urlenc() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }

# preview_one token login type [idPrefix]: saves the HTML, and the Excel file when the mail has one
preview_one() {
  local token="$1" user="$2" type="$3" prefix="${4:-}" base query text
  local -a lines
  mkdir -p "$OUT_DIR"
  base="$OUT_DIR/${user}-${type}${prefix:+-${prefix%-}}"
  query="user=${user}&type=${type}${prefix:+&idPrefix=$(urlenc "$prefix")}"
  http GET "/api/notifications/preview?${query}" "$token" > "$base.html"
  # Read the whole reply before taking the first lines: piping into head would close the pipe
  # early, and with "set -o pipefail" that aborts the script.
  text="$(http GET "/api/notifications/preview?${query}&format=text" "$token")"
  mapfile -t lines <<< "$text"
  printf '%-10s %-8s %s\n           %s | %s\n           -> %s\n' "$user" "$type" "${lines[0]:-}" "${lines[2]:-}" "${lines[1]:-}" "$base.html"
  if [[ "${lines[2]:-}" == *"Excel: TenderPocket_"* ]]; then
    if http GET "/api/notifications/preview-attachment?${query}" "$token" > "$base.xlsx" 2>/dev/null; then
      echo "           -> $base.xlsx"
    else
      rm -f "$base.xlsx"
      echo "           (could not download the Excel file)"
    fi
  fi
}

# mailtest_one token number [to]
mailtest_one() {
  local token="$1" n="$2" to="${3:-}" user type expect query reply
  case "$n" in
    1) user=misteam;   type=pending; expect="480 rows: 200 in the mail + Excel with all 480" ;;
    2) user=executive; type=due;     expect="190 long rows: too big for Gmail, so Excel with all 190 (fewer in the mail)" ;;
    3) user=executive; type=pending; expect="60 rows: all in the mail, no Excel" ;;
    4) user=admin;     type=pending; expect="540 rows: 200 in the mail + Excel with all 540" ;;
    5) user=misteam;   type=due;     expect="400 rows: mail + Excel with all 400" ;;
    *) echo "Unknown test '$n'. Use 1, 2, 3, 4, 5 or all." >&2; exit 2 ;;
  esac
  query="user=${user}&type=${type}&idPrefix=$(urlenc "$BULK_PREFIX")${to:+&to=$(urlenc "$to")}"
  echo "Test $n: $user, $type mail. Expected: $expect"
  if ! reply="$(http POST "/api/notifications/send-test?${query}" "$token")"; then
    echo "  FAILED: the backend did not answer. Is it rebuilt with the new code and running?" >&2
    return 1
  fi
  python3 -c '
import json, sys
d = json.loads(sys.argv[1])
if d.get("result") == "SENT":
    print("  SENT to %s" % d["to"])
    print("  Subject: %s" % d["subject"])
    print("  Rows: %d in the mail body, %d in total; mail body %.1f KB" % (d["rows_in_mail_body"], d["rows_total"], d["mail_body_kb"]))
    if d.get("excel_attached"):
        print("  Excel attached: %s, %d rows, %.1f KB" % (d["excel_file"], d["excel_rows"], d["excel_kb"]))
    else:
        print("  No Excel needed: every row is in the mail")
else:
    print("  %s: %s" % (d.get("result"), d.get("error")))
    if d.get("result") == "NOTHING_TO_REPORT":
        print("  Did you run: notification-test.sh seed-bulk ?")
    sys.exit(1)
' "$reply"
}

cmd="${1:-help}"
case "$cmd" in
  seed|seed-bulk|cleanup|reset-today|log|summary|preview-all|run)
    if [[ $# -gt 1 ]]; then
      echo "'$cmd' takes no extra words. If you pasted a line with a # comment, leave the comment out" >&2
      echo "(zsh does not treat # as a comment when pasted). Run: $0 $cmd" >&2
      exit 2
    fi
    ;;
esac
case "$cmd" in
  seed)
    psql_db -q < "$HERE/notification-test-seed.sql"
    echo "Seeded the 22 [TEST] tenders (NTEST-). Next: $0 summary"
    ;;
  seed-bulk)
    psql_db -q < "$HERE/notification-bulk-seed.sql"
    echo "Seeded the 940 bulk test tenders (NBULK-). Next: $0 mailtest all"
    ;;
  cleanup)
    psql_db -q < "$HERE/notification-test-cleanup.sql"
    echo "Removed the test tenders (NTEST- and NBULK-) and today's send log."
    ;;
  reset-today)
    psql_db -q -c "DELETE FROM email_digest_log WHERE sent_date = (now() AT TIME ZONE 'Asia/Kolkata')::date;"
    echo "Today's send log cleared. '$0 run' will send every mail again."
    ;;
  log)
    psql_db -c "SELECT recipient_username AS login, digest_type AS mail, status, recipient_email AS sent_to, item_count AS rows, attempts, to_char(updated_at, 'HH24:MI:SS') AS at_ist, left(coalesce(error_message, ''), 80) AS error FROM email_digest_log WHERE sent_date = (now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY id;"
    ;;
  summary)
    token="$(login)"
    http GET /api/notifications/summary "$token" | pretty
    ;;
  preview)
    user="${2:?usage: $0 preview <login> <due|pending> [idPrefix]}"
    type="${3:-due}"
    token="$(login)"
    preview_one "$token" "$user" "$type" "${4:-}"
    ;;
  preview-all)
    token="$(login)"
    for user in misteam executive clearance tpc admin; do
      for type in due pending; do preview_one "$token" "$user" "$type"; done
    done
    echo "Open the files in a browser to see each mail exactly as it will be sent."
    ;;
  mailtest)
    which="${2:?usage: $0 mailtest <1|2|3|4|5|all> [send-to-address]}"
    if [[ $# -gt 3 ]]; then
      echo "Too many words after 'mailtest $which'. If you pasted a line with a # comment, leave the comment out:" >&2
      echo "zsh does not treat # as a comment when pasted. Example: $0 mailtest $which" >&2
      exit 2
    fi
    if [[ -n "${3:-}" && ! "${3}" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
      echo "'${3}' is not an email address. Leave it out to send to the addresses in .env.notification," >&2
      echo "or give one address, e.g. $0 mailtest $which someone@gmail.com" >&2
      exit 2
    fi
    token="$(login)"
    if [[ "$which" == "all" ]]; then
      failed=0
      for n in 1 2 3 4 5; do mailtest_one "$token" "$n" "${3:-}" || failed=1; echo; done
      [[ $failed -eq 0 ]] && echo "All 5 test mails sent. Check the inboxes (and spam the first time)." || { echo "Some test mails failed (see above)." >&2; exit 1; }
    else
      mailtest_one "$token" "$which" "${3:-}"
    fi
    ;;
  run)
    token="$(login)"
    http POST /api/notifications/run "$token" | pretty
    ;;
  *)
    # print the header comment block (between the two "# ====" lines)
    awk 'NR > 2 && /^# ====/ { exit } NR > 2 { sub(/^# ?/, ""); print }' "$0"
    ;;
esac
