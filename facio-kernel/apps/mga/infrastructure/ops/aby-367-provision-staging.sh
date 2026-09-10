#!/usr/bin/env bash
#
# ABY-367 — provision the isolated STAGING backing services for the
# `faciomga-staging` namespace on the existing abbeygate-cy4 AKS cluster.
#
# Idempotent: every create uses "show || create" or `--dry-run=client | apply`
# so re-running is safe. Creates ONLY new, isolated resources — it never
# modifies prod (`abbeygate-cy4`, `abbeygate-cy4-redis`, `faciomga-prod`, the
# App Gateway, or the VNet).
#
# Prereqs: `az login` (Contributor on the RG) + kubectl context on
# abbeygate-cy4-aks. Run: `bash infrastructure/ops/aby-367-provision-staging.sh`
#
# SECURITY / COST NOTES (review before running):
#   - Postgres uses PUBLIC network access with an "allow Azure services"
#     firewall rule for simplicity. If prod policy requires private access,
#     switch to `--vnet`/`--subnet` delegation against abbeygate-cy4-vnet.
#   - SKUs are the cheapest sensible tier (Burstable B1ms / Redis Basic C0 /
#     Standard_LRS). Adjust for load-testing needs.
#   - Admin/app secrets are generated here and pushed straight into the K8s
#     secret; they are never printed to stdout or committed.
set -euo pipefail

SUBSCRIPTION="${SUBSCRIPTION:-29490482-d492-49af-bcd0-45ed6409413b}"
RG="${RG:-abbeygate-cy4-rg}"
LOCATION="${LOCATION:-israelcentral}"
NAMESPACE="${NAMESPACE:-faciomga-staging}"
SECRET_NAME="${SECRET_NAME:-abbeygate-runtime-secrets}"

PG_SERVER="${PG_SERVER:-abbeygate-cy4-staging}"
PG_DB="${PG_DB:-abbeygate_uw}"
PG_ADMIN_USER="${PG_ADMIN_USER:-pgadmin}"
PG_SKU="${PG_SKU:-Standard_B1ms}"
PG_TIER="${PG_TIER:-Burstable}"
PG_VERSION="${PG_VERSION:-16}"
PG_STORAGE_GB="${PG_STORAGE_GB:-32}"

REDIS_NAME="${REDIS_NAME:-abbeygate-cy4-staging-redis}"
STORAGE_ACCOUNT="${STORAGE_ACCOUNT:-abbeygatecy4stg}"
STORAGE_CONTAINER="${STORAGE_CONTAINER:-documents}"

# OPPWA test credentials (ABY-367 / ADR-0049). CardCorp is now per-country:
# one shared bearer + a per-country entity id and webhook secret. Staging uses
# a SINGLE test entity, so all three per-country entity ids point at it and all
# three per-country webhook secrets share the one test secret. The bearer +
# webhook secret must be provided at run time and are never committed.
CARDCORP_ENTITY_ID_TEST="${CARDCORP_ENTITY_ID_TEST:-8ac7a4c89be4d8fe019be56f2f140298}"
CARDCORP_BASE_URL="${CARDCORP_BASE_URL:-https://eu-test.oppwa.com}"
CARDCORP_ENV="test"
CARDCORP_BEARER_TOKEN="${CARDCORP_BEARER_TOKEN:-REPLACE_WITH_OPPWA_TEST_BEARER}"
# 64-hex AES-GCM webhook secret for the shared test channel.
CARDCORP_WEBHOOK_SECRET_TEST="${CARDCORP_WEBHOOK_SECRET_TEST:-REPLACE_WITH_OPPWA_TEST_WEBHOOK_SECRET}"

gen_secret() { openssl rand -hex 32; }

az account set --subscription "${SUBSCRIPTION}"

echo "==> [1/5] Namespace ${NAMESPACE}"
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

