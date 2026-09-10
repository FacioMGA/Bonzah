---
title: Creditsafe live cutover
audience: operator
status: living
owner: platform-eng
reviewed: 2026-07-30
binding: false
---

# Creditsafe sanctions screening live cutover (ADR-0043)

Turns on live, fail-closed Creditsafe KYC Protect sanctions/PEP screening for
quote + bind + issue flows. Screening is opt-in: `serviceFactory.ts` uses the
real provider only when `CREDITSAFE_ENABLED` is truthy AND all three creds are
present; otherwise it auto-clears via the disabled provider. Secrets are
operator-owned and never committed. Do steps in order.

## 1. Validate credentials first (no cluster needed)
Black-box probe of the third-party API (1 credit, no DB/backend):
```bash
CREDITSAFE_BASE_URL=https://connect.creditsafe.com/v1 \
  CREDITSAFE_USERNAME=<user> CREDITSAFE_PASSWORD=<pass> \
  node tools/smoke/sanctions-screening-verify.mjs
```
Must print `integration verified end-to-end`. Enabling with bad creds is
fail-closed and will BLOCK quotes/binds — validate before step 2.

## 2. Secret (BEFORE/with deploy)
Set all keys atomically — never `CREDITSAFE_ENABLED` alone, or
`startupValidation` throws and the `helm --atomic` deploy rolls back:
```bash
kubectl -n faciomga-prod patch secret abbeygate-runtime-secrets --type=merge -p '{"stringData":{
  "CREDITSAFE_ENABLED":"true",
  "CREDITSAFE_BASE_URL":"https://connect.creditsafe.com/v1",
  "CREDITSAFE_USERNAME":"<user>","CREDITSAFE_PASSWORD":"<pass>"
}}'
```
Threshold (90) and the full AML dataset list are owned by `serviceFactory.ts`
(`DEFAULT_AML_DATASETS`); override via `CREDITSAFE_THRESHOLD` /
`CREDITSAFE_DATASETS` secret keys only if a binder demands it. Online
blocking uses `CREDITSAFE_BLOCKING_DATASETS`; leave unset to exclude
credit-only `INS`/`DD` matches from customer referral.

## 3. Deploy
Merge the chart PR to `main` (auto-deploys prod). The chart wires `CREDITSAFE_*`
from the secret into api + worker pods (`runtimeConfig.optionalSecretKeys`).

## 4. Verify
- `/health/integrations` shows `creditsafe` = configured (not degraded).
- A clean name still rates; a known PEP/sanctions name is referred (BO
  underwriting + premium tabs show the top-hit row + PDF).

## 5. Rollback
Set `CREDITSAFE_ENABLED=false` in the secret, then `kubectl -n faciomga-prod
rollout restart deploy/abbeygate-abbeygate-api deploy/abbeygate-abbeygate-worker`.
Provider falls back to auto-clear; no redeploy needed.
