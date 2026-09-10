---
title: Deploy to AKS production
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Deploy to AKS production

## Normal path
```bash
# 1. Merge PR to main. Branch protection requires `quality` and `CodeQL`.
# 2. `Azure Images` builds immutable API/worker images for the SHA.
# 3. `AKS Deploy (Staging)` auto-deploys that SHA after CI success and smoke.
# 4. `AKS Deploy` auto-promotes to production on staging success (workflow_run).
#    Manual workflow_dispatch with the exact 40-char SHA remains for hotfixes.
```

## What runs
`aks-deploy.yml` promotes an existing immutable SHA only after a successful `AKS Deploy (Staging)` run for the same SHA (auto via `workflow_run`, or manual dispatch; `skip_staging_verify` is an emergency-only override): validate staging success → verify images exist in ACR → Helm upgrade → rollout wait → smoke. Deploy never builds images and never runs runner-side database work.

## Migrations
Schema migration is Kubernetes-native. Helm creates a migration Job/hook from the same immutable API image before the rollout. Baselines, backfills, BDX, DB reset, backup posture, and release evidence packets are operator runbook tasks, not deploy workflow steps.

## GitHub Environment `production-aks`
Secrets: `AZURE_CLIENT_ID` · `AZURE_TENANT_ID` · `AZURE_SUBSCRIPTION_ID` · `SENTRY_DSN` (deploy hard-fails if missing or malformed — it is upserted into the runtime secret). Variables: `AKS_API_HOST` (read as `CY4_AKS_API_HOST` first, unprefixed fallback) · `AKS_RUNTIME_SECRET_NAME` (unprefixed only — variable or same-named secret); optional `AKS_APPGW_SSL_CERT_NAME` (`CY4_` prefix first) · `QUEUE_SMOKE_ENDPOINT`. Ingress hosts are chart-authoritative in `values.yaml` (ADR-0049). Required-reviewer environment gates are unavailable on the current GitHub billing plan; the production gate is the staging-success preflight.

## Success criteria
Images already built → deploy is 60–120 seconds from workflow start to rollout complete and smoke green. Main push → staging live is ≤ 5 minutes after DNS/TLS for staging hosts exists.

## Forbidden
- Deploying `latest`, branch names, tags, or short SHAs.
- Adding `npm ci`, runner Prisma, Postgres firewall, ACR build, backup posture, BDX, DB reset, go/no-go, or evidence packet work to `aks-deploy.yml`.
- App-only rollback when data correctness is in doubt; use [backup-and-restore.md](./backup-and-restore.md).

## Links
- Adjacent: [rollback.md](./rollback.md) · [backup-and-restore.md](./backup-and-restore.md) · [database-migrations.md](./database-migrations.md) · [new-environment.md](./new-environment.md) · [staging-delivery.md](./staging-delivery.md)
