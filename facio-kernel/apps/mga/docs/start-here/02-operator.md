---
title: Operator entrypoint
audience: operator
status: living
owner: platform-eng
reviewed: 2026-05-04
binding: false
---

# Operator entrypoint

If something is on fire → [operate/incident-response.md](../operate/incident-response.md).

## Four operations
| When | Run | Procedure |
|---|---|---|
| Ship to production | `./tools/quality/aks/run-prod-rollout.sh` | [operate/deploy.md](../operate/deploy.md) |
| Roll back | `npm run rollback:drill` (drill) or follow procedure | [operate/rollback.md](../operate/rollback.md) |
| Restore data | `npm run backup:restore:validate` | [operate/backup-and-restore.md](../operate/backup-and-restore.md) |
| Stand up new env | manual checklist | [operate/new-environment.md](../operate/new-environment.md) |

## Pre-deploy gate (every time)
```bash
npm run backup:posture:check
```
Deploy is **not approved** if: backup posture has any failure · last restore validation > 30 days · prod uses `STORAGE_PROVIDER=local` or `TEMPLATE_UPLOAD_MODE=disk` · release contains a schema migration with no compatibility note. Why each is non-negotiable: [operate/backup-policy.md](../operate/backup-policy.md).

## Binding SLOs
| Target | Source |
|---|---|
| Release rollback RTO < 10 min | [rollback.md](../operate/rollback.md) |
| Data restore RTO ≤ 4 h | [backup-and-restore.md](../operate/backup-and-restore.md) |
| PostgreSQL RPO ≤ 15 min | [backup-policy.md](../operate/backup-policy.md) |
| Restore validation cadence ≤ 30 days | [backup-policy.md](../operate/backup-policy.md) |
| Rollback drill cadence quarterly | [rollback.md](../operate/rollback.md) |

## Production env vars (must exist in `production-aks` GH env + AKS runtime secret)
```text
AKS_API_HOST · AKS_API_ADDITIONAL_HOST · AKS_RUNTIME_SECRET_NAME · AKS_APPGW_SSL_CERT_NAME
AKS_POSTGRES_SERVER_NAME · AKS_STORAGE_ACCOUNT_NAME · AKS_KEYVAULT_NAME
BACKUP_POLICY_LAST_RESTORE_VALIDATED_AT · REDIS_RECOVERY_MODE
# Optional when Redis is persistent: AKS_REDIS_NAME · REDIS_PERSISTENCE_EVIDENCE
```

## Monitoring + alerts
App Insights queries + alert thresholds: [operate/monitoring.md](../operate/monitoring.md). Log contract: [architecture/contracts/events-and-projections.md](../architecture/contracts/events-and-projections.md).

## All canonical runbooks
```text
docs/operate/
  deploy.md  rollback.md  incident-response.md  backup-and-restore.md
  database-migrations.md  new-environment.md  staging-delivery.md
  backup-policy.md  backup-control-statement.md  monitoring.md
  reference/   # long-form ops reference (e.g. new-environment-extended.md)
```
If it's not in `docs/operate/`, it's not a runbook. Files directly under `docs/operate/` are the executable surface (≤60 lines, commands first); `docs/operate/reference/` is the long-form companion (uncapped) for "how does this fit together". Anything in `docs/archive/` is historical evidence, not an instruction set. Live worker handler catalogue + per-job recovery references: [reference/runbooks-coverage.md](../reference/runbooks-coverage.md). All commands: [reference/npm-scripts.md](../reference/npm-scripts.md).
