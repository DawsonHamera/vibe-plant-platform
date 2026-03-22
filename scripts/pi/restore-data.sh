#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /absolute/path/to/backup.tgz"
  exit 1
fi

ARCHIVE="$1"
if [[ ! -f "$ARCHIVE" ]]; then
  echo "Archive not found: $ARCHIVE"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

docker compose --env-file .env -f docker-compose.prod.yml down || true

docker run --rm \
  -v vibe_backend_data:/data \
  -v "$(dirname "$ARCHIVE"):/backup" \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/$(basename "$ARCHIVE") -C /data"

echo "Restore complete. Redeploy frontend and restart backend host."
