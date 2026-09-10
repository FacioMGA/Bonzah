---
title: Backup policy
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
supersedes:
  - docs/engineering/BACKUP_POLICY.md
---

# Production backup policy — binding

## Recovery objectives
| System | RPO | RTO | Notes |
|---|---|---|---|
| PostgreSQL | ≤ 15 min | ≤ 4 h | PITR-capable; primary system of record |
| Azure Blob | ≤ 1 h | ≤ 4 h | Versioning + soft delete |
| Key Vault secrets | ≤ 1 h | ≤ 2 h | Source of truth for runtime secrets |
| Redis | per-env declared | ≤ 1 h | Default `disposable`; `persistent` requires evidence |
| AKS app layer | N/A (rebuildable) | ≤ 1 h | From repo + images + runtime secrets |

## Mandatory production settings
`STORAGE_PROVIDER=azure` · `TEMPLATE_UPLOAD_MODE=storage` · PostgreSQL retention ≥ 35 d · Blob versioning ON · Blob soft delete ≥ 30 d · Blob container delete retention ≥ 30 d · Key Vault purge protection ON · last restore validation ≤ 30 d · `REDIS_RECOVERY_MODE` ∈ {`disposable`,`persistent`}.

## GitHub `production-aks` env inputs
`AKS_POSTGRES_SERVER_NAME` · `AKS_STORAGE_ACCOUNT_NAME` · `AKS_KEYVAULT_NAME` · `BACKUP_POLICY_LAST_RESTORE_VALIDATED_AT` · `REDIS_RECOVERY_MODE`. When persistent: `AKS_REDIS_NAME` + `REDIS_PERSISTENCE_EVIDENCE`.

## Required evidence
- **Every prod deploy**: deploy timing summary from `aks-deploy.yml`.
- **Release readiness / material data change**: backup posture report · go/no-go packet.
- **Every scheduled restore validation**: logical backup artefact · restore validation report.
- **Every recovery drill**: rollback drill report + linked backup/restore report.

## Forbidden (does NOT satisfy backup requirements)
- GitHub Actions artefacts as the only backup location.
- Pod-local files / `uploads/` directories on AKS nodes.
- `/health` success without data parity validation.
- Redis persistence assumed without explicit evidence or policy declaration.

## Validators
`npm run backup:posture:check` · `npm run backup:restore:validate` · `npm run rollback:drill`.

## Links
- Adjacent: [backup-and-restore.md](./backup-and-restore.md) · [backup-control-statement.md](./backup-control-statement.md) · [deploy.md](./deploy.md) · [rollback.md](./rollback.md)
