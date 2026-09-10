#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

MODE="${1:-import}"
NAMESPACE="${AKS_NAMESPACE:-faciomga-prod}"
RUNTIME_SECRET="${AKS_RUNTIME_SECRET_NAME:-abbeygate-runtime-secrets}"
BDX_SOURCE_FILE="${BDX_SOURCE_FILE:-artifacts/reporting/premium-v52-2026-03-local.xlsx}"
BDX_API_BASE_URL="${BDX_API_BASE_URL:-http://abbeygate-abbeygate-api}"

# import-mode env (canonical job spine — see tools/migrations/bdx-import-runner.mjs)
BDX_TENANT_SLUG="${BDX_TENANT_SLUG:-abbeygate-cy}"
BDX_PRODUCT_LINE="${BDX_PRODUCT_LINE:-motor}"
BDX_DRY_RUN="${BDX_DRY_RUN:-false}"
BDX_COMMIT_LOOPS="${BDX_COMMIT_LOOPS:-1}"

case "${MODE}" in
  import)
    SCRIPT_FILE="tools/migrations/bdx-import-runner.mjs"
    JOB_PREFIX="bdx-import"
    DEADLINE="${BDX_DEADLINE:-43200}"
    ;;
  reconcile)
    SCRIPT_FILE="tools/migrations/bdx-reconciliation-runner.mjs"
    JOB_PREFIX="bdx-recon"
    DEADLINE="${BDX_DEADLINE:-14400}"
    ;;
  *)
    cat >&2 <<USAGE
Usage: $0 <import|reconcile>

Modes:
  import      Drive the canonical BDX import job spine
              (POST /imports/bdx/dry-run -> commit) with the new runner.
  reconcile   Dry-run validation pass with full reconciliation report.

