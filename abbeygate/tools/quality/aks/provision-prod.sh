#!/usr/bin/env bash
set -euo pipefail

# Production AKS + AGIC provisioning script.
# Usage:
#   ./tools/quality/aks/provision-prod.sh
#
# Required env:
#   SUBSCRIPTION_ID
#   RESOURCE_GROUP
#   LOCATION
#   AKS_CLUSTER_NAME
#   APP_GW_NAME
#   APP_GW_SUBNET_NAME
#   AKS_VNET_NAME
#   AKS_SUBNET_NAME
#   KEYVAULT_NAME
#   LOG_ANALYTICS_NAME
# Optional env:
#   ACR_NAME (default: abbeygateacr)
#   AKS_PRIVATE_CLUSTER=true|false (default: true)
#   AKS_PRIVATE_DNS_ZONE (default: System; use "none" to skip)
#   CREATE_PRIVATE_ENDPOINTS=true|false (default: false)
#   PRIVATE_ENDPOINT_SUBNET_NAME (default: private-endpoints-subnet)
#   PRIVATE_ENDPOINT_SUBNET_PREFIX (default: 10.30.3.0/24)
#   POSTGRES_RESOURCE_ID, REDIS_RESOURCE_ID, STORAGE_RESOURCE_ID (required if CREATE_PRIVATE_ENDPOINTS=true)
#   POSTGRES_PRIVATE_DNS_ZONE (default: privatelink.postgres.database.azure.com)
#   REDIS_PRIVATE_DNS_ZONE (default: privatelink.redis.cache.windows.net)
#   STORAGE_BLOB_PRIVATE_DNS_ZONE (default: privatelink.blob.core.windows.net)
#   FRONTDOOR_PROFILE_NAME (optional - created only if provided)
#   FRONTDOOR_SKU (default: Standard_AzureFrontDoor)

: "${SUBSCRIPTION_ID:?Missing SUBSCRIPTION_ID}"
: "${RESOURCE_GROUP:?Missing RESOURCE_GROUP}"
: "${LOCATION:?Missing LOCATION}"
: "${AKS_CLUSTER_NAME:?Missing AKS_CLUSTER_NAME}"
: "${APP_GW_NAME:?Missing APP_GW_NAME}"
: "${APP_GW_SUBNET_NAME:?Missing APP_GW_SUBNET_NAME}"
: "${AKS_VNET_NAME:?Missing AKS_VNET_NAME}"
: "${AKS_SUBNET_NAME:?Missing AKS_SUBNET_NAME}"
: "${KEYVAULT_NAME:?Missing KEYVAULT_NAME}"
: "${LOG_ANALYTICS_NAME:?Missing LOG_ANALYTICS_NAME}"
APP_GW_WAF_POLICY_NAME="${APP_GW_WAF_POLICY_NAME:-${APP_GW_NAME}-waf-policy}"
ACR_NAME="${ACR_NAME:-abbeygateacr}"
AKS_PRIVATE_CLUSTER="${AKS_PRIVATE_CLUSTER:-true}"
AKS_PRIVATE_DNS_ZONE="${AKS_PRIVATE_DNS_ZONE:-System}"
CREATE_PRIVATE_ENDPOINTS="${CREATE_PRIVATE_ENDPOINTS:-false}"
PRIVATE_ENDPOINT_SUBNET_NAME="${PRIVATE_ENDPOINT_SUBNET_NAME:-private-endpoints-subnet}"
PRIVATE_ENDPOINT_SUBNET_PREFIX="${PRIVATE_ENDPOINT_SUBNET_PREFIX:-10.30.3.0/24}"
POSTGRES_PRIVATE_DNS_ZONE="${POSTGRES_PRIVATE_DNS_ZONE:-privatelink.postgres.database.azure.com}"
REDIS_PRIVATE_DNS_ZONE="${REDIS_PRIVATE_DNS_ZONE:-privatelink.redis.cache.windows.net}"
STORAGE_BLOB_PRIVATE_DNS_ZONE="${STORAGE_BLOB_PRIVATE_DNS_ZONE:-privatelink.blob.core.windows.net}"
FRONTDOOR_SKU="${FRONTDOOR_SKU:-Standard_AzureFrontDoor}"

