#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT_DIR}"

RESOURCE_GROUP="${RESOURCE_GROUP:-${AKS_RESOURCE_GROUP:-abbeygate-cy}}"
AKS_CLUSTER_NAME="${AKS_CLUSTER_NAME:-abbeygate-prod}"
AKS_NAMESPACE="${AKS_NAMESPACE:-faciomga-prod}"
HELM_RELEASE="${HELM_RELEASE:-abbeygate}"
RUNTIME_SECRET_NAME="${RUNTIME_SECRET_NAME:-${AKS_RUNTIME_SECRET_NAME:-}}"
ACR_NAME="${ACR_NAME:-abbeygateacr}"
API_IMAGE_REPO="${API_IMAGE_REPO:-abbeygate-platform-api}"
WORKER_IMAGE_REPO="${WORKER_IMAGE_REPO:-abbeygate-platform-worker}"
IMAGE_TAG="${IMAGE_TAG:-}"
AKS_API_HOST="${AKS_API_HOST:-}"
AKS_API_ADDITIONAL_HOST="${AKS_API_ADDITIONAL_HOST:-}"
ARTIFACT_DIR="${STAGING_DOCTOR_ARTIFACT_DIR:-${ROOT_DIR}/artifacts/staging-doctor-$(date +%Y%m%d-%H%M%S)}"
PRISMA_STATE_REPORT_PATH="${ARTIFACT_DIR}/prisma-migration-state.json"
DB_CONTRACT_REPORT_PATH="${ARTIFACT_DIR}/runtime-db-contract.json"
EVIDENCE_DIR="${ARTIFACT_DIR}/evidence"
SUMMARY_PATH="${ARTIFACT_DIR}/doctor-summary.json"

mkdir -p "${ARTIFACT_DIR}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[staging-doctor] Missing required command: $1" >&2
    exit 1
  }
}

on_error() {
  local exit_code=$?
  echo "[staging-doctor] Failure detected. Collecting staging evidence into ${EVIDENCE_DIR}..."
  STAGING_EVIDENCE_DIR="${EVIDENCE_DIR}" \
    AKS_NAMESPACE="${AKS_NAMESPACE}" \
    HELM_RELEASE="${HELM_RELEASE}" \
    bash "${ROOT_DIR}/tools/quality/aks/collect-staging-evidence.sh" || true
  exit "${exit_code}"
}
trap on_error ERR

require_cmd az
require_cmd kubectl
require_cmd kubelogin
require_cmd node
require_cmd npm
require_cmd curl

if [ "${STAGING_DOCTOR_USE_CURRENT_CONTEXT:-false}" != "true" ]; then
  echo "[staging-doctor] Refreshing AKS context..."
  az aks get-credentials \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${AKS_CLUSTER_NAME}" \
    --format azure \
    --overwrite-existing
  kubelogin convert-kubeconfig -l azurecli
fi
kubectl config set-context --current --namespace "${AKS_NAMESPACE}" >/dev/null

echo "[staging-doctor] Verifying namespace-scoped permissions..."
kubectl auth can-i get pods --namespace "${AKS_NAMESPACE}" >/dev/null
kubectl auth can-i get secrets --namespace "${AKS_NAMESPACE}" >/dev/null

if [ -z "${RUNTIME_SECRET_NAME}" ]; then
  echo "[staging-doctor] Missing RUNTIME_SECRET_NAME or AKS_RUNTIME_SECRET_NAME." >&2
  exit 1
fi

echo "[staging-doctor] Checking runtime secret and required keys..."
kubectl get secret "${RUNTIME_SECRET_NAME}" -n "${AKS_NAMESPACE}" >/dev/null

required_keys=(
  DATABASE_URL
  JWT_SECRET
  SESSION_SECRET
  REDIS_PASSWORD
  STORAGE_PROVIDER
  STORAGE_CONNECTION_STRING
  STORAGE_CONTAINER_NAME
)
for key in "${required_keys[@]}"; do
  if [ -z "$(kubectl get secret "${RUNTIME_SECRET_NAME}" -n "${AKS_NAMESPACE}" -o "jsonpath={.data.${key}}" 2>/dev/null)" ]; then
    echo "[staging-doctor] Missing required secret key ${key} in ${RUNTIME_SECRET_NAME}." >&2
    exit 1
  fi
