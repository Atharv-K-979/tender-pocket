#!/bin/bash
cd "$(dirname "$0")"

# ===================================================
# TenderPocket Self-Updating Desktop Launcher (macOS)
# ===================================================

while true; do
    # Hot-swap newly downloaded update JAR if present
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

    # Automatically free port 8080 if an old background instance was left running
    lsof -ti:8080 | xargs kill -9 2>/dev/null || true

    open http://localhost:8080
    java -jar TenderPocket.jar

    # Check if restart was requested via in-app update trigger
    if [ -f ".restart_trigger" ]; then
        rm -f .restart_trigger
        echo "🔄 Restarting application for update..."
        sleep 2
    else
        break
    fi
done