create_private_endpoint() {
  local endpoint_name="$1"
  local target_resource_id="$2"
  local group_id="$3"
  local dns_zone_name="$4"
  local dns_zone_group_name="$5"
  local dns_zone_link_name="$6"

  if ! az network private-endpoint show --resource-group "${RESOURCE_GROUP}" --name "${endpoint_name}" >/dev/null 2>&1; then
    az network private-endpoint create \
      --resource-group "${RESOURCE_GROUP}" \
      --name "${endpoint_name}" \
      --subnet "${PRIVATE_ENDPOINT_SUBNET_ID}" \
      --private-connection-resource-id "${target_resource_id}" \
      --group-id "${group_id}" \
      --connection-name "${endpoint_name}-conn" >/dev/null
  fi

  if ! az network private-dns zone show --resource-group "${RESOURCE_GROUP}" --name "${dns_zone_name}" >/dev/null 2>&1; then
    az network private-dns zone create \
      --resource-group "${RESOURCE_GROUP}" \
      --name "${dns_zone_name}" >/dev/null
  fi

  if ! az network private-dns link vnet show --resource-group "${RESOURCE_GROUP}" --zone-name "${dns_zone_name}" --name "${dns_zone_link_name}" >/dev/null 2>&1; then
    az network private-dns link vnet create \
      --resource-group "${RESOURCE_GROUP}" \
      --zone-name "${dns_zone_name}" \
      --name "${dns_zone_link_name}" \
      --virtual-network "${AKS_VNET_NAME}" \
      --registration-enabled false >/dev/null
  fi

  if ! az network private-endpoint dns-zone-group show --resource-group "${RESOURCE_GROUP}" --endpoint-name "${endpoint_name}" --name "${dns_zone_group_name}" >/dev/null 2>&1; then
    az network private-endpoint dns-zone-group create \
      --resource-group "${RESOURCE_GROUP}" \
      --endpoint-name "${endpoint_name}" \
      --name "${dns_zone_group_name}" \
      --private-dns-zone "${dns_zone_name}" \
      --zone-name "${dns_zone_name}" >/dev/null
  fi
}

echo "Selecting subscription ${SUBSCRIPTION_ID}"
az account set --subscription "${SUBSCRIPTION_ID}"

echo "Ensuring resource group ${RESOURCE_GROUP}"
az group create --name "${RESOURCE_GROUP}" --location "${LOCATION}" >/dev/null

echo "Ensuring Log Analytics workspace ${LOG_ANALYTICS_NAME}"
if ! az monitor log-analytics workspace show --resource-group "${RESOURCE_GROUP}" --workspace-name "${LOG_ANALYTICS_NAME}" >/dev/null 2>&1; then
  az monitor log-analytics workspace create \
    --resource-group "${RESOURCE_GROUP}" \
    --workspace-name "${LOG_ANALYTICS_NAME}" \
    --location "${LOCATION}" >/dev/null
fi

echo "Ensuring Key Vault ${KEYVAULT_NAME}"
if ! az keyvault show --resource-group "${RESOURCE_GROUP}" --name "${KEYVAULT_NAME}" >/dev/null 2>&1; then
  az keyvault create \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${KEYVAULT_NAME}" \
    --location "${LOCATION}" \
    --sku standard >/dev/null
fi

echo "Ensuring VNet and subnets"
if ! az network vnet show --resource-group "${RESOURCE_GROUP}" --name "${AKS_VNET_NAME}" >/dev/null 2>&1; then
  az network vnet create \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${AKS_VNET_NAME}" \
    --location "${LOCATION}" \
    --address-prefixes 10.30.0.0/16 \
    --subnet-name "${AKS_SUBNET_NAME}" \
    --subnet-prefixes 10.30.1.0/24 >/dev/null
fi

if ! az network vnet subnet show --resource-group "${RESOURCE_GROUP}" --vnet-name "${AKS_VNET_NAME}" --name "${APP_GW_SUBNET_NAME}" >/dev/null 2>&1; then
  az network vnet subnet create \
    --resource-group "${RESOURCE_GROUP}" \
    --vnet-name "${AKS_VNET_NAME}" \
    --name "${APP_GW_SUBNET_NAME}" \
    --address-prefixes 10.30.2.0/24 >/dev/null
fi

