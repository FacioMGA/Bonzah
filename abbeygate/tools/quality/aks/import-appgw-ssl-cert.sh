#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1"
    exit 1
  }
}

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env: ${key}"
    exit 1
  fi
}

require_cmd az
require_env RESOURCE_GROUP
require_env APP_GW_NAME
require_env APPGW_SSL_CERT_NAME
require_env APPGW_SSL_CERT_PFX_PATH
require_env APPGW_SSL_CERT_PFX_PASSWORD

if [[ ! -f "${APPGW_SSL_CERT_PFX_PATH}" ]]; then
  echo "PFX file not found: ${APPGW_SSL_CERT_PFX_PATH}"
  exit 1
fi

echo "==> Ensuring App Gateway SSL cert ${APPGW_SSL_CERT_NAME} on ${APP_GW_NAME}"
if az network application-gateway ssl-cert show \
  --resource-group "${RESOURCE_GROUP}" \
  --gateway-name "${APP_GW_NAME}" \
  --name "${APPGW_SSL_CERT_NAME}" >/dev/null 2>&1; then
  az network application-gateway ssl-cert update \
    --resource-group "${RESOURCE_GROUP}" \
    --gateway-name "${APP_GW_NAME}" \
    --name "${APPGW_SSL_CERT_NAME}" \
    --cert-file "${APPGW_SSL_CERT_PFX_PATH}" \
    --cert-password "${APPGW_SSL_CERT_PFX_PASSWORD}" >/dev/null
  echo "Updated existing cert ${APPGW_SSL_CERT_NAME}."
else
  az network application-gateway ssl-cert create \
    --resource-group "${RESOURCE_GROUP}" \
    --gateway-name "${APP_GW_NAME}" \
    --name "${APPGW_SSL_CERT_NAME}" \
    --cert-file "${APPGW_SSL_CERT_PFX_PATH}" \
    --cert-password "${APPGW_SSL_CERT_PFX_PASSWORD}" >/dev/null
  echo "Created new cert ${APPGW_SSL_CERT_NAME}."
fi

echo "==> Verifying cert exists"
az network application-gateway ssl-cert show \
  --resource-group "${RESOURCE_GROUP}" \
  --gateway-name "${APP_GW_NAME}" \
  --name "${APPGW_SSL_CERT_NAME}" \
  --query "{name:name, provisioningState:provisioningState}" \
  -o table
