---
title: New AKS environment
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# New AKS environment

## Commands (in order)
```bash
./tools/quality/aks/provision-prod.sh                       # RG, VNet, AppGw, AKS, AGIC, KV, monitoring
az aks get-credentials -g "$RESOURCE_GROUP" -n "$AKS_CLUSTER_NAME"
./tools/quality/aks/bootstrap-platform.sh                   # namespaces, metrics-server, cert-manager, KEDA, KV CSI
./tools/quality/aks/import-appgw-ssl-cert.sh                # PFX → AppGw
kubectl create namespace "$AKS_NAMESPACE"
kubectl create secret generic abbeygate-runtime-secrets ...  # see Required keys
./tools/quality/aks/configure-github-oidc.sh                # creates OIDC identity → paste IDs into GH Environment
./tools/quality/aks/staging-doctor.sh                       # final health check
# Merge to main → Azure Images builds SHA images → AKS Deploy promotes that SHA.
```

## Identifiers (decide once, use everywhere)
`RESOURCE_GROUP=abbeygate-<slug>-rg` · `AKS_CLUSTER_NAME=abbeygate-<slug>-aks` · `AKS_NAMESPACE=faciomga-<slug>` · `KEYVAULT_NAME` (globally unique). `provision-prod.sh` defaults VNet `10.30.0.0/16`; change locally if it overlaps a peered VNet. ACR defaults to shared `abbeygateacr`.

## Manual data-layer (not in scripts)
- **Postgres Flexible Server**: create app DB, allow `vector` extension at server level, then `CREATE EXTENSION IF NOT EXISTS "vector"` in app DB before first `prisma migrate deploy`. Set retention/geo per `check-backup-posture.mjs`.
- **Redis**: TLS + password. Secret must expose `REDIS_ADDRESS` xor (`REDIS_HOST` + `REDIS_PORT`); plus `REDIS_PASSWORD`, `REDIS_TLS=true`.
- **Blob**: storage account + container; enable versioning, soft delete, container delete retention, change feed.

## Required runtime secret keys
`DATABASE_URL` · `JWT_SECRET` · `SESSION_SECRET` · `REDIS_PASSWORD` · `REDIS_ADDRESS` xor (`REDIS_HOST`+`REDIS_PORT`) · `STORAGE_PROVIDER=azure` · `STORAGE_CONNECTION_STRING` · `STORAGE_CONTAINER_NAME` · `INBOUND_WEBHOOK_SECRET` (must equal GH env secret of same name). Backend `SENTRY_DSN` is required by Helm but is auto-upserted from the GH Actions environment secret of the same name on every `aks-deploy` (so you do not seed it into the K8s secret manually). Other optional integrations live under `optionalSecretKeys` in [`values.yaml`](../../infrastructure/k8s/helm/abbeygate/values.yaml).

## GitHub Environment (mirror `production-aks`)
Secrets: `AZURE_CLIENT_ID` · `AZURE_TENANT_ID` · `AZURE_SUBSCRIPTION_ID` · build-time `VITE_SENTRY_DSN` (frontend bundle) · runtime `SENTRY_DSN` (backend, upserted into the K8s secret by `aks-deploy.yml`); optional `SENTRY_AUTH_TOKEN`. Variables: `AKS_API_HOST` · `AKS_RUNTIME_SECRET_NAME`; optional `AKS_API_ADDITIONAL_HOST` · `AKS_APPGW_SSL_CERT_NAME` · `QUEUE_SMOKE_ENDPOINT` · `SENTRY_ORG` · `SENTRY_PROJECT`.

Deploy automation is four workflows only: `ci.yml`, `azure-images.yml`, `aks-deploy-staging.yml`, and `aks-deploy.yml`. For a new cluster, parameterize environment values or add a reviewed caller outside `.github/workflows/` after updating this runbook.

## Forbidden
- First migrate before `vector` extension is allowed.
- Production deploy with `STORAGE_PROVIDER=local`.
- Reusing `production-aks` GitHub Environment name for a non-prod cluster.
- Creating extra workflow buttons for reset, BDX, backup posture, or evidence tasks.

## Links
- Adjacent: [deploy.md](./deploy.md) · [staging-delivery.md](./staging-delivery.md) · [backup-and-restore.md](./backup-and-restore.md) · [database-migrations.md](./database-migrations.md)
