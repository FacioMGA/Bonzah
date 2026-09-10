---
title: AKS new-environment extended reference
audience: operator
status: reference
owner: platform-eng
reviewed: 2026-05-04
binding: false
---

# AKS new-environment — extended reference

This is the **long-form** companion to [`operate/new-environment.md`](../new-environment.md). The runbook proper is the executable surface for on-call (cap: 60 lines, commands first). This file is reference material for the deeper "how does this all fit together" — automated vs manual, naming patterns, secret keys, sequencing — when standing up **another** full stack similar to the existing AKS + Application Gateway setup (e.g. a second staging).

It is allowed to grow. It is **not** binding. The binding artefacts are: the runbook (executable steps), the binding contracts under `architecture/contracts/`, and the generated inventories under `reference/`.

## What is automated vs manual

| Area | Automated in repo | Usually manual / separate |
|------|-------------------|---------------------------|
| Resource group, Log Analytics, Key Vault, VNet + subnets, WAF policy, Application Gateway, AKS, AGIC, monitoring addon, optional private endpoints & Front Door shell | [`tools/quality/aks/provision-prod.sh`](../../../tools/quality/aks/provision-prod.sh) | Choosing names, region, address space conflicts, quotas |
| Namespaces, metrics-server, cert-manager, KEDA, Key Vault CSI Helm chart | [`tools/quality/aks/bootstrap-platform.sh`](../../../tools/quality/aks/bootstrap-platform.sh) | External DNS (optional flag in script) |
| GitHub Actions → ACR image build on `main` | [`.github/workflows/azure-images.yml`](../../../.github/workflows/azure-images.yml) (uses `AZURE_CREDENTIALS` secret) | Ensuring repo secrets exist |
| GitHub OIDC identity + AKS RBAC for deploy | [`tools/quality/aks/configure-github-oidc.sh`](../../../tools/quality/aks/configure-github-oidc.sh) | Creating a **GitHub Environment** and pasting IDs |
| Postgres Flexible Server, logical DB, extensions, firewall / networking | — | Azure Portal or `az postgres flexible-server ...` |
| Azure Cache for Redis | — | Portal or `az redis create` / Enterprise as applicable |
| Storage account, container, blob protection (versioning, soft delete, change feed) | — | Portal or `az storage account create` + container + policies |
| TLS cert on Application Gateway | [`tools/quality/aks/import-appgw-ssl-cert.sh`](../../../tools/quality/aks/import-appgw-ssl-cert.sh) | Obtaining PFX / DNS validation |
| Runtime `Secret` in the target namespace | — | `kubectl create secret generic ...` or CSI from Key Vault (chart supports KV; default chart uses opaque secret) |
| Deploy workflow for **non–production-aks** cluster | — | Current production deploy is [`AKS Deploy`](../../../.github/workflows/aks-deploy.yml); keep `.github/workflows/` to the three approved workflow files |

