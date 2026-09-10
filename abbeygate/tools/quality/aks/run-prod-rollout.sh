#!/usr/bin/env bash
set -euo pipefail

# One-command AKS production rollout helper.
#
# This orchestrates the migration scripts already added in this repo and gives
# a deterministic order of execution.
#
# Usage examples:
#   ./tools/quality/aks/run-prod-rollout.sh preflight
#   ./tools/quality/aks/run-prod-rollout.sh provision
#   ./tools/quality/aks/run-prod-rollout.sh backup-posture
#   ./tools/quality/aks/run-prod-rollout.sh oidc-rbac
#   ./tools/quality/aks/run-prod-rollout.sh bootstrap
#   ./tools/quality/aks/run-prod-rollout.sh alerts
#   ./tools/quality/aks/run-prod-rollout.sh continuity
#   ./tools/quality/aks/run-prod-rollout.sh deploy
#   ./tools/quality/aks/run-prod-rollout.sh smoke
#   ./tools/quality/aks/run-prod-rollout.sh backup-validate
#   ./tools/quality/aks/run-prod-rollout.sh all
#
# Required envs vary by step; see docs/runbooks/README.md.

STEP="${1:-all}"

# Allow GitHub-style Azure variable names as fallbacks for local shell usage.
SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-${AZURE_SUBSCRIPTION_ID:-}}"
if [[ -z "${SUBSCRIPTION_ID}" ]] && command -v az >/dev/null 2>&1; then
  # Local convenience: infer from currently selected Azure account.
  SUBSCRIPTION_ID="$(az account show --query id -o tsv 2>/dev/null || true)"
fi
export SUBSCRIPTION_ID

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

run_preflight() {
  echo "==> Preflight checks"
  require_cmd az
  require_cmd kubectl
  require_cmd helm
  require_cmd bash
  require_cmd curl
  require_cmd node
  require_cmd npm
  echo "Tooling OK."
}

run_provision() {
  echo "==> Provisioning Azure resources (AKS/AGW/KV/monitoring)"
  require_env SUBSCRIPTION_ID
  require_env RESOURCE_GROUP
  require_env LOCATION
  require_env AKS_CLUSTER_NAME
  require_env APP_GW_NAME
  require_env APP_GW_SUBNET_NAME
  require_env AKS_VNET_NAME
  require_env AKS_SUBNET_NAME
  require_env KEYVAULT_NAME
  require_env LOG_ANALYTICS_NAME
  bash ./tools/quality/aks/provision-prod.sh
}

run_bootstrap() {
  echo "==> Bootstrapping AKS platform components"
  require_env RESOURCE_GROUP
  require_env AKS_CLUSTER_NAME
  bash ./tools/quality/aks/bootstrap-platform.sh
}

run_oidc_rbac() {
  echo "==> Configuring GitHub OIDC + namespace-scoped RBAC"
  require_env SUBSCRIPTION_ID
  require_env RESOURCE_GROUP
  require_env AKS_CLUSTER_NAME
  require_env AKS_NAMESPACE
  require_env GITHUB_ORG
  require_env GITHUB_REPO
  require_env GITHUB_ENVIRONMENT
  require_env DEPLOY_IDENTITY_NAME
  bash ./tools/quality/aks/configure-github-oidc.sh
}

run_alerts() {
  echo "==> Configuring AKS alerts"
  require_env SUBSCRIPTION_ID
  require_env RESOURCE_GROUP
  require_env AKS_CLUSTER_NAME
  require_env ACTION_GROUP_ID
  bash ./tools/quality/aks/configure-alerts.sh
}

run_backup_posture() {
  echo "==> Verifying backup posture contract"
  require_env RESOURCE_GROUP
  require_env AKS_POSTGRES_SERVER_NAME
  require_env AKS_STORAGE_ACCOUNT_NAME
  require_env AKS_KEYVAULT_NAME
  npm run backup:posture:check
}

run_continuity() {
  echo "==> Configuring App Gateway continuity edge behavior"
  require_env SUBSCRIPTION_ID
  require_env RESOURCE_GROUP
  require_env APP_GW_NAME
  require_env CONTINUITY_MODE_URL
  bash ./tools/quality/aks/configure-continuity-edge.sh
}