done

redis_address="$(kubectl get secret "${RUNTIME_SECRET_NAME}" -n "${AKS_NAMESPACE}" -o "jsonpath={.data.REDIS_ADDRESS}" 2>/dev/null || true)"
redis_host="$(kubectl get secret "${RUNTIME_SECRET_NAME}" -n "${AKS_NAMESPACE}" -o "jsonpath={.data.REDIS_HOST}" 2>/dev/null || true)"
redis_port="$(kubectl get secret "${RUNTIME_SECRET_NAME}" -n "${AKS_NAMESPACE}" -o "jsonpath={.data.REDIS_PORT}" 2>/dev/null || true)"
if [ -z "${redis_address}" ] && { [ -z "${redis_host}" ] || [ -z "${redis_port}" ]; }; then
  echo "[staging-doctor] Secret ${RUNTIME_SECRET_NAME} must include REDIS_ADDRESS or both REDIS_HOST and REDIS_PORT." >&2
  exit 1
fi

echo "[staging-doctor] Checking schedulable node capacity..."
schedulable_nodes="$(kubectl get nodes --field-selector spec.unschedulable!=true --no-headers 2>/dev/null | wc -l | tr -d ' ')"
if [ "${schedulable_nodes}" -lt 1 ]; then
  echo "[staging-doctor] No schedulable nodes found." >&2
  exit 1
fi

if [ -n "${IMAGE_TAG}" ]; then
  echo "[staging-doctor] Verifying image tags exist in ACR..."
  az acr repository show --name "${ACR_NAME}" --image "${API_IMAGE_REPO}:${IMAGE_TAG}" >/dev/null
  az acr repository show --name "${ACR_NAME}" --image "${WORKER_IMAGE_REPO}:${IMAGE_TAG}" >/dev/null
fi

echo "[staging-doctor] Resolving DATABASE_URL for migration and contract checks..."
if [ -z "${DATABASE_URL:-}" ]; then
  encoded_db_url="$(kubectl get secret "${RUNTIME_SECRET_NAME}" -n "${AKS_NAMESPACE}" -o "jsonpath={.data.DATABASE_URL}" 2>/dev/null || true)"
  if [ -z "${encoded_db_url}" ]; then
    echo "[staging-doctor] DATABASE_URL is not available from env or runtime secret ${RUNTIME_SECRET_NAME}." >&2
    exit 1
  fi
  export DATABASE_URL
  DATABASE_URL="$(echo "${encoded_db_url}" | base64 --decode)"
fi

echo "[staging-doctor] Inspecting Prisma migration state..."
export PRISMA_STATE_REPORT_PATH
node tools/quality/aks/inspect-prisma-migration-state.mjs

echo "[staging-doctor] Enforcing Prisma state invariants..."
node --input-type=module - <<'NODE' "${PRISMA_STATE_REPORT_PATH}"
import fs from 'node:fs';

const reportPath = process.argv[2];
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

if (!report.currentDatabase || !report.urlDatabase) {
  throw new Error('Unable to determine current_database() or DATABASE_URL database name.');
}
if (report.currentDatabase !== report.urlDatabase) {
  throw new Error(`DATABASE_URL targets '${report.urlDatabase}' but PostgreSQL reports '${report.currentDatabase}'.`);
}
if (['unsupported_schema_state', 'inspection_failed', 'missing_database_url'].includes(report.shape)) {
  throw new Error(`Prisma migration state shape '${report.shape}' is not deployable.`);
}
if (Number(report.issues?.length || 0) !== 0) {
  throw new Error(`Prisma migration inspection found ${report.issues.length} issue(s).`);
}
NODE

echo "[staging-doctor] Auditing runtime DB contract..."
export DB_CONTRACT_REPORT_PATH
export RUNTIME_SECRET_NAME
npm run db:audit:runtime-contract

