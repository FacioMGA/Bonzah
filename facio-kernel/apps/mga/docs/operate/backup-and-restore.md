---
title: Backup and restore
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Backup and restore

## Commands
```bash
npm run backup:posture:check                # pre-deploy gate
npm run backup:restore:validate             # validates a restore target
npm run rollback:drill                      # quarterly drill
./tools/quality/aks/run-prod-rollout.sh backup-posture
./tools/quality/aks/run-prod-rollout.sh backup-validate
```

## Decision tree
1. App-only failure → redeploy last known-good; DB / blob untouched; run smoke subset.
2. Data corruption / accidental delete / schema mismatch → freeze writes → choose PITR (Azure window covers incident) **or** logical restore → restore into verification target first unless incident demands prod direct.
3. Blob mismatch suspected → recover blob first; PostgreSQL is the source of metadata ownership.

## PITR (PostgreSQL)
1. Freeze writes. Record target timestamp + reason.
2. Create restore target via Azure managed PostgreSQL flow.
3. `BACKUP_RESTORE_DATABASE_URL=<restored-target> npm run backup:restore:validate`
4. Confirm `backup-restore-validation.json`: schema parity, table-count parity, doc-metadata parity, zero failures.

## Logical restore
1. `export BACKUP_SOURCE_DATABASE_URL=… BACKUP_RESTORE_DATABASE_URL=… BACKUP_VALIDATE_DRY_RUN=0`
2. `npm run backup:restore:validate`
3. Require `schemaCompatible:true · dataParityOk:true · documentMetadataOk:true · failures:0`.

## Blob recovery
1. Identify rows: `documents.id`, `storageUri`, `filename`, policy/transaction linkage.
2. In Azure: inspect object history (current, prior versions, soft-deleted).
3. Restore object version or undelete.
4. Validate via document endpoint that the restored blob serves correctly.
5. If PostgreSQL was also restored, reconcile `storageUri` ↔ blob keys before reopening traffic.

## Forbidden
- Recovery without recording the chosen recovery point.
- Production deploy with: backup posture not green; last restore validation > 30 days; `STORAGE_PROVIDER=local`; `TEMPLATE_UPLOAD_MODE=disk`.
- Editing metadata before blob restore confirmed.
- Auto DLQ replay.

## Escalation
- Blob exists but content mismatch · DB points at stale `storageUri` · prod uses local storage / disk templates · validation fails twice on chosen recovery points → incident commander.
- After incident: ADR if RTO/RPO missed or undocumented procedure was used.

## Links
- Policy & cadence: [backup-policy.md](./backup-policy.md) · [backup-control-statement.md](./backup-control-statement.md)
- Adjacent: [deploy.md](./deploy.md) · [rollback.md](./rollback.md) · [database-migrations.md](./database-migrations.md)
