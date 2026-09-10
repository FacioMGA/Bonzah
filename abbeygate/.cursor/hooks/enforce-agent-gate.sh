#!/bin/sh
set -eu

input="$(cat)"
command="$(printf '%s' "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"

case "$command" in
  *"git push"*|*"gh workflow run"*|*"helm upgrade"*|*"helm install"*|*"helm rollback"*|*"kubectl apply"*|*"kubectl rollout"*|*"kubectl set image"*|*"kubectl scale"*|*"kubectl delete"*|*"az aks command invoke"*|*"npm run deploy"*|*"npm run release"*|*"tools/quality/aks/run-prod-rollout.sh"*|*"tools/maintenance/deploy"*)
    ;;
  *)
    printf '%s\n' '{"permission":"allow"}'
    exit 0
    ;;
esac

stamp_path=".cursor/cache/agent-gate-stamp.json"
if [ ! -f "$stamp_path" ]; then
  printf '%s\n' '{"permission":"deny","user_message":"No local gate stamp found. Run `npm run gate:agent` before push or deploy-style commands.","agent_message":"Blocked risky shell command until the local agent gate passes."}'
  exit 0
fi

stamp_head="$(sed -n 's/.*"headSha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$stamp_path" | head -n 1)"
current_head="$(git rev-parse HEAD 2>/dev/null || true)"

if [ -n "$stamp_head" ] && [ "$stamp_head" = "$current_head" ]; then
  printf '%s\n' '{"permission":"allow"}'
  exit 0
fi

printf '%s\n' '{"permission":"deny","user_message":"Current HEAD differs from the last passing local gate. Run `npm run gate:agent` before push or deploy-style commands.","agent_message":"Blocked risky shell command until the local agent gate passes."}'