health_status="skipped"
health_url=""
tenant_probe_status="skipped"
tenant_probe_hosts=""
if [ -n "${AKS_API_HOST}" ]; then
  health_url="https://${AKS_API_HOST}/health"
  echo "[staging-doctor] Probing ${health_url}..."
  curl --fail --silent --show-error --max-time 10 "${health_url}" > "${ARTIFACT_DIR}/health.json"
  health_status="passed"
fi

expected_slug_for_host() {
  case "$1" in
    abbeygate-cy.facio.io) echo "abbeygate-cy" ;;
    abbeygate-pt.facio.io) echo "abbeygate-pt" ;;
    abbeygate-gr.facio.io) echo "abbeygate-gr" ;;
    abbeygate-es.facio.io) echo "abbeygate-es" ;;
    *) echo "" ;;
  esac
}

probe_tenant_host() {
  local host="$1"
  local expected_slug
  local output_path
  expected_slug="$(expected_slug_for_host "${host}")"
  output_path="${ARTIFACT_DIR}/tenant-resolve-${host//[^A-Za-z0-9_.-]/_}.json"
  echo "[staging-doctor] Probing tenant resolution for ${host}..."
  curl --fail --silent --show-error --max-time 10 "https://${host}/api/tenant/resolve" > "${output_path}"
  if [ -n "${expected_slug}" ]; then
    node --input-type=module - <<'NODE' "${output_path}" "${expected_slug}" "${host}"
import fs from 'node:fs';

const [outputPath, expectedSlug, host] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
if (payload.tenantSlug !== expectedSlug) {
  throw new Error(`Host ${host} resolved tenantSlug=${payload.tenantSlug || '<missing>'}; expected ${expectedSlug}`);
}
NODE
  fi
}

tenant_hosts=()
if [ -n "${AKS_API_HOST}" ]; then
  tenant_hosts+=("${AKS_API_HOST}")
fi
if [ -n "${AKS_API_ADDITIONAL_HOST}" ]; then
  tenant_hosts+=("${AKS_API_ADDITIONAL_HOST}")
fi
if [ "${#tenant_hosts[@]}" -gt 0 ]; then
  for tenant_host in "${tenant_hosts[@]}"; do
    probe_tenant_host "${tenant_host}"
  done
  tenant_probe_status="passed"
  tenant_probe_hosts="$(IFS=,; echo "${tenant_hosts[*]}")"
fi

node --input-type=module - <<'NODE' "${SUMMARY_PATH}" "${RESOURCE_GROUP}" "${AKS_CLUSTER_NAME}" "${AKS_NAMESPACE}" "${RUNTIME_SECRET_NAME}" "${schedulable_nodes}" "${IMAGE_TAG}" "${health_status}" "${health_url}" "${tenant_probe_status}" "${tenant_probe_hosts}" "${PRISMA_STATE_REPORT_PATH}" "${DB_CONTRACT_REPORT_PATH}" "${ARTIFACT_DIR}"
import fs from 'node:fs';

const [
  summaryPath,
  resourceGroup,
  clusterName,
  namespace,
  runtimeSecretName,
  schedulableNodes,
  imageTag,
  healthStatus,
  healthUrl,
  tenantProbeStatus,
  tenantProbeHosts,
  prismaReportPath,
  dbContractPath,
  artifactDir,
] = process.argv.slice(2);

const summary = {
  checkedAt: new Date().toISOString(),
  status: 'passed',
  resourceGroup,
  clusterName,
  namespace,
  runtimeSecretName,
  schedulableNodes: Number(schedulableNodes),
  imageTag: imageTag || null,
  health: {
    status: healthStatus,
    url: healthUrl || null,
  },
  tenantResolution: {
    status: tenantProbeStatus,
    hosts: tenantProbeHosts ? tenantProbeHosts.split(',').filter(Boolean) : [],
  },
  reports: {
    prismaState: prismaReportPath,
    runtimeDbContract: dbContractPath,
    evidenceDir: `${artifactDir}/evidence`,
  },
};

fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
NODE

echo "[staging-doctor] Staging doctor passed. Summary: ${SUMMARY_PATH}"
