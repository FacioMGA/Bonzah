#!/usr/bin/env bash
set -euo pipefail

# Configure continuity behavior at the edge.
#
# Required env:
#   SUBSCRIPTION_ID
#   RESOURCE_GROUP
#   APP_GW_NAME
#   CONTINUITY_MODE_URL
#
# Optional env:
#   CONTINUITY_502_URL (default: CONTINUITY_MODE_URL)
#   CONTINUITY_503_URL (default: CONTINUITY_MODE_URL)
#   CONTINUITY_504_URL (default: CONTINUITY_MODE_URL)
#   ENABLE_FRONTDOOR_FAILOVER=true|false (default: false)
#   FRONTDOOR_PROFILE_NAME
#   FRONTDOOR_ENDPOINT_NAME
#   FRONTDOOR_ORIGIN_GROUP_NAME (default: abbeygate-origins)
#   FRONTDOOR_PRIMARY_ORIGIN_NAME (default: appgw-primary)
#   FRONTDOOR_PRIMARY_ORIGIN_HOST
#   FRONTDOOR_SECONDARY_ORIGIN_NAME (default: continuity-secondary)
#   FRONTDOOR_SECONDARY_ORIGIN_HOST

: "${SUBSCRIPTION_ID:?Missing SUBSCRIPTION_ID}"
: "${RESOURCE_GROUP:?Missing RESOURCE_GROUP}"
: "${APP_GW_NAME:?Missing APP_GW_NAME}"
: "${CONTINUITY_MODE_URL:?Missing CONTINUITY_MODE_URL}"

ENABLE_FRONTDOOR_FAILOVER="${ENABLE_FRONTDOOR_FAILOVER:-false}"
CONTINUITY_502_URL="${CONTINUITY_502_URL:-${CONTINUITY_MODE_URL}}"
CONTINUITY_503_URL="${CONTINUITY_503_URL:-${CONTINUITY_MODE_URL}}"
CONTINUITY_504_URL="${CONTINUITY_504_URL:-${CONTINUITY_MODE_URL}}"
FRONTDOOR_ORIGIN_GROUP_NAME="${FRONTDOOR_ORIGIN_GROUP_NAME:-abbeygate-origins}"
FRONTDOOR_PRIMARY_ORIGIN_NAME="${FRONTDOOR_PRIMARY_ORIGIN_NAME:-appgw-primary}"
FRONTDOOR_SECONDARY_ORIGIN_NAME="${FRONTDOOR_SECONDARY_ORIGIN_NAME:-continuity-secondary}"

az account set --subscription "${SUBSCRIPTION_ID}"

echo "Configuring App Gateway custom error pages (502/503/504)"
for status in HttpStatus502 HttpStatus503 HttpStatus504; do
  az network application-gateway custom-error update \
    --resource-group "${RESOURCE_GROUP}" \
    --gateway-name "${APP_GW_NAME}" \
    --status-code "${status}" \
    --custom-error-page-url "${CONTINUITY_MODE_URL}" >/dev/null 2>&1 || \
  az network application-gateway custom-error create \
    --resource-group "${RESOURCE_GROUP}" \
    --gateway-name "${APP_GW_NAME}" \
    --status-code "${status}" \
    --custom-error-page-url "${CONTINUITY_MODE_URL}" >/dev/null
done

az network application-gateway custom-error update \
  --resource-group "${RESOURCE_GROUP}" \
  --gateway-name "${APP_GW_NAME}" \
  --status-code HttpStatus502 \
  --custom-error-page-url "${CONTINUITY_502_URL}" >/dev/null 2>&1 || true
az network application-gateway custom-error update \
  --resource-group "${RESOURCE_GROUP}" \
  --gateway-name "${APP_GW_NAME}" \
  --status-code HttpStatus503 \
  --custom-error-page-url "${CONTINUITY_503_URL}" >/dev/null 2>&1 || true
az network application-gateway custom-error update \
  --resource-group "${RESOURCE_GROUP}" \
  --gateway-name "${APP_GW_NAME}" \
  --status-code HttpStatus504 \
  --custom-error-page-url "${CONTINUITY_504_URL}" >/dev/null 2>&1 || true

if [[ "${ENABLE_FRONTDOOR_FAILOVER}" == "true" ]]; then
  : "${FRONTDOOR_PROFILE_NAME:?Missing FRONTDOOR_PROFILE_NAME}"
  : "${FRONTDOOR_ENDPOINT_NAME:?Missing FRONTDOOR_ENDPOINT_NAME}"
  : "${FRONTDOOR_PRIMARY_ORIGIN_HOST:?Missing FRONTDOOR_PRIMARY_ORIGIN_HOST}"
  : "${FRONTDOOR_SECONDARY_ORIGIN_HOST:?Missing FRONTDOOR_SECONDARY_ORIGIN_HOST}"

  echo "Configuring Front Door origin group failover"
  if ! az afd endpoint show --resource-group "${RESOURCE_GROUP}" --profile-name "${FRONTDOOR_PROFILE_NAME}" --endpoint-name "${FRONTDOOR_ENDPOINT_NAME}" >/dev/null 2>&1; then
    az afd endpoint create \
      --resource-group "${RESOURCE_GROUP}" \
      --profile-name "${FRONTDOOR_PROFILE_NAME}" \
      --endpoint-name "${FRONTDOOR_ENDPOINT_NAME}" \
      --enabled-state Enabled >/dev/null
  fi

  if ! az afd origin-group show --resource-group "${RESOURCE_GROUP}" --profile-name "${FRONTDOOR_PROFILE_NAME}" --origin-group-name "${FRONTDOOR_ORIGIN_GROUP_NAME}" >/dev/null 2>&1; then
    az afd origin-group create \
      --resource-group "${RESOURCE_GROUP}" \
      --profile-name "${FRONTDOOR_PROFILE_NAME}" \
      --origin-group-name "${FRONTDOOR_ORIGIN_GROUP_NAME}" \
      --probe-request-type GET \
      --probe-protocol Https \
      --probe-path "/health" \
      --sample-size 4 \
      --successful-samples-required 3 \
      --additional-latency-in-milliseconds 50 >/dev/null
  fi

  az afd origin create \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONTDOOR_PROFILE_NAME}" \
    --origin-group-name "${FRONTDOOR_ORIGIN_GROUP_NAME}" \
    --origin-name "${FRONTDOOR_PRIMARY_ORIGIN_NAME}" \
    --host-name "${FRONTDOOR_PRIMARY_ORIGIN_HOST}" \
    --origin-host-header "${FRONTDOOR_PRIMARY_ORIGIN_HOST}" \
    --priority 1 \
    --weight 1000 \
    --enabled-state Enabled >/dev/null 2>&1 || true

  az afd origin create \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONTDOOR_PROFILE_NAME}" \
    --origin-group-name "${FRONTDOOR_ORIGIN_GROUP_NAME}" \
    --origin-name "${FRONTDOOR_SECONDARY_ORIGIN_NAME}" \
    --host-name "${FRONTDOOR_SECONDARY_ORIGIN_HOST}" \
    --origin-host-header "${FRONTDOOR_SECONDARY_ORIGIN_HOST}" \
    --priority 2 \
    --weight 1000 \
    --enabled-state Enabled >/dev/null 2>&1 || true
fi

echo "Continuity edge configuration complete."
