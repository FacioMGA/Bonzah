#!/usr/bin/env bash
set -euo pipefail

# Configure GitHub OIDC + namespace-scoped AKS deploy RBAC.
#
# Required env:
#   SUBSCRIPTION_ID
#   RESOURCE_GROUP
#   AKS_CLUSTER_NAME
#   AKS_NAMESPACE
#   GITHUB_ORG
#   GITHUB_REPO
#   GITHUB_ENVIRONMENT (example: production-aks)
#   DEPLOY_IDENTITY_NAME (user-assigned managed identity name)
#
# Optional env:
#   FEDERATED_CREDENTIAL_NAME (default: github-<repo>-<env>)

: "${SUBSCRIPTION_ID:?Missing SUBSCRIPTION_ID}"
: "${RESOURCE_GROUP:?Missing RESOURCE_GROUP}"
: "${AKS_CLUSTER_NAME:?Missing AKS_CLUSTER_NAME}"
: "${AKS_NAMESPACE:?Missing AKS_NAMESPACE}"
: "${GITHUB_ORG:?Missing GITHUB_ORG}"
: "${GITHUB_REPO:?Missing GITHUB_REPO}"
: "${GITHUB_ENVIRONMENT:?Missing GITHUB_ENVIRONMENT}"
: "${DEPLOY_IDENTITY_NAME:?Missing DEPLOY_IDENTITY_NAME}"

FEDERATED_CREDENTIAL_NAME="${FEDERATED_CREDENTIAL_NAME:-github-${GITHUB_REPO}-${GITHUB_ENVIRONMENT}}"

az account set --subscription "${SUBSCRIPTION_ID}"

echo "Ensuring user-assigned identity ${DEPLOY_IDENTITY_NAME}"
if ! az identity show --resource-group "${RESOURCE_GROUP}" --name "${DEPLOY_IDENTITY_NAME}" >/dev/null 2>&1; then
  az identity create \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${DEPLOY_IDENTITY_NAME}" >/dev/null
fi

IDENTITY_CLIENT_ID="$(az identity show --resource-group "${RESOURCE_GROUP}" --name "${DEPLOY_IDENTITY_NAME}" --query clientId -o tsv)"
IDENTITY_PRINCIPAL_ID="$(az identity show --resource-group "${RESOURCE_GROUP}" --name "${DEPLOY_IDENTITY_NAME}" --query principalId -o tsv)"
TENANT_ID="$(az account show --query tenantId -o tsv)"
AKS_ID="$(az aks show --resource-group "${RESOURCE_GROUP}" --name "${AKS_CLUSTER_NAME}" --query id -o tsv)"

FEDERATED_SUBJECT="repo:${GITHUB_ORG}/${GITHUB_REPO}:environment:${GITHUB_ENVIRONMENT}"
echo "Ensuring federated credential ${FEDERATED_CREDENTIAL_NAME} (${FEDERATED_SUBJECT})"
if ! az identity federated-credential show \
  --resource-group "${RESOURCE_GROUP}" \
  --identity-name "${DEPLOY_IDENTITY_NAME}" \
  --name "${FEDERATED_CREDENTIAL_NAME}" >/dev/null 2>&1; then
  az identity federated-credential create \
    --resource-group "${RESOURCE_GROUP}" \
    --identity-name "${DEPLOY_IDENTITY_NAME}" \
    --name "${FEDERATED_CREDENTIAL_NAME}" \
    --issuer "https://token.actions.githubusercontent.com" \
    --subject "${FEDERATED_SUBJECT}" \
    --audiences "api://AzureADTokenExchange" >/dev/null
fi

echo "Assigning AKS Cluster User role"
az role assignment create \
  --assignee-object-id "${IDENTITY_PRINCIPAL_ID}" \
  --assignee-principal-type ServicePrincipal \
  --role "Azure Kubernetes Service Cluster User Role" \
  --scope "${AKS_ID}" >/dev/null 2>&1 || true

echo "Assigning namespace-scoped AKS RBAC Writer role"
az role assignment create \
  --assignee-object-id "${IDENTITY_PRINCIPAL_ID}" \
  --assignee-principal-type ServicePrincipal \
  --role "Azure Kubernetes Service RBAC Writer" \
  --scope "${AKS_ID}/namespaces/${AKS_NAMESPACE}" >/dev/null 2>&1 || true

echo "OIDC + RBAC configuration complete."
echo "Set these GitHub Environment variables for ${GITHUB_ENVIRONMENT}:"
echo "  AZURE_CLIENT_ID=${IDENTITY_CLIENT_ID}"
echo "  AZURE_TENANT_ID=${TENANT_ID}"
echo "  AZURE_SUBSCRIPTION_ID=${SUBSCRIPTION_ID}"