maybe_run_oidc_rbac() {
  if [[ -n "${GITHUB_ORG:-}" && -n "${GITHUB_REPO:-}" && -n "${GITHUB_ENVIRONMENT:-}" && -n "${DEPLOY_IDENTITY_NAME:-}" ]]; then
    run_oidc_rbac
  else
    echo "==> Skipping oidc-rbac (set GITHUB_ORG/GITHUB_REPO/GITHUB_ENVIRONMENT/DEPLOY_IDENTITY_NAME to enable)"
  fi
}

maybe_run_continuity() {
  if [[ -n "${CONTINUITY_MODE_URL:-}" ]]; then
    run_continuity
  else
    echo "==> Skipping continuity (set CONTINUITY_MODE_URL to enable)"
  fi
}

run_deploy() {
  echo "==> Deploying workloads with Helm"
  require_env AKS_NAMESPACE
  require_env HELM_RELEASE
  require_env ACR_LOGIN_SERVER
  require_env IMAGE_TAG
  require_env AKS_API_HOST
  require_env AKS_RUNTIME_SECRET_NAME
  AKS_API_ADDITIONAL_HOST="${AKS_API_ADDITIONAL_HOST:-}"
  AKS_APPGW_SSL_CERT_NAME="${AKS_APPGW_SSL_CERT_NAME:-}"
  AKS_APPGW_SSL_CERT_PFX_PATH="${AKS_APPGW_SSL_CERT_PFX_PATH:-}"
  AKS_APPGW_SSL_CERT_PFX_PASSWORD="${AKS_APPGW_SSL_CERT_PFX_PASSWORD:-}"
  APP_GW_NAME="${APP_GW_NAME:-abbeygate-appgw-prod}"
  RESOURCE_GROUP="${RESOURCE_GROUP:-${AKS_RESOURCE_GROUP:-}}"

  ACR_NAME="${ACR_NAME:-${ACR_LOGIN_SERVER%%.*}}"
  API_IMAGE_REPO="${API_IMAGE_REPO:-abbeygate-platform-api}"
  WORKER_IMAGE_REPO="${WORKER_IMAGE_REPO:-abbeygate-platform-worker}"

  echo "==> Preflight: verify runtime secret exists"
  kubectl get secret "${AKS_RUNTIME_SECRET_NAME}" -n "${AKS_NAMESPACE}" >/dev/null

  echo "==> Preflight: verify required runtime secret keys"
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
    if [[ -z "$(kubectl get secret "${AKS_RUNTIME_SECRET_NAME}" -n "${AKS_NAMESPACE}" -o "jsonpath={.data.${key}}" 2>/dev/null)" ]]; then
      echo "Missing required secret key ${key} in ${AKS_RUNTIME_SECRET_NAME}."
      exit 1
    fi
  done

  redis_address="$(kubectl get secret "${AKS_RUNTIME_SECRET_NAME}" -n "${AKS_NAMESPACE}" -o "jsonpath={.data.REDIS_ADDRESS}" 2>/dev/null || true)"
  redis_host="$(kubectl get secret "${AKS_RUNTIME_SECRET_NAME}" -n "${AKS_NAMESPACE}" -o "jsonpath={.data.REDIS_HOST}" 2>/dev/null || true)"
  redis_port="$(kubectl get secret "${AKS_RUNTIME_SECRET_NAME}" -n "${AKS_NAMESPACE}" -o "jsonpath={.data.REDIS_PORT}" 2>/dev/null || true)"
  if [[ -z "${redis_address}" && ( -z "${redis_host}" || -z "${redis_port}" ) ]]; then
    echo "Secret ${AKS_RUNTIME_SECRET_NAME} must include REDIS_ADDRESS or both REDIS_HOST and REDIS_PORT."
    exit 1
  fi

  echo "==> Preflight: verify container image tags exist in ACR"
  az acr repository show --name "${ACR_NAME}" --image "${API_IMAGE_REPO}:${IMAGE_TAG}" >/dev/null
  az acr repository show --name "${ACR_NAME}" --image "${WORKER_IMAGE_REPO}:${IMAGE_TAG}" >/dev/null

  echo "==> Preflight: verify at least one schedulable node"
  schedulable_nodes="$(kubectl get nodes --field-selector spec.unschedulable!=true --no-headers 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "${schedulable_nodes}" -lt 1 ]]; then
    echo "No schedulable nodes found. Aborting before Helm timeout."
    exit 1
  fi

  if [[ -n "${AKS_APPGW_SSL_CERT_NAME}" || -n "${AKS_APPGW_SSL_CERT_PFX_PATH}" || -n "${AKS_APPGW_SSL_CERT_PFX_PASSWORD}" ]]; then
    require_env RESOURCE_GROUP
    if [[ -z "${AKS_APPGW_SSL_CERT_NAME}" || -z "${AKS_APPGW_SSL_CERT_PFX_PATH}" || -z "${AKS_APPGW_SSL_CERT_PFX_PASSWORD}" ]]; then
      echo "For certificate automation, set all of: AKS_APPGW_SSL_CERT_NAME, AKS_APPGW_SSL_CERT_PFX_PATH, AKS_APPGW_SSL_CERT_PFX_PASSWORD."
      exit 1
    fi
    echo "==> Preflight: import/update App Gateway SSL certificate"
    APPGW_SSL_CERT_NAME="${AKS_APPGW_SSL_CERT_NAME}" \
      APPGW_SSL_CERT_PFX_PATH="${AKS_APPGW_SSL_CERT_PFX_PATH}" \
      APPGW_SSL_CERT_PFX_PASSWORD="${AKS_APPGW_SSL_CERT_PFX_PASSWORD}" \
      RESOURCE_GROUP="${RESOURCE_GROUP}" \
      APP_GW_NAME="${APP_GW_NAME}" \
      bash ./tools/quality/aks/import-appgw-ssl-cert.sh
  fi

  extra_set_args=()
  extra_set_args+=(--set "ingress.sslRedirect=true")
  if [[ -n "${AKS_API_ADDITIONAL_HOST}" ]]; then
    extra_set_args+=(--set "ingress.additionalHosts[0]=${AKS_API_ADDITIONAL_HOST}")
  fi
  if [[ -n "${AKS_APPGW_SSL_CERT_NAME}" ]]; then
    extra_set_args+=(--set "ingress.appgwSslCertificate=${AKS_APPGW_SSL_CERT_NAME}")
  fi

  helm upgrade --install "${HELM_RELEASE}" ./infrastructure/k8s/helm/abbeygate \
    --namespace "${AKS_NAMESPACE}" \
    --create-namespace \
    --set image.registry="${ACR_LOGIN_SERVER}" \
    --set image.tag="${IMAGE_TAG}" \
    --set ingress.host="${AKS_API_HOST}" \
    --set runtimeConfig.secretName="${AKS_RUNTIME_SECRET_NAME}" \
    "${extra_set_args[@]}" \
    --wait \
    --timeout 20m
}