if [[ "${CREATE_PRIVATE_ENDPOINTS}" == "true" ]] && ! az network vnet subnet show --resource-group "${RESOURCE_GROUP}" --vnet-name "${AKS_VNET_NAME}" --name "${PRIVATE_ENDPOINT_SUBNET_NAME}" >/dev/null 2>&1; then
  az network vnet subnet create \
    --resource-group "${RESOURCE_GROUP}" \
    --vnet-name "${AKS_VNET_NAME}" \
    --name "${PRIVATE_ENDPOINT_SUBNET_NAME}" \
    --address-prefixes "${PRIVATE_ENDPOINT_SUBNET_PREFIX}" \
    --disable-private-endpoint-network-policies true >/dev/null
fi

AKS_SUBNET_ID="$(az network vnet subnet show --resource-group "${RESOURCE_GROUP}" --vnet-name "${AKS_VNET_NAME}" --name "${AKS_SUBNET_NAME}" --query id -o tsv)"
APPGW_SUBNET_ID="$(az network vnet subnet show --resource-group "${RESOURCE_GROUP}" --vnet-name "${AKS_VNET_NAME}" --name "${APP_GW_SUBNET_NAME}" --query id -o tsv)"
if [[ "${CREATE_PRIVATE_ENDPOINTS}" == "true" ]]; then
  PRIVATE_ENDPOINT_SUBNET_ID="$(az network vnet subnet show --resource-group "${RESOURCE_GROUP}" --vnet-name "${AKS_VNET_NAME}" --name "${PRIVATE_ENDPOINT_SUBNET_NAME}" --query id -o tsv)"
fi

echo "Ensuring Application Gateway WAF policy ${APP_GW_WAF_POLICY_NAME}"
if ! az network application-gateway waf-policy show --resource-group "${RESOURCE_GROUP}" --name "${APP_GW_WAF_POLICY_NAME}" >/dev/null 2>&1; then
  az network application-gateway waf-policy create \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${APP_GW_WAF_POLICY_NAME}" \
    --location "${LOCATION}" \
    --type OWASP \
    --version 3.2 >/dev/null
fi
APPGW_WAF_POLICY_ID="$(az network application-gateway waf-policy show --resource-group "${RESOURCE_GROUP}" --name "${APP_GW_WAF_POLICY_NAME}" --query id -o tsv)"

echo "Ensuring Application Gateway ${APP_GW_NAME}"
if ! az network application-gateway show --resource-group "${RESOURCE_GROUP}" --name "${APP_GW_NAME}" >/dev/null 2>&1; then
  az network application-gateway create \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${APP_GW_NAME}" \
    --location "${LOCATION}" \
    --sku WAF_v2 \
    --capacity 2 \
    --priority 100 \
    --waf-policy "${APPGW_WAF_POLICY_ID}" \
    --public-ip-address "${APP_GW_NAME}-pip" \
    --vnet-name "${AKS_VNET_NAME}" \
    --subnet "${APP_GW_SUBNET_NAME}" >/dev/null
fi

APPGW_ID="$(az network application-gateway show --resource-group "${RESOURCE_GROUP}" --name "${APP_GW_NAME}" --query id -o tsv)"

echo "Ensuring AKS cluster ${AKS_CLUSTER_NAME}"
if ! az aks show --resource-group "${RESOURCE_GROUP}" --name "${AKS_CLUSTER_NAME}" >/dev/null 2>&1; then
  PRIVATE_CLUSTER_ARGS=()
  if [[ "${AKS_PRIVATE_CLUSTER}" == "true" ]]; then
    PRIVATE_CLUSTER_ARGS+=(--enable-private-cluster)
    if [[ -n "${AKS_PRIVATE_DNS_ZONE}" && "${AKS_PRIVATE_DNS_ZONE}" != "none" ]]; then
      PRIVATE_CLUSTER_ARGS+=(--private-dns-zone "${AKS_PRIVATE_DNS_ZONE}")
    fi
  fi

  az aks create \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${AKS_CLUSTER_NAME}" \
    --location "${LOCATION}" \
    --node-count 2 \
    --node-vm-size Standard_D4s_v5 \
    --enable-managed-identity \
    --network-plugin azure \
    --vnet-subnet-id "${AKS_SUBNET_ID}" \
    --attach-acr "${ACR_NAME}" \
    --enable-oidc-issuer \
    --enable-workload-identity \
    "${PRIVATE_CLUSTER_ARGS[@]}" \
    --generate-ssh-keys >/dev/null
