#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"

if [ ! -d "node_modules" ]; then
  echo "Dependencies are missing. Run 'npm install' first."
  exit 1
fi

if [ ! -f "client/dist/index.html" ]; then
  echo "Client build not found. Building frontend..."
  npm run build:client
fi

exec npm start
