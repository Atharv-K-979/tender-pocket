#!/usr/bin/env bash
# ==============================================================================
# Tender Pocket — Unified Local Full-Stack Launch Script
#
# Starts both Spring Boot Backend (Port 8080) and Next.js Frontend.
# Automatically intercepts Ctrl+C (SIGINT), terminal close (SIGHUP), and SIGTERM
# to cleanly terminate all processes and free localhost ports.
# ==============================================================================

set -uo pipefail

# Visual styling
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

# Ensure we run from the project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ------------------------------------------------------------------------------
# 1. Environment & API Keys Configuration
# ------------------------------------------------------------------------------
# Gemini API Key (defaults to user's configured key; can be overridden via env)
export GEMINI_API_KEY="${GEMINI_API_KEY:-AQ.Ab8RN6JAg7GjqfAmSZPQSgm7ZmmwmShprAuab3lPAN7o-elDBQ}"

# PostgreSQL Database Configuration
export DATABASE_URL="${DATABASE_URL:-jdbc:postgresql://localhost:5432/tender_pocket?sslmode=disable}"
export DATABASE_USERNAME="${DATABASE_USERNAME:-postgres}"
export DATABASE_PASSWORD="${DATABASE_PASSWORD:-password}"

# Ports configuration
BACKEND_PORT="${PORT:-8080}"
export PORT="$BACKEND_PORT"

# Auto-detect available frontend port (default 3000, fallback to 3001 if 3000 is occupied)
if [ -z "${FRONTEND_PORT:-}" ]; then
    if (exec 3<>/dev/tcp/127.0.0.1/3000) 2>/dev/null; then
        exec 3>&-
        FRONTEND_PORT=3001
    else
        FRONTEND_PORT=3000
    fi
fi

