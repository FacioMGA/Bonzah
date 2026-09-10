#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

MODE="${1:-${AGENT_GATE_MODE:-default}}"
STAMP_PATH="${ROOT_DIR}/.cursor/cache/agent-gate-stamp.json"
COMPOSE_FILE="${ROOT_DIR}/infrastructure/docker/compose/docker-compose.yml"
STAMP_TTL_HOURS="${AGENT_GATE_TTL_HOURS:-12}"

FAST_COMMANDS=(
  "npm run lint:all"
  "npm run lint:layers"
  "npm run lint:frontend-zones:strict"
  "npm run lint:core-guard"
  "npm run scan:secrets"
  "npm run policy:any"
  "npm run guard:dead-code-baseline"
  "npm run guard:depcheck-baseline"
  "npm run build:api"
  "npm run type-check"
)

run_command() {
  local command="$1"
  echo "[agent-gate] ==> ${command}"
  eval "${command}"
}

ensure_local_services() {
  echo "[agent-gate] Ensuring local Postgres/Redis are available..."
  if nc -z 127.0.0.1 5433 && nc -z 127.0.0.1 6379; then
    echo "[agent-gate] Reusing existing local Postgres/Redis on 5433/6379."
  else
    docker compose -f "${COMPOSE_FILE}" up -d postgres redis
  fi

  for i in $(seq 1 90); do
    if nc -z 127.0.0.1 5433 && nc -z 127.0.0.1 6379; then
      echo "[agent-gate] Local Postgres/Redis are reachable."
      break
    fi
    if [ "${i}" -eq 90 ]; then
      echo "[agent-gate] ERROR: local Postgres/Redis did not become ready in time." >&2
      exit 1
    fi
    sleep 1
  done

  export DATABASE_URL="postgresql://admin:password123@127.0.0.1:5433/abbeygate_uw"
  export REDIS_HOST="127.0.0.1"
  export REDIS_PORT="6379"
  export REDIS_TLS="false"
  export REDIS_ENABLE_CLUSTER="false"
  export QUEUE_MODE="redis"
}

prepare_local_integration_state() {
  ensure_local_services
  run_command "npm run prisma:generate"
  run_command "npm run db:push:ci"
  run_command "npm run db:seed"
}

