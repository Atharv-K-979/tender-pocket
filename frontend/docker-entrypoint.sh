#!/bin/sh
set -e

echo "Initializing TenderPocket environment..."

# Create persistent storage folder inside mounted volume
mkdir -p /app/data/documents

# Remove local documents folder if it exists as a directory (and not a symlink)
if [ -d "/app/public/documents" ] && [ ! -L "/app/public/documents" ]; then
  echo "Moving existing documents to persistent volume..."
  cp -r /app/public/documents/. /app/data/documents/ 2>/dev/null || true
  rm -rf /app/public/documents
fi

# Create symbolic link to persistent documents folder
if [ ! -L "/app/public/documents" ]; then
  echo "Creating symbolic link for public/documents to persistent storage..."
  ln -sf /app/data/documents /app/public/documents
fi

# Start Next.js server
echo "Starting Next.js production server on port ${PORT:-3000}..."
exec npm run start
