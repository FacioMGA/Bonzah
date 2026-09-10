#!/usr/bin/env bash
set -euo pipefail

# Dev server with logging for debugging.
# Captures startup logs so worker initialization can be audited.

CHECK_ONLY=false
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=true
fi

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1"
    exit 1
  }
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  return 1
}

require_cmd npm

API_PORT="${DEV_API_PORT:-3000}"
LOG_FILE="${DEV_LOG_FILE:-/tmp/abbeygate-dev-$(date +%s).log}"

if port_in_use "${API_PORT}"; then
  echo "Port ${API_PORT} is already in use. Stop the running process first."
  echo "Hint: lsof -nP -iTCP:${API_PORT} -sTCP:LISTEN"
  exit 1
fi

if [[ "${CHECK_ONLY}" == "true" ]]; then
  echo "Preflight OK (npm present, port ${API_PORT} free)."
  exit 0
fi

echo "Starting dev server with logging..."
echo "Logs will be written to: ${LOG_FILE}"
echo ""

export QUEUE_WORKERS_ENABLED="${QUEUE_WORKERS_ENABLED:-true}"
export NODE_ENV="${NODE_ENV:-development}"

npm run dev 2>&1 | tee "${LOG_FILE}"
