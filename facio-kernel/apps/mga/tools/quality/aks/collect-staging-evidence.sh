#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT_DIR}"

ARTIFACT_DIR="${1:-${STAGING_EVIDENCE_DIR:-${ROOT_DIR}/artifacts/staging-evidence-$(date +%Y%m%d-%H%M%S)}}"
AKS_NAMESPACE="${AKS_NAMESPACE:-faciomga-prod}"
HELM_RELEASE="${HELM_RELEASE:-abbeygate}"

mkdir -p "${ARTIFACT_DIR}/pod-describes" "${ARTIFACT_DIR}/pod-logs/current" "${ARTIFACT_DIR}/pod-logs/previous"

echo "[staging-evidence] Writing evidence to ${ARTIFACT_DIR}"

capture() {
  local output_file="$1"
  shift
  {
    echo "\$ $*"
    "$@"
  } > "${output_file}" 2>&1 || true
}

capture "${ARTIFACT_DIR}/cluster-context.txt" kubectl config current-context
capture "${ARTIFACT_DIR}/nodes.txt" kubectl get nodes -o wide
capture "${ARTIFACT_DIR}/workloads.txt" kubectl get deploy,sts,ds,po,svc,ingress -n "${AKS_NAMESPACE}" -o wide
capture "${ARTIFACT_DIR}/events.txt" kubectl get events -n "${AKS_NAMESPACE}" --sort-by=.lastTimestamp

if command -v helm >/dev/null 2>&1; then
  capture "${ARTIFACT_DIR}/helm-status.txt" helm status "${HELM_RELEASE}" -n "${AKS_NAMESPACE}"
  capture "${ARTIFACT_DIR}/helm-values.txt" helm get values "${HELM_RELEASE}" -n "${AKS_NAMESPACE}" --all
fi

pods="$(kubectl get pods -n "${AKS_NAMESPACE}" -o name 2>/dev/null || true)"
for pod in ${pods}; do
  pod_name="${pod#pod/}"
  capture "${ARTIFACT_DIR}/pod-describes/${pod_name}.txt" kubectl describe -n "${AKS_NAMESPACE}" "${pod}"
  capture "${ARTIFACT_DIR}/pod-logs/current/${pod_name}.log" kubectl logs -n "${AKS_NAMESPACE}" "${pod_name}" --all-containers --tail=200
  capture "${ARTIFACT_DIR}/pod-logs/previous/${pod_name}.log" kubectl logs -n "${AKS_NAMESPACE}" "${pod_name}" --all-containers --previous --tail=200
done

node --input-type=module - <<'NODE' "${ARTIFACT_DIR}" "${AKS_NAMESPACE}" "${HELM_RELEASE}"
import fs from 'node:fs';
import path from 'node:path';

const [artifactDir, namespace, release] = process.argv.slice(2);
const summary = {
  collectedAt: new Date().toISOString(),
  namespace,
  release,
  artifactDir,
  files: [
    'cluster-context.txt',
    'nodes.txt',
    'workloads.txt',
    'events.txt',
    'helm-status.txt',
    'helm-values.txt',
    'pod-describes/',
    'pod-logs/current/',
    'pod-logs/previous/',
  ],
};
fs.writeFileSync(path.join(artifactDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
NODE

echo "[staging-evidence] Evidence captured."
