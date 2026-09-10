#!/usr/bin/env bash
set -euo pipefail

# Upsert a GitHub ruleset that enforces PR quality/security checks on the default branch.
#
# Required:
#   gh auth login (or GH_TOKEN with repo admin scope)
# Optional:
#   REPO=owner/name (defaults to current gh repo)
#   RULESET_NAME (defaults to "Main branch quality gates")
#
# Usage:
#   ./tools/quality/ci/apply-main-quality-ruleset.sh

REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
RULESET_NAME="${RULESET_NAME:-Main branch quality gates}"
GH_ACTIONS_APP_ID="${GH_ACTIONS_APP_ID:-15368}"

payload_file="$(mktemp)"
cat > "${payload_file}" <<EOF
{
  "name": "${RULESET_NAME}",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_approving_review_count": 1,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "quality", "integration_id": ${GH_ACTIONS_APP_ID} },
          { "context": "Analyze (javascript-typescript)", "integration_id": ${GH_ACTIONS_APP_ID} },
          { "context": "Secret scan (gitleaks)", "integration_id": ${GH_ACTIONS_APP_ID} }
        ]
      }
    }
  ]
}
EOF

existing_id="$(
  gh api "repos/${REPO}/rulesets" --jq ".[] | select(.name == \"${RULESET_NAME}\") | .id" || true
)"

if [[ -n "${existing_id}" ]]; then
  echo "Updating ruleset '${RULESET_NAME}' (id=${existing_id}) on ${REPO}..."
  gh api \
    --method PUT \
    "repos/${REPO}/rulesets/${existing_id}" \
    --input "${payload_file}" >/dev/null
else
  echo "Creating ruleset '${RULESET_NAME}' on ${REPO}..."
  gh api \
    --method POST \
    "repos/${REPO}/rulesets" \
    --input "${payload_file}" >/dev/null
fi

echo "Ruleset applied successfully."