run_smoke() {
  echo "==> Running post-deploy smoke checks"
  require_env APP_BASE_URL
  bash ./tools/quality/aks/smoke-checks.sh
}

maybe_run_backup_validate() {
  if [[ -n "${BACKUP_SOURCE_DATABASE_URL:-}" && -n "${BACKUP_RESTORE_DATABASE_URL:-}" ]]; then
    echo "==> Running backup/restore validation"
    npm run backup:restore:validate
  else
    echo "==> Skipping backup validation (set BACKUP_SOURCE_DATABASE_URL and BACKUP_RESTORE_DATABASE_URL to enable)"
  fi
}

case "${STEP}" in
  preflight)
    run_preflight
    ;;
  provision)
    run_preflight
    run_provision
    ;;
  backup-posture)
    run_preflight
    run_backup_posture
    ;;
  bootstrap)
    run_preflight
    run_bootstrap
    ;;
  oidc-rbac)
    run_preflight
    run_oidc_rbac
    ;;
  alerts)
    run_preflight
    run_alerts
    ;;
  continuity)
    run_preflight
    run_continuity
    ;;
  deploy)
    run_preflight
    run_deploy
    ;;
  smoke)
    run_preflight
    run_smoke
    ;;
  backup-validate)
    run_preflight
    maybe_run_backup_validate
    ;;
  all)
    run_preflight
    run_provision
    run_backup_posture
    maybe_run_oidc_rbac
    run_bootstrap
    run_alerts
    maybe_run_continuity
    run_deploy
    run_smoke
    maybe_run_backup_validate
    ;;
  *)
    echo "Unknown step: ${STEP}"
    echo "Valid steps: preflight | provision | backup-posture | oidc-rbac | bootstrap | alerts | continuity | deploy | smoke | backup-validate | all"
    exit 1
    ;;
esac

echo "Done: ${STEP}"
