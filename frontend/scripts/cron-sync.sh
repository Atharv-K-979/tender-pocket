#!/bin/bash
# Swings to the correct directory and executes the TenderPocket email sync task
cd /Users/anuthibhansali/.gemini/antigravity/scratch/tender-pocket

# Set PATH to ensure node can find its executables/libs
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

echo "=== Sync started at $(date) ===" >> cron-sync.log

# Wait for internet connectivity
echo "Checking internet connection..." >> cron-sync.log
for i in {1..30}; do
  if ping -c 1 -W 2 google.com >/dev/null 2>&1; then
    echo "Internet connected! Letting connection stabilize for 10s..." >> cron-sync.log
    sleep 10
    break
  fi
  echo "Waiting for internet connection (attempt $i/30)..." >> cron-sync.log
  sleep 2
done

/usr/local/bin/node --env-file=.env scripts/sync-emails.js >> cron-sync.log 2>&1
/usr/local/bin/node --env-file=.env scripts/send-alerts.js >> cron-sync.log 2>&1
echo "=== Sync completed at $(date) ===" >> cron-sync.log