echo "==> [2/5] Postgres flexible server ${PG_SERVER} (${PG_TIER}/${PG_SKU})"
PG_ADMIN_PASSWORD="$(gen_secret)"
if ! az postgres flexible-server show -g "${RG}" -n "${PG_SERVER}" >/dev/null 2>&1; then
  # --public-access 0.0.0.0 already provisions the "allow all Azure services"
  # firewall rule, so no separate firewall-rule create is needed.
  az postgres flexible-server create \
    --resource-group "${RG}" --name "${PG_SERVER}" --location "${LOCATION}" \
    --tier "${PG_TIER}" --sku-name "${PG_SKU}" --storage-size "${PG_STORAGE_GB}" \
    --version "${PG_VERSION}" \
    --admin-user "${PG_ADMIN_USER}" --admin-password "${PG_ADMIN_PASSWORD}" \
    --public-access 0.0.0.0 --yes
else
  echo "    exists — resetting admin password to rotate the K8s secret in sync"
  az postgres flexible-server update -g "${RG}" -n "${PG_SERVER}" --admin-password "${PG_ADMIN_PASSWORD}" >/dev/null
fi
# Allow-list the pgvector extension (baseline migration does CREATE EXTENSION
# "vector"). Azure Flexible Server blocks non-allow-listed extensions. Mirrors
# prod's azure.extensions=vector.
az postgres flexible-server parameter set -g "${RG}" -s "${PG_SERVER}" -n azure.extensions -v vector >/dev/null
az postgres flexible-server db create -g "${RG}" -s "${PG_SERVER}" -d "${PG_DB}" 2>/dev/null || true
PG_HOST="$(az postgres flexible-server show -g "${RG}" -n "${PG_SERVER}" --query fullyQualifiedDomainName -o tsv)"
DATABASE_URL="postgresql://${PG_ADMIN_USER}:${PG_ADMIN_PASSWORD}@${PG_HOST}:5432/${PG_DB}?sslmode=require"

echo "==> [3/5] Redis ${REDIS_NAME} (Basic C0)"
if ! az redis show -g "${RG}" -n "${REDIS_NAME}" >/dev/null 2>&1; then
  az redis create -g "${RG}" -n "${REDIS_NAME}" -l "${LOCATION}" \
    --sku Basic --vm-size c0 --minimum-tls-version 1.2
fi
REDIS_HOST="$(az redis show -g "${RG}" -n "${REDIS_NAME}" --query hostName -o tsv)"
REDIS_KEY="$(az redis list-keys -g "${RG}" -n "${REDIS_NAME}" --query primaryKey -o tsv)"

echo "==> [4/5] Storage account ${STORAGE_ACCOUNT} + container ${STORAGE_CONTAINER}"
if ! az storage account show -g "${RG}" -n "${STORAGE_ACCOUNT}" >/dev/null 2>&1; then
  az storage account create -g "${RG}" -n "${STORAGE_ACCOUNT}" -l "${LOCATION}" \
    --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false
fi
STORAGE_CONNECTION_STRING="$(az storage account show-connection-string -g "${RG}" -n "${STORAGE_ACCOUNT}" -o tsv)"
az storage container create --name "${STORAGE_CONTAINER}" --connection-string "${STORAGE_CONNECTION_STRING}" >/dev/null

