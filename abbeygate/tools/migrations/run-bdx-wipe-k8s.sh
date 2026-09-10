#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

NAMESPACE="${AKS_NAMESPACE:-faciomga-prod}"
RUNTIME_SECRET="${AKS_RUNTIME_SECRET_NAME:-abbeygate-runtime-secrets}"
BDX_API_BASE_URL="${BDX_API_BASE_URL:-http://abbeygate-abbeygate-api}"
BDX_TENANT_SLUG="${BDX_TENANT_SLUG:-abbeygate-cy}"
BDX_PRODUCT_LINE="${BDX_PRODUCT_LINE:-}"
BDX_WIPE_COMMIT="${BDX_WIPE_COMMIT:-false}"
BDX_DEADLINE="${BDX_DEADLINE:-1800}"

JOB_PREFIX="bdx-wipe"
JOB_NAME="${JOB_PREFIX}-$(date +%Y%m%d-%H%M%S)"
SCRIPT_FILE="tools/migrations/bdx-wipe-runner.mjs"

if [ ! -f "${SCRIPT_FILE}" ]; then
  echo "ERROR: Runner script not found: ${SCRIPT_FILE}" >&2
  exit 1
fi

echo "[bdx-wipe-k8s] tenant=${BDX_TENANT_SLUG} product=${BDX_PRODUCT_LINE:-ALL} commit=${BDX_WIPE_COMMIT}"
echo "[bdx-wipe-k8s] Job: ${JOB_NAME}"
echo
echo "Note: this Job calls POST /api/policies/imports/bdx/wipe on the API service."
echo "      The API process REFUSES the call when NODE_ENV=production OR when"
echo "      commit=true is sent without ALLOW_DESTRUCTIVE_BDX_WIPE=1 set on the"
echo "      receiving API pod (docs/operate/bdx-recovery-rules.md)."
echo

echo "[bdx-wipe-k8s] Creating ConfigMap..."
kubectl create configmap "bdx-script-${JOB_NAME}" \
  --from-file=runner.mjs="${SCRIPT_FILE}" \
  -n "${NAMESPACE}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "[bdx-wipe-k8s] Launching Job..."
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
  activeDeadlineSeconds: ${BDX_DEADLINE}
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
          command: ["node", "/bdx/scripts/runner.mjs"]
          env:
            - name: BDX_API_BASE_URL
              value: "${BDX_API_BASE_URL}"
            - name: BDX_TENANT_SLUG
              value: "${BDX_TENANT_SLUG}"
            - name: BDX_PRODUCT_LINE
              value: "${BDX_PRODUCT_LINE}"
            - name: BDX_WIPE_COMMIT
              value: "${BDX_WIPE_COMMIT}"
            - name: BDX_REQUEST_TIMEOUT_MS
              value: "600000"
            - name: API_SMOKE_EMAIL
              value: "${API_SMOKE_EMAIL:-}"
            - name: API_SMOKE_PASSWORD
              value: "${API_SMOKE_PASSWORD:-}"
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: ${RUNTIME_SECRET}
                  key: JWT_SECRET
          volumeMounts:
            - name: bdx-scripts
              mountPath: /bdx/scripts
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 250m
              memory: 256Mi
      volumes:
        - name: bdx-scripts
          configMap:
            name: bdx-script-${JOB_NAME}
JOBEOF

echo "[bdx-wipe-k8s] Waiting for pod..."
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

echo "[bdx-wipe-k8s] Job: ${JOB_NAME}, Pod: ${POD_NAME}"
echo
echo "Commands:"
echo "  Monitor:    kubectl logs -f -n ${NAMESPACE} ${POD_NAME} -c runner"
echo "  Status:     kubectl get job -n ${NAMESPACE} ${JOB_NAME}"
echo "  Last lines: kubectl logs --tail=50 -n ${NAMESPACE} ${POD_NAME} -c runner"
echo "  Clean up:   kubectl delete job -n ${NAMESPACE} ${JOB_NAME} && kubectl delete configmap -n ${NAMESPACE} bdx-script-${JOB_NAME}"
