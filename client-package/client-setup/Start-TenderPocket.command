#!/bin/bash
cd "$(dirname "$0")"

# ===================================================
# TenderPocket Self-Updating Desktop Launcher (macOS)
# ===================================================

while true; do
    if [ -f "TenderPocket-update.jar" ]; then
        echo "==================================================="
        echo "🔄 Applying new TenderPocket application update..."
        echo "==================================================="
        mv -f TenderPocket-update.jar TenderPocket.jar
        echo "✅ Update successfully applied!"
        echo ""
    fi

    echo "==================================================="
    echo "Starting TenderPocket Desktop Application (macOS)..."
    echo "==================================================="

    lsof -ti:8080 | xargs kill -9 2>/dev/null || true

    open http://localhost:8080
    java -jar TenderPocket.jar

    if [ -f ".restart_trigger" ]; then
        rm -f .restart_trigger
        echo "🔄 Restarting application for update..."
        sleep 2
    else
        break
    fi
done
