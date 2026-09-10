#!/usr/bin/env bash
set -euo pipefail

# Decommission legacy App Service after AKS stabilization.
#
# Required env:
#   SUBSCRIPTION_ID
#   RESOURCE_GROUP
#   WEBAPP_NAME
# Optional:
#   DRY_RUN=true|false (default true)

: "${SUBSCRIPTION_ID:?Missing SUBSCRIPTION_ID}"
: "${RESOURCE_GROUP:?Missing RESOURCE_GROUP}"
: "${WEBAPP_NAME:?Missing WEBAPP_NAME}"

DRY_RUN="${DRY_RUN:-true}"

az account set --subscription "${SUBSCRIPTION_ID}"

echo "Inspecting current app:"
az webapp show --resource-group "${RESOURCE_GROUP}" --name "${WEBAPP_NAME}" --query "{name:name,state:state,defaultHostName:defaultHostName}" -o table

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "DRY_RUN=true, skipping stop/delete. Set DRY_RUN=false to execute."
  exit 0
fi

echo "Stopping App Service ${WEBAPP_NAME}"
az webapp stop --resource-group "${RESOURCE_GROUP}" --name "${WEBAPP_NAME}"

echo "Deleting App Service ${WEBAPP_NAME}"
az webapp delete --resource-group "${RESOURCE_GROUP}" --name "${WEBAPP_NAME}"

echo "Decommission complete."
