#!/usr/bin/env bash
set -euo pipefail

BACKEND_BASE_URL="${1:-http://127.0.0.1:43000}"
FRONTEND_BASE_URL="${2:-http://127.0.0.1:48080}"

wait_for_url() {
  local url="$1"
  local max_attempts="${2:-30}"
  local delay_seconds="${3:-2}"

  for ((attempt=1; attempt<=max_attempts; attempt++)); do
    if curl --silent --show-error --fail --max-time 5 "$url" >/dev/null; then
      return 0
    fi

    if (( attempt == max_attempts )); then
      echo "Timed out waiting for $url after $max_attempts attempts" >&2
      return 1
    fi

    sleep "$delay_seconds"
  done
}

echo "Waiting for backend and frontend availability..."
wait_for_url "$BACKEND_BASE_URL/health"
wait_for_url "$FRONTEND_BASE_URL/"

echo "Running production smoke checks..."
curl --silent --show-error --fail --max-time 10 "$BACKEND_BASE_URL/health" >/dev/null
curl --silent --show-error --fail --max-time 10 "$BACKEND_BASE_URL/health/details" >/dev/null
curl --silent --show-error --fail --max-time 10 "$BACKEND_BASE_URL/telemetry/stats" >/dev/null
curl --silent --show-error --fail --max-time 10 "$FRONTEND_BASE_URL/" >/dev/null

echo "Smoke checks passed."
