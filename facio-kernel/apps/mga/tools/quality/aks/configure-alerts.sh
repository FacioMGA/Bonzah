#!/usr/bin/env bash
set -euo pipefail

# Configure baseline AKS alert rules (metric alerts).
#
# Required env:
#   SUBSCRIPTION_ID
#   RESOURCE_GROUP
#   AKS_CLUSTER_NAME
#   ACTION_GROUP_ID
#
# Optional env:
#   APP_GW_NAME (enables App Gateway user-impact alerts)
#   APP_GW_5XX_THRESHOLD (default: 20)
#   APP_GW_UNHEALTHY_HOST_THRESHOLD (default: 1)
#   APP_GW_LATENCY_MS_THRESHOLD (default: 2000)
#   APP_INSIGHTS_COMPONENT_ID (enables app-level failure/latency alerts)
#   APP_REQUEST_FAILURE_THRESHOLD (default: 10)
#   APP_SERVER_RESPONSE_MS_THRESHOLD (default: 1500)

: "${SUBSCRIPTION_ID:?Missing SUBSCRIPTION_ID}"
: "${RESOURCE_GROUP:?Missing RESOURCE_GROUP}"
: "${AKS_CLUSTER_NAME:?Missing AKS_CLUSTER_NAME}"
: "${ACTION_GROUP_ID:?Missing ACTION_GROUP_ID}"

APP_GW_5XX_THRESHOLD="${APP_GW_5XX_THRESHOLD:-20}"
APP_GW_UNHEALTHY_HOST_THRESHOLD="${APP_GW_UNHEALTHY_HOST_THRESHOLD:-1}"
APP_GW_LATENCY_MS_THRESHOLD="${APP_GW_LATENCY_MS_THRESHOLD:-2000}"
APP_REQUEST_FAILURE_THRESHOLD="${APP_REQUEST_FAILURE_THRESHOLD:-10}"
APP_SERVER_RESPONSE_MS_THRESHOLD="${APP_SERVER_RESPONSE_MS_THRESHOLD:-1500}"

az account set --subscription "${SUBSCRIPTION_ID}"

AKS_ID="$(az aks show --resource-group "${RESOURCE_GROUP}" --name "${AKS_CLUSTER_NAME}" --query id -o tsv)"

echo "Creating/updating AKS CPU alert"
az monitor metrics alert create \
  --name "${AKS_CLUSTER_NAME}-cpu-high" \
  --resource-group "${RESOURCE_GROUP}" \
  --scopes "${AKS_ID}" \
  --condition "avg node_cpu_usage_percentage > 80" \
  --description "AKS node CPU high" \
  --evaluation-frequency 1m \
  --window-size 5m \
  --action "${ACTION_GROUP_ID}" >/dev/null

echo "Creating/updating AKS memory alert"
az monitor metrics alert create \
  --name "${AKS_CLUSTER_NAME}-memory-high" \
  --resource-group "${RESOURCE_GROUP}" \
  --scopes "${AKS_ID}" \
  --condition "avg node_memory_working_set_percentage > 85" \
  --description "AKS node memory high" \
  --evaluation-frequency 1m \
  --window-size 5m \
  --action "${ACTION_GROUP_ID}" >/dev/null

if [[ -n "${APP_GW_NAME:-}" ]]; then
  APP_GW_ID="$(az network application-gateway show --resource-group "${RESOURCE_GROUP}" --name "${APP_GW_NAME}" --query id -o tsv)"

  echo "Creating/updating App Gateway failed request alert"
  az monitor metrics alert create \
    --name "${APP_GW_NAME}-failed-requests-high" \
    --resource-group "${RESOURCE_GROUP}" \
    --scopes "${APP_GW_ID}" \
    --condition "total FailedRequests > ${APP_GW_5XX_THRESHOLD}" \
    --description "User-impacting failures are rising at the edge." \
    --evaluation-frequency 1m \
    --window-size 5m \
    --action "${ACTION_GROUP_ID}" >/dev/null

  echo "Creating/updating App Gateway unhealthy host alert"
  az monitor metrics alert create \
    --name "${APP_GW_NAME}-unhealthy-hosts" \
    --resource-group "${RESOURCE_GROUP}" \
    --scopes "${APP_GW_ID}" \
    --condition "avg UnhealthyHostCount >= ${APP_GW_UNHEALTHY_HOST_THRESHOLD}" \
    --description "Backend health degradation can break bind/doc generation paths." \
    --evaluation-frequency 1m \
    --window-size 5m \
    --action "${ACTION_GROUP_ID}" >/dev/null

  echo "Creating/updating App Gateway latency alert"
  az monitor metrics alert create \
    --name "${APP_GW_NAME}-backend-latency-high" \
    --resource-group "${RESOURCE_GROUP}" \
    --scopes "${APP_GW_ID}" \
    --condition "avg BackendResponseTime > ${APP_GW_LATENCY_MS_THRESHOLD}" \
    --description "Elevated backend latency impacts quote/bind UX." \
    --evaluation-frequency 1m \
    --window-size 5m \
    --action "${ACTION_GROUP_ID}" >/dev/null
fi

if [[ -n "${APP_INSIGHTS_COMPONENT_ID:-}" ]]; then
  echo "Creating/updating app request failure alert (Application Insights)"
  az monitor metrics alert create \
    --name "${AKS_CLUSTER_NAME}-app-failed-requests" \
    --resource-group "${RESOURCE_GROUP}" \
    --scopes "${APP_INSIGHTS_COMPONENT_ID}" \
    --condition "total requests/failed > ${APP_REQUEST_FAILURE_THRESHOLD}" \
    --description "Application failures exceed allowed threshold." \
    --evaluation-frequency 1m \
    --window-size 5m \
    --action "${ACTION_GROUP_ID}" >/dev/null

  echo "Creating/updating app server response time alert (Application Insights)"
  az monitor metrics alert create \
    --name "${AKS_CLUSTER_NAME}-app-latency-high" \
    --resource-group "${RESOURCE_GROUP}" \
    --scopes "${APP_INSIGHTS_COMPONENT_ID}" \
    --condition "avg requests/duration > ${APP_SERVER_RESPONSE_MS_THRESHOLD}" \
    --description "Application request latency exceeds SLO threshold." \
    --evaluation-frequency 1m \
    --window-size 5m \
    --action "${ACTION_GROUP_ID}" >/dev/null
fi

echo "Alert configuration complete."
