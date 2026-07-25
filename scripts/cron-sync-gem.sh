#!/bin/bash
# Swings to the correct directory and executes the TenderPocket GeM keyword sync task
cd /Users/anuthibhansali/.gemini/antigravity/scratch/tender-pocket

# Set PATH to ensure node can find its executables/libs
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

echo "=== GeM Sync started at $(date) ===" >> cron-sync-gem.log

# Wait for internet connectivity
echo "Checking internet connection..." >> cron-sync-gem.log
for i in {1..30}; do
  if ping -c 1 -W 2 google.com >/dev/null 2>&1; then
    echo "Internet connected! Letting connection stabilize for 10s..." >> cron-sync-gem.log
    sleep 10
    break
  fi
  echo "Waiting for internet connection (attempt $i/30)..." >> cron-sync-gem.log
  sleep 2
done

/usr/local/bin/node --env-file=.env scripts/sync-gem.js >> cron-sync-gem.log 2>&1
echo "=== GeM Sync completed at $(date) ===" >> cron-sync-gem.log
