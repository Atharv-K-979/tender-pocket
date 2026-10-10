#!/bin/sh
set -e

echo "Initializing TenderPocket environment..."

# Ensure public/documents directory exists
mkdir -p /app/public/documents

# Start Next.js server
echo "Starting Next.js production server on port ${PORT:-8085}..."
exec npm run start
