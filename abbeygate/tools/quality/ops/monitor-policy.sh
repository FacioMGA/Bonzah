#!/usr/bin/env bash
set -euo pipefail

# Real-time policy status monitor.
# Tracks the last 3 policies or a specific policy and document status.

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1"
    exit 1
  }
}

require_cmd psql

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_USER="${DB_USER:-admin}"
DB_NAME="${DB_NAME:-abbeygate_uw}"
DB_PASSWORD="${DB_PASSWORD:-password123}"
REFRESH_SECONDS="${REFRESH_SECONDS:-2}"

MONITOR_ONCE=false
POLICY_ID=""

for arg in "$@"; do
  if [[ "${arg}" == "--once" ]]; then
    MONITOR_ONCE=true
  else
    POLICY_ID="${arg}"
  fi
done

if [[ -n "${POLICY_ID}" ]] && [[ ! "${POLICY_ID}" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "Invalid policy id format. Expected UUID."
  exit 1
fi

run_psql() {
  local query="$1"
  PGPASSWORD="${DB_PASSWORD}" psql \
    -v ON_ERROR_STOP=1 \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    "${DB_NAME}" \
    -c "${query}"
}

render_last_policies() {
  run_psql "
    SELECT
      \"policyNumber\",
      status,
      \"createdAt\"::timestamp(0),
      (SELECT COUNT(*) FROM documents WHERE \"policyId\" = policies.id) AS doc_count
    FROM policies
    ORDER BY \"createdAt\" DESC
    LIMIT 3;
  "
}

render_policy() {
  run_psql "
    SELECT
      \"policyNumber\",
      status,
      \"createdAt\"::timestamp(0),
      (SELECT COUNT(*) FROM documents WHERE \"policyId\" = '${POLICY_ID}') AS doc_count,
      (SELECT COUNT(*) FROM documents WHERE \"policyId\" = '${POLICY_ID}' AND type = 'MOTOR_CERTIFICATE_PDF') AS has_cert
    FROM policies
    WHERE id = '${POLICY_ID}';
  "

  echo ""
  echo "Recent Documents:"
  run_psql "
    SELECT type, filename, \"createdAt\"::timestamp(0)
    FROM documents
    WHERE \"policyId\" = '${POLICY_ID}'
    ORDER BY \"createdAt\" DESC;
  "
}

if [[ -z "${POLICY_ID}" ]]; then
  echo "Monitoring last 3 policies (auto-refresh every ${REFRESH_SECONDS}s)..."
else
  echo "Monitoring policy: ${POLICY_ID} (auto-refresh every ${REFRESH_SECONDS}s)..."
fi
echo "Press Ctrl+C to stop"
echo ""

while true; do
  if [[ -t 1 ]]; then
    clear
  fi
  if [[ -z "${POLICY_ID}" ]]; then
    echo "=== Policy Status Monitor ==="
    echo "Time: $(date '+%H:%M:%S')"
    echo ""
    render_last_policies
  else
    echo "=== Policy Monitor: ${POLICY_ID} ==="
    echo "Time: $(date '+%H:%M:%S')"
    echo ""
    render_policy
  fi

  if [[ "${MONITOR_ONCE}" == "true" ]]; then
    break
  fi

  sleep "${REFRESH_SECONDS}"
done
