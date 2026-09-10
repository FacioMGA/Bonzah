#!/usr/bin/env bash
set -euo pipefail

# Pre-go-live test-data reset (ADR-0051) — launches a Job that calls
# POST /api/policies/imports/bdx/test-data-reset on the API service to delete
# the NON-BDX (untagged) test policies/quotes on a go-live tenant.
#
# The API process REFUSES commit=true unless ALLOW_DESTRUCTIVE_TESTDATA_RESET=1
# is set on the receiving API pod, refuses tenants outside {cy,pt,gr}, and
# refuses when the tenant has 0 BDX-tagged policies (import-first invariant).
#
# ALWAYS run once with RESET_COMMIT=false first and eyeball the totals.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

NAMESPACE="${AKS_NAMESPACE:-faciomga-prod}"
RUNTIME_SECRET="${AKS_RUNTIME_SECRET_NAME:-abbeygate-runtime-secrets}"
RESET_API_BASE_URL="${RESET_API_BASE_URL:-http://abbeygate-abbeygate-api}"
RESET_TENANT_SLUG="${RESET_TENANT_SLUG:-abbeygate-cy}"
RESET_PRODUCT_LINE="${RESET_PRODUCT_LINE:-}"
RESET_COMMIT="${RESET_COMMIT:-false}"
RESET_DEADLINE="${RESET_DEADLINE:-1800}"

JOB_PREFIX="testdata-reset"
JOB_NAME="${JOB_PREFIX}-$(date +%Y%m%d-%H%M%S)"
SCRIPT_FILE="tools/migrations/testdata-reset-runner.mjs"

if [ ! -f "${SCRIPT_FILE}" ]; then
  echo "ERROR: Runner script not found: ${SCRIPT_FILE}" >&2
  exit 1
fi

echo "[testdata-reset-k8s] tenant=${RESET_TENANT_SLUG} product=${RESET_PRODUCT_LINE:-ALL} commit=${RESET_COMMIT}"
echo "[testdata-reset-k8s] Job: ${JOB_NAME}"
echo
echo "Note: commit=true requires ALLOW_DESTRUCTIVE_TESTDATA_RESET=1 on the API pod (ADR-0051)."
echo

echo "[testdata-reset-k8s] Creating ConfigMap..."
kubectl create configmap "testdata-reset-script-${JOB_NAME}" \
  --from-file=runner.mjs="${SCRIPT_FILE}" \
  -n "${NAMESPACE}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "[testdata-reset-k8s] Launching Job..."
cat <<JOBEOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/name: abbeygate
    app.kubernetes.io/component: ${JOB_PREFIX}
spec:
  backoffLimit: 1
  activeDeadlineSeconds: ${RESET_DEADLINE}
  ttlSecondsAfterFinished: 172800
  template:
    metadata:
      labels:
        app.kubernetes.io/name: abbeygate
        app.kubernetes.io/component: ${JOB_PREFIX}
    spec:
      restartPolicy: OnFailure
      containers:
        - name: runner
          image: node:22-bookworm-slim
          command: ["node", "/reset/scripts/runner.mjs"]
          env:
            - name: RESET_API_BASE_URL
              value: "${RESET_API_BASE_URL}"
            - name: RESET_TENANT_SLUG
              value: "${RESET_TENANT_SLUG}"
            - name: RESET_PRODUCT_LINE
              value: "${RESET_PRODUCT_LINE}"
            - name: RESET_COMMIT
              value: "${RESET_COMMIT}"
            - name: RESET_REQUEST_TIMEOUT_MS
              value: "600000"
            - name: API_SMOKE_EMAIL
              value: "${API_SMOKE_EMAIL:-}"
            - name: API_SMOKE_PASSWORD
              value: "${API_SMOKE_PASSWORD:-}"
            - name: RESET_AUTH_TOKEN
              value: "${RESET_AUTH_TOKEN:-}"
          volumeMounts:
            - name: reset-scripts
              mountPath: /reset/scripts
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 250m
              memory: 256Mi
      volumes:
        - name: reset-scripts
          configMap:
            name: testdata-reset-script-${JOB_NAME}
JOBEOF

echo "[testdata-reset-k8s] Waiting for pod..."
POD_NAME=""
for i in $(seq 1 60); do
  POD_NAME="$(kubectl get pod -n "${NAMESPACE}" -l "job-name=${JOB_NAME}" -o name 2>/dev/null | head -1)"
  if [ -n "${POD_NAME}" ]; then
    POD_NAME="${POD_NAME#pod/}"
    break
  fi
  sleep 2
done

if [ -z "${POD_NAME}" ]; then
  echo "ERROR: Could not find Job pod" >&2
  exit 1
fi

echo "[testdata-reset-k8s] Job: ${JOB_NAME}, Pod: ${POD_NAME}"
echo
echo "Commands:"
echo "  Monitor:    kubectl logs -f -n ${NAMESPACE} ${POD_NAME} -c runner"
echo "  Status:     kubectl get job -n ${NAMESPACE} ${JOB_NAME}"
echo "  Last lines: kubectl logs --tail=50 -n ${NAMESPACE} ${POD_NAME} -c runner"
echo "  Clean up:   kubectl delete job -n ${NAMESPACE} ${JOB_NAME} && kubectl delete configmap -n ${NAMESPACE} testdata-reset-script-${JOB_NAME}"