# Banner
echo -e "${BOLD}${CYAN}"
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║                  🚀  TENDER POCKET FULL-STACK LAUNCHER               ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Masked display of Gemini API Key
KEY_LEN=${#GEMINI_API_KEY}
if [ "$KEY_LEN" -gt 8 ]; then
    MASKED_KEY="${GEMINI_API_KEY:0:7}...${GEMINI_API_KEY: -4}"
else
    MASKED_KEY="***"
fi
echo -e "${GREEN}[✓] Gemini API Key loaded:${NC} ${MASKED_KEY} (${KEY_LEN} chars)"

# ------------------------------------------------------------------------------
# 2. Database & Port Pre-Flight Checks
# ------------------------------------------------------------------------------
# Check PostgreSQL container
if ! (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null; then
    if command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' | grep -q '^tender-pocket-postgres$'; then
        echo -e "${YELLOW}[!] PostgreSQL is offline. Starting container 'tender-pocket-postgres'...${NC}"
        docker start tender-pocket-postgres >/dev/null 2>&1 || true
        for i in {1..10}; do
            if (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null; then
                exec 3>&-
                echo -e "${GREEN}[✓] PostgreSQL database is online on port 5432.${NC}"
                break
            fi
            sleep 1
        done
    fi
else
    exec 3>&-
    echo -e "${GREEN}[✓] PostgreSQL database verified on port 5432.${NC}"
fi

# Stop old Docker Java container if it is holding port 8080
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q '^tender-pocket-java-app$'; then
    echo -e "${YELLOW}[!] Stopping old docker container 'tender-pocket-java-app' to release port ${BACKEND_PORT}...${NC}"
    docker stop tender-pocket-java-app >/dev/null 2>&1 || true
fi

# Clear any lingering processes on local ports
if command -v fuser >/dev/null 2>&1; then
    fuser -k -TERM "${BACKEND_PORT}/tcp" >/dev/null 2>&1 || true
    fuser -k -TERM "${FRONTEND_PORT}/tcp" >/dev/null 2>&1 || true
fi

# Prepare logs directory
mkdir -p logs
BACKEND_LOG="logs/backend.log"
FRONTEND_LOG="logs/frontend.log"
> "$BACKEND_LOG"
> "$FRONTEND_LOG"

# ------------------------------------------------------------------------------
# 3. Clean Shutdown & Cleanup Handler (Ctrl+C / Terminal Close)
# ------------------------------------------------------------------------------
PID_BACKEND=""
PID_FRONTEND=""
CLEANED_UP=0

cleanup() {
    local sig="${1:-EXIT}"
    if [ "$CLEANED_UP" -eq 1 ]; then
        return
    fi
    CLEANED_UP=1

    echo ""
    echo -e "${YELLOW}======================================================================${NC}"
    echo -e "${YELLOW}  🛑 Caught signal ${sig}. Stopping all Tender Pocket services...${NC}"
    echo -e "${YELLOW}======================================================================${NC}"

    # 1. Terminate Spring Boot backend
    if [ -n "$PID_BACKEND" ] && kill -0 "$PID_BACKEND" 2>/dev/null; then
        echo -e "${CYAN}[Cleanup] Terminating Spring Boot Backend (PID: ${PID_BACKEND})...${NC}"
        pkill -P "$PID_BACKEND" 2>/dev/null || true
        kill -TERM "$PID_BACKEND" 2>/dev/null || true
    fi

    # 2. Terminate Next.js frontend
    if [ -n "$PID_FRONTEND" ] && kill -0 "$PID_FRONTEND" 2>/dev/null; then
        echo -e "${BLUE}[Cleanup] Terminating Next.js Frontend (PID: ${PID_FRONTEND})...${NC}"
        pkill -P "$PID_FRONTEND" 2>/dev/null || true
        kill -TERM "$PID_FRONTEND" 2>/dev/null || true
    fi

    # 3. Release ports gracefully
    if command -v fuser >/dev/null 2>&1; then
        fuser -k -TERM "${BACKEND_PORT}/tcp" 2>/dev/null || true
        fuser -k -TERM "${FRONTEND_PORT}/tcp" 2>/dev/null || true
    fi

    # Give processes a moment to exit cleanly
    sleep 1

    # 4. Force kill if anything remained alive
    if [ -n "$PID_BACKEND" ] && kill -0 "$PID_BACKEND" 2>/dev/null; then
        kill -9 "$PID_BACKEND" 2>/dev/null || true
    fi
    if [ -n "$PID_FRONTEND" ] && kill -0 "$PID_FRONTEND" 2>/dev/null; then
        kill -9 "$PID_FRONTEND" 2>/dev/null || true
    fi

    if command -v fuser >/dev/null 2>&1; then
        fuser -k -9 "${BACKEND_PORT}/tcp" 2>/dev/null || true
        fuser -k -9 "${FRONTEND_PORT}/tcp" 2>/dev/null || true
    fi

    echo -e "${GREEN}[✓] All Tender Pocket processes stopped.${NC}"
    echo -e "${GREEN}[✓] Localhost ports (${BACKEND_PORT}, ${FRONTEND_PORT}) released successfully.${NC}"
    echo -e "${YELLOW}======================================================================${NC}"
    exit 0
}

# Trap signals: INT (Ctrl+C), TERM (kill), HUP (terminal closed), EXIT (script exit)
trap 'cleanup INT' INT
trap 'cleanup TERM' TERM
trap 'cleanup HUP' HUP
trap 'cleanup EXIT' EXIT

# ------------------------------------------------------------------------------
# 4. Launch Backend (Spring Boot)
# ------------------------------------------------------------------------------
echo -e "${CYAN}[Backend] Starting Spring Boot on http://localhost:${BACKEND_PORT}...${NC}"
(
    cd backend && \
    mvn spring-boot:run -Dspring-boot.run.jvmArguments="-Dserver.port=${BACKEND_PORT}"
) > >(tee "$BACKEND_LOG" | sed -u "s/^/$(printf '\033[0;36m[Backend]\033[0m ') /") 2>&1 &
PID_BACKEND=$!

# ------------------------------------------------------------------------------
# 5. Launch Frontend (Next.js)
# ------------------------------------------------------------------------------
# Clear stale Turbopack dev cache so new dynamic routes are guaranteed fresh
rm -rf frontend/.next

echo -e "${BLUE}[Frontend] Starting Next.js Dev Server on http://localhost:${FRONTEND_PORT}...${NC}"
(
    cd frontend && \
    npm run dev -- -p "$FRONTEND_PORT"
) > >(tee "$FRONTEND_LOG" | sed -u "s/^/$(printf '\033[0;34m[Frontend]\033[0m ') /") 2>&1 &
PID_FRONTEND=$!

# ------------------------------------------------------------------------------
# 6. Service Status Banner & Wait Loop
# ------------------------------------------------------------------------------
echo ""
echo -e "${BOLD}${GREEN}"
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║                  🎉  TENDER POCKET IS RUNNING!                       ║"
echo "╠══════════════════════════════════════════════════════════════════════╣"
printf "║  Frontend UI : %-53s ║\n" "http://localhost:${FRONTEND_PORT}"
printf "║  Backend API : %-53s ║\n" "http://localhost:${BACKEND_PORT}"
printf "║  Log Files   : %-53s ║\n" "logs/backend.log & logs/frontend.log"
echo "║                                                                      ║"
echo "║  Press [Ctrl + C] or close this terminal window to stop all services ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Supervise child processes — if either exits unexpectedly or user interrupts, cleanup
wait -n "$PID_BACKEND" "$PID_FRONTEND" 2>/dev/null || true
cleanup "PROCESS_EXIT"