echo "==> [5/5] Runtime secret ${SECRET_NAME} in ${NAMESPACE}"
kubectl create secret generic "${SECRET_NAME}" -n "${NAMESPACE}" \
  --dry-run=client -o yaml \
  --from-literal=DATABASE_URL="${DATABASE_URL}" \
  --from-literal=REDIS_HOST="${REDIS_HOST}" \
  --from-literal=REDIS_PORT="6380" \
  --from-literal=REDIS_ADDRESS="${REDIS_HOST}:6380" \
  --from-literal=REDIS_PASSWORD="${REDIS_KEY}" \
  --from-literal=REDIS_TLS="true" \
  --from-literal=REDIS_ENABLE_CLUSTER="false" \
  --from-literal=STORAGE_PROVIDER="azure" \
  --from-literal=STORAGE_CONNECTION_STRING="${STORAGE_CONNECTION_STRING}" \
  --from-literal=STORAGE_CONTAINER_NAME="${STORAGE_CONTAINER}" \
  --from-literal=JWT_SECRET="$(gen_secret)" \
  --from-literal=QUOTE_TOKEN_SECRET="$(gen_secret)" \
  --from-literal=OTP_SECRET="$(gen_secret)" \
  --from-literal=SESSION_SECRET="$(gen_secret)" \
  --from-literal=CARDCORP_ENV="${CARDCORP_ENV}" \
  --from-literal=CARDCORP_BASE_URL="${CARDCORP_BASE_URL}" \
  --from-literal=CARDCORP_TEST_MODE="EXTERNAL" \
  --from-literal=CARDCORP_BEARER_TOKEN="${CARDCORP_BEARER_TOKEN}" \
  --from-literal=CARDCORP_ENTITY_ID_CY="${CARDCORP_ENTITY_ID_TEST}" \
  --from-literal=CARDCORP_ENTITY_ID_PT="${CARDCORP_ENTITY_ID_TEST}" \
  --from-literal=CARDCORP_ENTITY_ID_GR="${CARDCORP_ENTITY_ID_TEST}" \
  --from-literal=CARDCORP_WEBHOOK_SECRET_CY="${CARDCORP_WEBHOOK_SECRET_TEST}" \
  --from-literal=CARDCORP_WEBHOOK_SECRET_PT="${CARDCORP_WEBHOOK_SECRET_TEST}" \
  --from-literal=CARDCORP_WEBHOOK_SECRET_GR="${CARDCORP_WEBHOOK_SECRET_TEST}" \
  | kubectl apply -f -

echo ""
echo "Done. Staging backing services provisioned + secret written to ${NAMESPACE}/${SECRET_NAME}."
echo "Still required (operator): SENTRY_DSN, SENDGRID_*, and the real OPPWA test bearer + test webhook secret (pass via CARDCORP_BEARER_TOKEN / CARDCORP_WEBHOOK_SECRET_TEST)."
echo "Then deploy: gh workflow run aks-deploy-staging.yml (or helm upgrade with values-staging.yaml)."

# ---------------------------------------------------------------------------
# POST-DNS steps (do NOT run before DNS for the hosts resolves — Uriel owns DNS).
# Left as commented, reviewed commands because running them earlier either
# fails cert validation or points live email/CardCorp return URLs at hosts
# that do not resolve yet.
#
# 1) TLS on the shared App Gateway (abbeygate-cy4-appgw). Upload the PFX for
#    each host and wire the listener cert. Prefer cert-manager if already in
#    the cluster (namespace cert-manager exists). Manual az example:
#
#    az network application-gateway ssl-cert create \
#      --resource-group abbeygate-cy4-rg --gateway-name abbeygate-cy4-appgw \
#      --name abbeygate-prod-tls --cert-file ./abbeygate-prod.pfx --cert-password '<pfx-pw>'
#    # then set GH repo variable CY4_AKS_APPGW_SSL_CERT_NAME=abbeygate-prod-tls
#    # and STAGING_AKS_APPGW_SSL_CERT_NAME=<staging-cert-name>.
#
# 2) Per-environment tenant.publicBaseUrl (controls outbound email + CardCorp
#    return URLs). Run against the CORRECT environment DB only.
#    PROD DB (only after cy/pt/gr.abbeygate.com verified):
#      UPDATE "Tenant" SET "publicBaseUrl"='https://cy.abbeygate.com' WHERE "tenantSlug"='abbeygate-cy';
#      UPDATE "Tenant" SET "publicBaseUrl"='https://pt.abbeygate.com' WHERE "tenantSlug"='abbeygate-pt';
#      UPDATE "Tenant" SET "publicBaseUrl"='https://gr.abbeygate.com' WHERE "tenantSlug"='abbeygate-gr';
#    STAGING DB (after seed):
#      UPDATE "Tenant" SET "publicBaseUrl"='https://cy.staging.abbeygate.com' WHERE "tenantSlug"='abbeygate-cy';
#      UPDATE "Tenant" SET "publicBaseUrl"='https://pt.staging.abbeygate.com' WHERE "tenantSlug"='abbeygate-pt';
#      UPDATE "Tenant" SET "publicBaseUrl"='https://gr.staging.abbeygate.com' WHERE "tenantSlug"='abbeygate-gr';
# ---------------------------------------------------------------------------
