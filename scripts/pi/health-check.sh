#!/usr/bin/env bash
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:43000}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:48080}"

echo "Checking backend health..."
curl -fsS "$BACKEND_URL/health" > /dev/null
echo "Checking backend details..."
curl -fsS "$BACKEND_URL/health/details" > /dev/null
echo "Checking frontend..."
curl -fsS "$FRONTEND_URL" > /dev/null

echo "All health checks passed."
