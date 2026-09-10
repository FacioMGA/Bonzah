---
title: Secrets rotation
audience: operator
status: living
owner: platform-eng
reviewed: 2026-05-10
binding: false
---

# Secrets rotation runbook

## Governs
Rotating `JWT_SECRET` and `QUOTE_TOKEN_SECRET` independently. Per ADR-0019 these live in separate keyspaces — rotating one does not affect the other.

## Scope
- `JWT_SECRET` — session JWTs, OTP confirm tokens, claim FNOL link tokens, public quote middleware session tokens.
- `QUOTE_TOKEN_SECRET` — quote-token signing in `backend/modules/pricing/domain/quoteToken.ts` only.

## Pre-flight
1. Confirm both secrets are seeded in the target K8s namespace and differ. `kubectl get secret abbeygate-app -o json | jq '.data | keys'`.
2. Verify startup validation rejects equal values: `node -e "process.env.JWT_SECRET='x'; process.env.QUOTE_TOKEN_SECRET='x'; require('./backend/dist/platform/config/startupValidation.js').validateStartupConfig()"` (expect throw).
3. Decide rotation window. `QUOTE_TOKEN_SECRET` rotation invalidates all in-flight quote tokens issued under the previous secret (default TTL 14 days). Coordinate with customer-success: customers mid-flow get an "expired quote" error and must restart from email.

## Rotate `QUOTE_TOKEN_SECRET`
1. Generate: `openssl rand -hex 32`.
2. Patch K8s secret: `kubectl patch secret abbeygate-app -p '{"data":{"QUOTE_TOKEN_SECRET":"<base64>"}}'`.
3. Roll API + worker pods: `kubectl rollout restart deploy/abbeygate-api deploy/abbeygate-worker`.
4. Watch startup validator success: `kubectl logs deploy/abbeygate-api --since=2m | grep StartupValidation`.
5. Verify a fresh public-quote flow signs + verifies correctly via `npm run smoke:quote-issue-bind`.

## Rotate `JWT_SECRET`
Same five steps, swapping the secret name. Session cookies signed with the previous secret stop verifying immediately — users are redirected to login. OTP / FNOL flows in-flight at rotation time fail and must be restarted.

## Post-rotation
- Append the rotation timestamp + actor to the change log: `kubectl annotate secret abbeygate-app rotation.lastAt=$(date -Iseconds) rotation.lastBy=$USER --overwrite`.
- Page the on-call if the post-rotation `npm run smoke:quote-issue-bind` doesn't return green within 10 minutes.

## Forbidden
- Setting `QUOTE_TOKEN_SECRET = JWT_SECRET`. Startup validation throws.
- Re-introducing the legacy `process.env.QUOTE_TOKEN_SECRET || process.env.JWT_SECRET` chain anywhere. The `check-no-deleted-identifiers` guard catches the literal pattern.