write_stamp() {
  mkdir -p "$(dirname "${STAMP_PATH}")"

  local head_sha
  head_sha="$(git rev-parse HEAD)"
  local workspace_fingerprint
  workspace_fingerprint="$(node "${ROOT_DIR}/tools/quality/compute-repo-fingerprint.mjs" "${ROOT_DIR}")"

  node --input-type=module - <<'NODE' "${STAMP_PATH}" "${MODE}" "${head_sha}" "${workspace_fingerprint}" "${STAMP_TTL_HOURS}"
import fs from 'node:fs';

const [stampPath, mode, headSha, workspaceFingerprint, ttlHoursRaw] = process.argv.slice(2);
const ttlHours = Number(ttlHoursRaw || 12);
const now = new Date();
const validUntil = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

const payload = {
  generatedAt: now.toISOString(),
  validUntil: validUntil.toISOString(),
  mode,
  headSha,
  workspaceFingerprint,
  requiredCommand: 'npm run gate:agent',
  notes: [
    'Risky push/deploy commands are allowed when HEAD still matches the gated commit.',
    'If you commit after running the gate, the hook also accepts a commit created from the exact gated workspace snapshot.',
  ],
};

fs.writeFileSync(stampPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
NODE

  echo "[agent-gate] Wrote gate stamp to ${STAMP_PATH}"
}

run_fast_gate() {
  for command in "${FAST_COMMANDS[@]}"; do
    run_command "${command}"
  done
}

# Re-run every doc generator and fail if any regenerated file ends up as
# an unstaged diff in the working tree. This is the local twin of CI's
# `docs:generate:check`: it surfaces stale `docs/reference/*.md` BEFORE
# push instead of at the next CI run, so commits that incidentally
# shift an inventory (a new module, a new npm script, an ADR review
# bump) ship with the regenerated doc already amended in.
#
# Behaviour:
#   - If docs/reference/ is already fresh, the run is a no-op.
#   - If the gate regenerates content, it fails with the file list and a
#     one-line remediation. The operator stages + amends and re-runs.
#   - If the operator already staged a regen, the unstaged check passes;
#     the gate does not interfere with their pending commit.
run_docs_freshness_gate() {
  echo "[agent-gate] ==> ensure docs/reference/ is fresh"
  # True local twin of CI's `docs:generate:check`: compare generated CONTENT
  # via the generator's own --check (which ignores the volatile `reviewed:`
  # date) instead of writing files and git-diffing. Writing left date-only
  # churn in the tree and false-failed at UTC midnight; the content check does
  # not, while still catching real inventory drift (new module/script/ADR).
  local docs_check_out
  if ! docs_check_out="$(npm run --silent docs:generate:check 2>&1)"; then
    echo ""
    echo "[agent-gate] ERROR: docs/reference/ is stale (content drift)."
    echo "${docs_check_out}"
    echo ""
    echo "Fix: \`npm run docs:generate\`, then \`git add docs/reference/ && git commit\` (or amend), and re-run \`npm run gate:agent\`."
    exit 1
  fi
  echo "[agent-gate] docs/reference/ already fresh."
}

# Same shape as run_docs_freshness_gate but for the validation contract
# generator. Added in `spine/v2` Wave 5 after a parallel-agent review
# noted that `contract:generate:check` was not part of `gate:agent` and
# the generated artifacts had silently drifted.
run_contract_freshness_gate() {
  echo "[agent-gate] ==> ensure validation contract artifacts are fresh"
  npm run contract:generate >/dev/null
  local contract_paths=(
    "packages/products/src/motor/generated/motorValidationContract.generated.ts"
    "docs/architecture/validation-contract-audit.md"
    "artifacts/contracts/motor-validation-contract.audit.json"
  )
  if ! git diff --quiet --no-ext-diff -- "${contract_paths[@]}"; then
    echo ""
    echo "[agent-gate] ERROR: validation contract artifacts regenerated with new content."
    echo "[agent-gate] Drifted files:"
    git status --porcelain -- "${contract_paths[@]}"
    echo ""
    echo "Fix: \`git add ${contract_paths[*]} && git commit --amend --no-edit\` (or a new commit), then re-run \`npm run gate:agent\`."
    exit 1
  fi
  echo "[agent-gate] validation contract artifacts already fresh."
}

run_contract_gate() {
  prepare_local_integration_state
  run_command "npm run test:contracts-fast"
}

run_bdx_gate() {
  prepare_local_integration_state
  run_command "npm run test:bdx-import"
}

# Full vitest suite (~260 files / ~1140 tests). Promoted from a
# warn-only ratchet to a BLOCKING step in PR 6.2 of the
# errors-and-warnings cleanup (see ADR-0021).
#
# Escape valve: set `AGENT_GATE_ALLOW_TEST_FAIL=1` to fall back to
# warn-only behaviour for an explicitly broken-tree work session.
# The escape valve is NOT a long-term toggle — every commit pushed
# without it must show a green test:full.
run_unit_full() {
  local artifact_dir="${ROOT_DIR}/artifacts/quality"
  mkdir -p "${artifact_dir}"
  local log_path="${artifact_dir}/unit-full.log"
  local summary_path="${artifact_dir}/unit-full.summary.txt"
  local allow_fail="${AGENT_GATE_ALLOW_TEST_FAIL:-0}"
  local label
  if [ "${allow_fail}" = "1" ]; then
    label="(warn-only — AGENT_GATE_ALLOW_TEST_FAIL=1)"
  else
    label="(blocking)"
  fi

  echo "[agent-gate] ==> npm run test:full ${label}"
  set +e
  npm run test:full 2>&1 | tee "${log_path}"
  local rc=${PIPESTATUS[0]}
  set -e

  local files_line tests_line
  files_line="$(grep -E '^[[:space:]]*Test Files' "${log_path}" | tail -1 || true)"
  tests_line="$(grep -E '^[[:space:]]*Tests[[:space:]]' "${log_path}" | tail -1 || true)"

  {
    if [ "${rc}" -ne 0 ]; then
      if [ "${allow_fail}" = "1" ]; then
        echo "[agent-gate] WARN: test:full reported failures (exit=${rc}) — non-blocking via AGENT_GATE_ALLOW_TEST_FAIL=1"
      else
        echo "[agent-gate] FAIL: test:full reported failures (exit=${rc})"
      fi
    else
      echo "[agent-gate] OK: test:full passed (exit=0)"
    fi
    [ -n "${files_line}" ] && echo "${files_line}"
    [ -n "${tests_line}" ] && echo "${tests_line}"
    echo "Artifact: ${log_path}"
  } | tee "${summary_path}"

  if [ "${rc}" -ne 0 ] && [ "${allow_fail}" != "1" ]; then
    exit "${rc}"
  fi
}

case "${MODE}" in
  static)
    run_docs_freshness_gate
    run_contract_freshness_gate
    run_fast_gate
    ;;
  default)
    run_docs_freshness_gate
    run_contract_freshness_gate
    run_fast_gate
    run_contract_gate
    run_unit_full
    ;;
  full)
    run_docs_freshness_gate
    run_contract_freshness_gate
    run_fast_gate
    run_contract_gate
    run_bdx_gate
    run_unit_full
    ;;
  unit-full)
    run_unit_full
    ;;
  staging-like)
    run_docs_freshness_gate
    run_contract_freshness_gate
    run_fast_gate
    run_command "npm run test:staging-like"
    ;;
  *)
    echo "[agent-gate] Unknown mode '${MODE}'. Valid modes: static | default | full | unit-full | staging-like" >&2
    exit 1
    ;;
esac

write_stamp
echo "[agent-gate] Completed successfully in '${MODE}' mode."