fi

echo "Ensuring AKS node pools"
if ! az aks nodepool show --resource-group "${RESOURCE_GROUP}" --cluster-name "${AKS_CLUSTER_NAME}" --name apps >/dev/null 2>&1; then
  az aks nodepool add \
    --resource-group "${RESOURCE_GROUP}" \
    --cluster-name "${AKS_CLUSTER_NAME}" \
    --name apps \
    --node-count 2 \
    --node-vm-size Standard_D4s_v5 \
    --mode User >/dev/null
fi

if ! az aks nodepool show --resource-group "${RESOURCE_GROUP}" --cluster-name "${AKS_CLUSTER_NAME}" --name workers >/dev/null 2>&1; then
  az aks nodepool add \
    --resource-group "${RESOURCE_GROUP}" \
    --cluster-name "${AKS_CLUSTER_NAME}" \
    --name workers \
    --node-count 1 \
    --node-vm-size Standard_D4s_v5 \
    --mode User >/dev/null
fi

echo "Enabling AGIC addon"
az aks enable-addons \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${AKS_CLUSTER_NAME}" \
  --addons ingress-appgw \
  --appgw-id "${APPGW_ID}" >/dev/null

echo "Attaching Container Insights"
WORKSPACE_ID="$(az monitor log-analytics workspace show --resource-group "${RESOURCE_GROUP}" --workspace-name "${LOG_ANALYTICS_NAME}" --query id -o tsv)"
az aks enable-addons \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${AKS_CLUSTER_NAME}" \
  --addons monitoring \
  --workspace-resource-id "${WORKSPACE_ID}" >/dev/null

if [[ "${CREATE_PRIVATE_ENDPOINTS}" == "true" ]]; then
  : "${POSTGRES_RESOURCE_ID:?Missing POSTGRES_RESOURCE_ID (required when CREATE_PRIVATE_ENDPOINTS=true)}"
  : "${REDIS_RESOURCE_ID:?Missing REDIS_RESOURCE_ID (required when CREATE_PRIVATE_ENDPOINTS=true)}"
  : "${STORAGE_RESOURCE_ID:?Missing STORAGE_RESOURCE_ID (required when CREATE_PRIVATE_ENDPOINTS=true)}"

  echo "Ensuring private endpoints for Postgres, Redis, and Blob"
  create_private_endpoint \
    "${AKS_CLUSTER_NAME}-pe-postgres" \
    "${POSTGRES_RESOURCE_ID}" \
    "postgresqlServer" \
    "${POSTGRES_PRIVATE_DNS_ZONE}" \
    "postgres-dns-zone-group" \
    "${AKS_VNET_NAME}-postgres-link"

  create_private_endpoint \
    "${AKS_CLUSTER_NAME}-pe-redis" \
    "${REDIS_RESOURCE_ID}" \
    "redisCache" \
    "${REDIS_PRIVATE_DNS_ZONE}" \
    "redis-dns-zone-group" \
    "${AKS_VNET_NAME}-redis-link"

  create_private_endpoint \
    "${AKS_CLUSTER_NAME}-pe-blob" \
    "${STORAGE_RESOURCE_ID}" \
    "blob" \
    "${STORAGE_BLOB_PRIVATE_DNS_ZONE}" \
    "blob-dns-zone-group" \
    "${AKS_VNET_NAME}-blob-link"
fi

if [[ -n "${FRONTDOOR_PROFILE_NAME:-}" ]]; then
  echo "Ensuring Front Door profile ${FRONTDOOR_PROFILE_NAME}"
  if ! az afd profile show --resource-group "${RESOURCE_GROUP}" --profile-name "${FRONTDOOR_PROFILE_NAME}" >/dev/null 2>&1; then
    az afd profile create \
      --resource-group "${RESOURCE_GROUP}" \
      --profile-name "${FRONTDOOR_PROFILE_NAME}" \
      --sku "${FRONTDOOR_SKU}" >/dev/null
  fi
fi

echo "Provisioning complete."
echo "Next: az aks get-credentials --resource-group ${RESOURCE_GROUP} --name ${AKS_CLUSTER_NAME}"
