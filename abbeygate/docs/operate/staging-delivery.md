---
title: Staging delivery
audience: operator
status: living
owner: platform-eng
reviewed: 2026-05-04
binding: false
---

# Staging delivery

## Commands (in order)
```bash
npm run gate:agent                # before push (writes pass stamp; hook blocks stale pushes)
npm run test:staging-like         # before asking Azure to validate anything
AKS_RESOURCE_GROUP=abbeygate-cy4-rg AKS_CLUSTER_NAME=abbeygate-cy4-aks \
  AKS_NAMESPACE=faciomga-staging HELM_RELEASE=abbeygate-staging \
  AKS_RUNTIME_SECRET_NAME=abbeygate-runtime-secrets npm run doctor:staging
# GitHub Actions: `CI` → `Azure Images` → `AKS Deploy (Staging)`
npm run evidence:staging          # only on failure → artifacts/staging-evidence-*
```

Faster iteration: `npm run gate:agent:static`. Extended: `npm run gate:agent:full` · `npm run gate:agent:staging-like`.

## Three lanes
| Lane | Proves | Tool |
|---|---|---|
| A — `gate:agent` | Code / architecture / contracts pass locally | lint, layer/zone guards, secret scan, type-check, contracts-fast tier |
| B — `test:staging-like` | Local Postgres + Redis stack produces a green app | reuses local DB+Redis, applies schema/seed, runs core tests |
| C — `doctor:staging` | Target AKS context will accept a deploy | AKS context, namespace perms, runtime secret keys, Redis shape, schedulable nodes, optional ACR tag, optional `/health` |

## Remote path
`CI` proves quality, `Azure Images` publishes API + worker images tagged with the commit SHA, and `AKS Deploy (Staging)` auto-deploys only after it verifies a successful CI push run for the same SHA. Target: push-to-staging ≤ 5 minutes; deploy-only for an existing SHA 60–120 seconds.

## Staging smoke contract
`cy.staging.abbeygate.com` / `pt.staging.abbeygate.com` route through the shared App Gateway with `STAGING_AKS_APPGW_SSL_CERT_NAME`. Deep smoke requires `STAGING_INBOUND_WEBHOOK_SECRET`, `STAGING_SMOKE_BO_EMAIL`, `STAGING_SMOKE_BO_PASSWORD`, `STAGING_API_V1_SMOKE_KEY`, and `STAGING_API_V1_PROGRAM_ID`.

## Modes (do not mix)
- `staging-app` — disposable / resettable; prove deploy + smoke + ingress + rollout. No migration rehearsals.
- `migration-rehearsal` — frozen assumptions; prove schema / backfill / import correctness. No unrelated feature churn.

## Decision tree
| If… | Then… |
|---|---|
| `gate:agent` fails | fix locally; do not push |
| `gate:agent` ok, `test:staging-like` fails | runtime/code issue; fix locally before remote CI |
| local ok, `doctor:staging` fails | env/config drift; inspect generated reports; do not start a deploy loop |
| doctor passes but host probe fails | DNS/TLS or ingress drift; do not treat app code as suspect |
| doctor ok, deploy fails | run `npm run evidence:staging`; choose next move from the packet, not speculation |

## Forbidden
- Push attempt before `gate:agent` passes on the current commit.
- Staging deploy attempt before `doctor:staging` passes.
- Putting backup posture, BDX, DB reset, or release evidence generation into the deploy workflow.

## Links
- Adjacent: [deploy.md](./deploy.md) · [backup-and-restore.md](./backup-and-restore.md)
