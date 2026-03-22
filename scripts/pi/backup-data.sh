#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BACKUP_DIR="${1:-$ROOT_DIR/backups}"

mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/vibe-backend-data-$(date +%F-%H%M%S).tgz"

docker run --rm \
  -v vibe_backend_data:/data \
  -v "$BACKUP_DIR:/backup" \
  alpine sh -c "tar czf /backup/$(basename "$FILE") -C /data ."

echo "Backup created: $FILE"
