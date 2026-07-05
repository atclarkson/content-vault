#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$ROOT_DIR"

if [ ! -d "node_modules" ]; then
  echo "Dependencies are missing. Running npm install..."
  npm install
fi

echo "Building client..."
npm run build:client

echo "Starting Content Vault at http://localhost:3000"
./scripts/run-local.sh
