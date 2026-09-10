#!/usr/bin/env bash
set -euo pipefail

# Post-deploy smoke checks for AKS production rollout.
# Required env:
#   APP_BASE_URL (or AKS_API_BASE_URL / AKS_API_HOST fallback)
# Optional env:
#   API_SMOKE_EMAIL
#   API_SMOKE_PASSWORD
#   API_V1_SMOKE_KEY
#   API_V1_PROGRAM_ID
#   API_V1_SMOKE_TENANT_ID
#   PUBLIC_SESSION_TOKEN
#   SMOKE_ARTIFACT_PATH
#   SMOKE_STRICT_APP_JOURNEYS

APP_BASE_URL="${APP_BASE_URL:-${AKS_API_BASE_URL:-}}"
SMOKE_STRICT_APP_JOURNEYS="${SMOKE_STRICT_APP_JOURNEYS:-1}"
if [[ -z "${APP_BASE_URL}" && -n "${AKS_API_HOST:-}" ]]; then
  if [[ "${AKS_API_HOST}" =~ ^https?:// ]]; then
    APP_BASE_URL="${AKS_API_HOST}"
  else
    APP_BASE_URL="https://${AKS_API_HOST}"
  fi
fi

if [[ -z "${APP_BASE_URL}" ]] && command -v kubectl >/dev/null 2>&1; then
  ns="${AKS_NAMESPACE:-default}"
  ingress_host="$(kubectl get ingress -n "${ns}" -o jsonpath='{.items[0].spec.rules[0].host}' 2>/dev/null || true)"
  if [[ -n "${ingress_host}" ]]; then
    APP_BASE_URL="https://${ingress_host}"
  fi
fi

: "${APP_BASE_URL:?Missing APP_BASE_URL (or AKS_API_BASE_URL / AKS_API_HOST)}"

PORT_FORWARD_PID=""
cleanup_port_forward() {
  if [[ -n "${PORT_FORWARD_PID}" ]]; then
    kill "${PORT_FORWARD_PID}" >/dev/null 2>&1 || true
    wait "${PORT_FORWARD_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup_port_forward EXIT

ensure_local_port_forward_base_url() {
  command -v kubectl >/dev/null 2>&1 || return 1
  local ns="${AKS_NAMESPACE:-default}"
  local release="${HELM_RELEASE:-abbeygate}"
  local svc_name
  svc_name="$(kubectl get svc -n "${ns}" -l "app.kubernetes.io/component=api,app.kubernetes.io/instance=${release}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -z "${svc_name}" ]]; then
    return 1
  fi
  kubectl -n "${ns}" port-forward "svc/${svc_name}" 18080:80 >/tmp/abbeygate-port-forward.log 2>&1 &
  PORT_FORWARD_PID="$!"
  for _ in {1..20}; do
    if curl -fsS "http://127.0.0.1:18080/health" >/dev/null 2>&1; then
      APP_BASE_URL="http://127.0.0.1:18080"
      return 0
    fi
    sleep 1
  done
  return 1
}

echo "Smoke check 1/3: /health"
if ! curl -fsS "${APP_BASE_URL%/}/health" >/dev/null; then
  echo "Primary health check failed for ${APP_BASE_URL}; trying in-cluster port-forward fallback..."
  if ensure_local_port_forward_base_url; then
    echo "Fallback health check via ${APP_BASE_URL}"
    curl -fsS "${APP_BASE_URL%/}/health" >/dev/null
  else
    echo "Unable to reach API via configured host and no in-cluster fallback available."
    exit 1
  fi
fi

# Provider integrations (CardCorp, Creditsafe, …). Returns 503 in production
# when a required integration is unconfigured so a missing K8s secret key fails
# the deploy instead of silently returning 501 at the first checkout.
echo "Smoke check 1b/3: /health/integrations"
INTEGRATION_HEALTH_STATUS="$(curl -sS -o /tmp/abbeygate-integration-health.json -w '%{http_code}' "${APP_BASE_URL%/}/health/integrations" || echo '000')"
if [[ -s /tmp/abbeygate-integration-health.json ]]; then
  cat /tmp/abbeygate-integration-health.json
  echo
fi
if [[ "${INTEGRATION_HEALTH_STATUS}" != "200" ]]; then
  echo "Integration health check returned HTTP ${INTEGRATION_HEALTH_STATUS}. A required provider integration is unconfigured."
  exit 1
fi

if [[ -n "${API_SMOKE_EMAIL:-}" && -n "${API_SMOKE_PASSWORD:-}" ]]; then
  echo "Smoke check 2/3: auth login"
  curl -fsS \
    -H "content-type: application/json" \
    -d "{\"email\":\"${API_SMOKE_EMAIL}\",\"password\":\"${API_SMOKE_PASSWORD}\"}" \
    "${APP_BASE_URL%/}/api/auth/login" >/dev/null
else
  echo "Smoke check 2/3 skipped (API_SMOKE_EMAIL/API_SMOKE_PASSWORD not configured)"
fi

if [[ -n "${QUEUE_SMOKE_ENDPOINT:-}" ]]; then
  echo "Smoke check 3/4: queue roundtrip"
  curl -fsS -X POST "${QUEUE_SMOKE_ENDPOINT}" >/dev/null
else
  echo "Smoke check 3/4 skipped (QUEUE_SMOKE_ENDPOINT not configured)"
fi

echo "Smoke check 4/4: Quote -> Bind -> Issue -> Doc Pack"
SMOKE_ARTIFACT_PATH="${SMOKE_ARTIFACT_PATH:-/tmp/quote-bind-issue-smoke.json}"
if ! node ./tools/quality/aks/quote-bind-issue-smoke.mjs; then
  if [[ "${SMOKE_STRICT_APP_JOURNEYS}" =~ ^(0|false|no)$ ]]; then
    echo "Quote-bind smoke failed, but SMOKE_STRICT_APP_JOURNEYS=${SMOKE_STRICT_APP_JOURNEYS}; continuing with diagnostic artifact only."
  else
    exit 1
  fi
fi

echo "Smoke checks completed."
