#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env in $ROOT_DIR"
  echo "Copy .env.rpi.example to .env and edit it first."
  exit 1
fi

npm ci
npm run build --workspace @vibe/shared
npm run build --workspace @vibe/backend
npm run migrate --workspace @vibe/backend
npm run prod:frontend:deploy

echo "Deploy complete."
echo "Run backend with: npm run prod:backend:run-host"