**Local vs CI:** Provisioning and bootstrap are normally run **from an operator machine** (`az login`, `./provision-prod.sh`, `./bootstrap-platform.sh`, `kubectl`). That does **not** use a "key from your Mac" for GitHub Actions image builds; builds use **`AZURE_CREDENTIALS`** in GitHub. Deploy to AKS uses **OIDC** (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`) on the `production-aks` environment — replicate that pattern for a new GitHub Environment.

## 1. Decide identifiers (example pattern)

Pick a consistent **environment slug** (e.g. `staging2`, `eu-test`). Use it in names to avoid collisions:

- `RESOURCE_GROUP` — e.g. `abbeygate-<slug>-rg`
- `AKS_CLUSTER_NAME` — e.g. `abbeygate-<slug>-aks`
- `AKS_VNET_NAME`, subnet names — must be unique within the RG
- `KEYVAULT_NAME` — globally unique in Azure
- `AKS_NAMESPACE` — Kubernetes namespace for the app (existing prod uses `faciomga-prod`; for a new env use something like `faciomga-<slug>`)
- `LOG_ANALYTICS_NAME`, `APP_GW_NAME` — unique within subscription/RG as required

**Networking:** `provision-prod.sh` defaults the VNet to `10.30.0.0/16` with fixed subnets. If that overlaps another peered VNet in the same region, change the script locally for this run or use a dedicated subscription.

**ACR:** The script defaults `ACR_NAME=abbeygateacr` and `az aks create ... --attach-acr`. A new cluster in the same subscription can keep using the **shared ACR**; no need to recreate ACR unless you want isolation.

## 2. Durable data layer (before or after AKS, but before first deploy)

### PostgreSQL (Flexible Server)

- Create a **Flexible Server** in the same region strategy as the app (or as required by compliance).
- Create the **application database** (do not rely on `postgres` unless you intentionally baseline there).
- **Enable the `vector` extension** before first `prisma migrate deploy`. The baseline migration uses `CREATE EXTENSION IF NOT EXISTS "vector";` — on Azure this requires allowing the extension for the server (server parameters / allowed extensions), then running `CREATE EXTENSION` in the app DB if needed.
- Set backup retention and geo-redundancy to satisfy [`tools/quality/aks/check-backup-posture.mjs`](../../../tools/quality/aks/check-backup-posture.mjs) if you will run the same deploy checks as prod (defaults include retention and blob policies). See also [`operate/backup-policy.md`](../backup-policy.md).
- Network: either **public access + firewall** (simpler for first env) or **private access** + private endpoint. If private, set `CREATE_PRIVATE_ENDPOINTS=true` and pass `POSTGRES_RESOURCE_ID`, etc., when re-running or extending provisioning (see script header comments in `provision-prod.sh`).

### Redis (Azure Cache for Redis)

- Create a cache with TLS and access keys.
- Runtime secret must expose either **`REDIS_ADDRESS`** or **`REDIS_HOST` + `REDIS_PORT`** (see staging doctor and deploy workflow). Set **`REDIS_PASSWORD`** and typically **`REDIS_TLS=true`** for Azure (see `backend/platform/redis/client.ts` / queue).

### Blob storage

- Create a storage account in the RG (or shared pattern).
- Create the **blob container** referenced by `STORAGE_CONTAINER_NAME`.
- Configure **versioning**, **blob soft delete**, **container delete retention**, and **change feed** to satisfy backup posture checks used in production deploy.
- Connection string or managed identity: today's Helm contract expects **`STORAGE_PROVIDER`**, **`STORAGE_CONNECTION_STRING`**, **`STORAGE_CONTAINER_NAME`** in the runtime secret (see `values.yaml` and deploy docs).

### Key Vault

- `provision-prod.sh` creates an empty Key Vault. Optionally store secrets there and sync via CSI (`values.yaml` `keyVault.enabled`). The common path in this repo is an **opaque Kubernetes `Secret`** with the same keys the chart maps to env vars.

## 3. Run cluster + edge provisioning

From repo root, with Azure CLI logged into the correct subscription:

1. Export all **required** variables listed in the header of [`provision-prod.sh`](../../../tools/quality/aks/provision-prod.sh) (`SUBSCRIPTION_ID`, `RESOURCE_GROUP`, `LOCATION`, cluster and AppGw names, VNet/subnet names, `KEYVAULT_NAME`, `LOG_ANALYTICS_NAME`).
2. Optional: `CREATE_PRIVATE_ENDPOINTS=true` plus resource IDs for Postgres, Redis, storage.
3. Run:

```bash
./tools/quality/aks/provision-prod.sh
```

4. Fetch credentials:

```bash
az aks get-credentials --resource-group "$RESOURCE_GROUP" --name "$AKS_CLUSTER_NAME"
```

For private clusters, use the same pattern as `aks-deploy.yml`: `--format azure` and `kubelogin convert-kubeconfig -l azurecli` if you use AAD-enabled kubeconfig.

## 4. Bootstrap cluster add-ons

```bash
export RESOURCE_GROUP='...'
export AKS_CLUSTER_NAME='...'
./tools/quality/aks/bootstrap-platform.sh
```

Edit the script if you need a namespace name other than `faciomga-prod` (it is currently **hard-coded** in `bootstrap-platform.sh` — for a new environment, add your namespace with `kubectl create namespace <name>` or adjust the script for your fork).

## 5. TLS on Application Gateway

- Obtain or issue a cert covering **`AKS_API_HOST`** (and any **additional** hostname).
- Use [`import-appgw-ssl-cert.sh`](../../../tools/quality/aks/import-appgw-ssl-cert.sh) to upload the PFX.
- Note the **certificate resource name** on the gateway; Helm deploy uses `ingress.appgwSslCertificate` (see `aks-deploy.yml` and chart values).

## 6. DNS

- Point **`AKS_API_HOST`** (and additional host if used) to the **Application Gateway public IP** (or Front Door, if you use that layer).
- Confirm HTTP→HTTPS redirect and backend health once the ingress exists.

## 7. Kubernetes runtime secret

Create a Secret named consistently with Helm (default `abbeygate-runtime-secrets` unless overridden).

**Required keys** (deploy + doctor enforce these):

- `DATABASE_URL`
- `JWT_SECRET`
- `SESSION_SECRET`
- `REDIS_PASSWORD`
- `STORAGE_PROVIDER` (production path expects `azure`, not `local`)
- `STORAGE_CONNECTION_STRING`
- `STORAGE_CONTAINER_NAME`
- Redis: `REDIS_ADDRESS` **xor** (`REDIS_HOST` and `REDIS_PORT`)

**Strongly required for production-class deploy workflow parity:**

- `INBOUND_WEBHOOK_SECRET` (must match GitHub environment secret of the same name)

**Optional / product integrations** are listed under `optionalSecretKeys` in [`infrastructure/k8s/helm/abbeygate/values.yaml`](../../../infrastructure/k8s/helm/abbeygate/values.yaml) (email, Twilio, Cardcorp, etc.).

> Verify after deploy: `curl -fsS https://<host>/health/integrations`. Returns 503 in production when any required provider integration (CardCorp, Creditsafe when enabled) is missing its env-var keys, so a forgotten secret key surfaces here instead of as a silent 501 at the first checkout. The same call is wired into [`tools/quality/aks/smoke-checks.sh`](../../../tools/quality/aks/smoke-checks.sh) and runs on every AKS rollout.

Example (adjust naming):

```bash
kubectl create namespace faciomga-staging2   # your namespace
kubectl create secret generic abbeygate-runtime-secrets \
  --namespace=faciomga-staging2 \
  --from-literal=DATABASE_URL='...' \
  --from-literal=JWT_SECRET='...' \
  # ... remaining keys
```

Use literal files or sealed secrets in real ops; above is illustrative.

## 8. Deploy automation (GitHub)

### Image builds

- Ensure [`azure-images.yml`](../../../.github/workflows/azure-images.yml) has **`AZURE_CREDENTIALS`**, **`ACR_USERNAME`**, **`ACR_PASSWORD`**, and build-time secrets such as **`VITE_GOOGLE_MAPS_API_KEY`**.

### OIDC deploy identity

Run [`configure-github-oidc.sh`](../../../tools/quality/aks/configure-github-oidc.sh) with:

- `SUBSCRIPTION_ID`, `RESOURCE_GROUP`, `AKS_CLUSTER_NAME`, `AKS_NAMESPACE` (your new namespace)
- `GITHUB_ORG`, `GITHUB_REPO`, `GITHUB_ENVIRONMENT` (e.g. `staging-aks-2`)
- `DEPLOY_IDENTITY_NAME`

Paste the printed `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` into the **new** GitHub Environment secrets.

### Workflow hard-coding

[`aks-deploy.yml`](../../../.github/workflows/aks-deploy.yml) is the current production deployment workflow and pins:

- `AKS_RESOURCE_GROUP: abbeygate-cy4-rg`
- `AKS_CLUSTER_NAME: abbeygate-cy4-aks`
- `AKS_NAMESPACE: faciomga-prod`
- `environment: production-aks`

For a **new** cluster you must:

- Add a **new workflow/caller** with its own environment block, or
- Refactor the workflow to read from repository/environment variables.

### GitHub Environment variables (mirror `production-aks`)

Cross-check with [`operate/deploy.md`](../deploy.md) and [`operate/backup-and-restore.md`](../backup-and-restore.md). At minimum, production workflow expects:

- `AKS_API_HOST`, optional `AKS_API_ADDITIONAL_HOST`
- `AKS_RUNTIME_SECRET_NAME`
- `AKS_APPGW_SSL_CERT_NAME` (if using App GW cert annotation)
- Backup posture inputs: `AKS_POSTGRES_SERVER_NAME`, `AKS_STORAGE_ACCOUNT_NAME`, `AKS_KEYVAULT_NAME`, `BACKUP_POLICY_LAST_RESTORE_VALIDATED_AT`, `REDIS_RECOVERY_MODE`, optionally `AKS_REDIS_NAME` + `REDIS_PERSISTENCE_EVIDENCE`
- `aks-deploy.yml` reads `AKS_API_HOST`, `AKS_RUNTIME_SECRET_NAME`, optional host/cert/smoke variables, and OIDC secrets from the GitHub Environment.

## 9. First application rollout

1. Build images for a known commit SHA (merge to `main` and use the workflow, or build locally with `az acr build`).
2. Helm upgrade (from CI or locally), same chart as prod: [`infrastructure/k8s/helm/abbeygate`](../../../infrastructure/k8s/helm/abbeygate).
3. Let Helm run the migration Job/hook from the same immutable API image.
4. If the DB is non-empty without Prisma history, the workflow documents an explicit **baseline** path — only use with the confirmation string it requires.

## 10. Verify (do not skip)

- **Local doctor:** run [`tools/quality/aks/staging-doctor.sh`](../../../tools/quality/aks/staging-doctor.sh) with `RESOURCE_GROUP`, `AKS_CLUSTER_NAME`, `AKS_NAMESPACE`, `AKS_RUNTIME_SECRET_NAME` (and optionally `IMAGE_TAG`, `AKS_API_HOST`) set. See [`operate/staging-delivery.md`](../staging-delivery.md).
- **Backup posture (if you enabled strict checks):** `npm run backup:posture:check` with the same env vars the script expects (`RESOURCE_GROUP`, server/storage/KV names, etc.).
- **`/health`** and tenant resolution if you use multi-host tenants (doctor probes known hosts when configured).

## 11. One-page checklist

- [ ] Postgres created; app DB created; **`vector`** allowed and extension OK
- [ ] Redis created; TLS/password documented; secret keys consistent
- [ ] Storage account + container; **versioning / soft delete / change feed** per policy
- [ ] `provision-prod.sh` completed; AGIC attached; kubeconfig works
- [ ] `bootstrap-platform.sh` completed; namespaces exist
- [ ] App Gateway cert imported; DNS points to edge
- [ ] Runtime **Kubernetes Secret** created with all required keys
- [ ] GitHub Environment + OIDC + secrets/vars; **deploy workflow** targets this cluster
- [ ] First Helm deploy + migrations; smoke / doctor green

## Related docs

- Executable runbook: [operate/new-environment.md](../new-environment.md)
- [operate/staging-delivery.md](../staging-delivery.md) — staging doctor, evidence
- [operate/backup-and-restore.md](../backup-and-restore.md) — disaster recovery
- [operate/deploy.md](../deploy.md) — deploy procedure (TLS / env list)
- [operate/backup-policy.md](../backup-policy.md) — backup posture rules