Environment (import mode):
  BDX_SOURCE_FILE       Path to BDX XLSX (default: artifacts/reporting/premium-v52-2026-03-local.xlsx)
  BDX_API_BASE_URL      API base URL (default: http://abbeygate-abbeygate-api)
  BDX_TENANT_SLUG       'abbeygate-cy' | 'abbeygate-pt' (default: abbeygate-cy)
  BDX_PRODUCT_LINE      'motor' | 'travel' | 'home' (default: motor)
  BDX_DRY_RUN           'true' to stop after dry-run (default: false)
  BDX_COMMIT_LOOPS      Max dry-run+commit cycles for big files (default: 1)
  API_SMOKE_EMAIL       ADMIN login email
  API_SMOKE_PASSWORD    ADMIN login password
USAGE
    exit 1
    ;;
esac

JOB_NAME="${JOB_PREFIX}-$(date +%Y%m%d-%H%M%S)"

if [ ! -f "${BDX_SOURCE_FILE}" ]; then
  echo "ERROR: BDX source file not found: ${BDX_SOURCE_FILE}" >&2
  exit 1
fi

if [ ! -f "${SCRIPT_FILE}" ]; then
  echo "ERROR: Runner script not found: ${SCRIPT_FILE}" >&2
  exit 1
fi

echo "[bdx-k8s] Mode: ${MODE}"
echo "[bdx-k8s] Job: ${JOB_NAME}"
if [ "${MODE}" = "import" ]; then
  echo "[bdx-k8s] tenant=${BDX_TENANT_SLUG} productLine=${BDX_PRODUCT_LINE} dryRun=${BDX_DRY_RUN} loops=${BDX_COMMIT_LOOPS}"
fi

echo "[bdx-k8s] Creating ConfigMap..."
kubectl create configmap "bdx-script-${JOB_NAME}" \
  --from-file=runner.mjs="${SCRIPT_FILE}" \
  -n "${NAMESPACE}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "[bdx-k8s] Launching Job..."
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
  backoffLimit: 3
  activeDeadlineSeconds: ${DEADLINE}
  ttlSecondsAfterFinished: 172800
  template:
    metadata:
      labels:
        app.kubernetes.io/name: abbeygate
        app.kubernetes.io/component: ${JOB_PREFIX}
    spec:
      restartPolicy: OnFailure
      initContainers:
        - name: wait-for-file
          image: busybox:1.36
          command: ["sh", "-c", "echo 'Waiting for BDX file...' && while [ ! -f /bdx/source/bdx-source.xlsx ]; do sleep 2; done && echo 'File ready.'"]
          volumeMounts:
            - name: bdx-data
              mountPath: /bdx/source
      containers:
        - name: runner
          image: node:22-bookworm-slim
          command: ["node", "/bdx/scripts/runner.mjs"]
          env:
            - name: BDX_API_BASE_URL
              value: "${BDX_API_BASE_URL}"
            - name: BDX_SOURCE_FILE
              value: "/bdx/source/bdx-source.xlsx"
            - name: BDX_TENANT_SLUG
              value: "${BDX_TENANT_SLUG}"
            - name: BDX_PRODUCT_LINE
              value: "${BDX_PRODUCT_LINE}"
            - name: BDX_DRY_RUN
              value: "${BDX_DRY_RUN}"
            - name: BDX_COMMIT_LOOPS
              value: "${BDX_COMMIT_LOOPS}"
            - name: BDX_REQUEST_TIMEOUT_MS
              value: "600000"
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: ${RUNTIME_SECRET}
                  key: DATABASE_URL
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: ${RUNTIME_SECRET}
                  key: JWT_SECRET
            - name: API_SMOKE_EMAIL
              value: "${API_SMOKE_EMAIL:-}"
            - name: API_SMOKE_PASSWORD
              value: "${API_SMOKE_PASSWORD:-}"
            - name: BDX_AUTH_TOKEN
              value: "${BDX_AUTH_TOKEN:-}"
          volumeMounts:
            - name: bdx-scripts
              mountPath: /bdx/scripts
            - name: bdx-data
              mountPath: /bdx/source
          resources:
            requests:
              cpu: 200m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
      volumes:
        - name: bdx-scripts
          configMap:
            name: bdx-script-${JOB_NAME}
        - name: bdx-data
          emptyDir: {}
JOBEOF

echo "[bdx-k8s] Waiting for init container..."
POD_NAME=""
for i in $(seq 1 120); do
  POD_NAME="$(kubectl get pod -n "${NAMESPACE}" -l "job-name=${JOB_NAME}" -o name 2>/dev/null | head -1)"
  if [ -n "${POD_NAME}" ]; then
    POD_NAME="${POD_NAME#pod/}"
    init_state="$(kubectl get pod -n "${NAMESPACE}" "${POD_NAME}" -o jsonpath='{.status.initContainerStatuses[0].state}' 2>/dev/null || true)"
    if echo "${init_state}" | grep -q "running"; then
      break
    fi
  fi
  sleep 2
done

if [ -z "${POD_NAME}" ]; then
  echo "ERROR: Could not find Job pod" >&2
  exit 1
fi

echo "[bdx-k8s] Uploading BDX file..."
kubectl cp "${BDX_SOURCE_FILE}" "${NAMESPACE}/${POD_NAME}:/bdx/source/bdx-source.xlsx" -c wait-for-file

echo "[bdx-k8s] Running. Job: ${JOB_NAME}, Pod: ${POD_NAME}"
echo ""
echo "Commands:"
echo "  Monitor:     kubectl logs -f -n ${NAMESPACE} ${POD_NAME} -c runner"
echo "  Status:      kubectl get job -n ${NAMESPACE} ${JOB_NAME}"
echo "  Last lines:  kubectl logs --tail=20 -n ${NAMESPACE} ${POD_NAME} -c runner"
if [ "${MODE}" = "reconcile" ]; then
  echo ""
  echo "  Get report:  kubectl logs -n ${NAMESPACE} ${POD_NAME} -c runner | grep '^{' | tail -1 | jq ."
  echo "  Save report: kubectl logs -n ${NAMESPACE} ${POD_NAME} -c runner | grep '^{' | tail -1 > bdx-reconciliation-report.json"
fi
echo ""
echo "  Clean up:    kubectl delete job -n ${NAMESPACE} ${JOB_NAME} && kubectl delete configmap -n ${NAMESPACE} bdx-script-${JOB_NAME}"
