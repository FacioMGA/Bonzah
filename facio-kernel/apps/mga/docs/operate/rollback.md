---
title: Rollback
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Rollback

## Commands
```bash
PREVIOUS_RELEASE_TAG=<known-good-tag> npm run rollback:drill
# To force real backup/restore validation during a drill:
ROLLBACK_RUN_REAL_BACKUP_VALIDATE=1 BACKUP_SOURCE_DATABASE_URL=… BACKUP_RESTORE_DATABASE_URL=… npm run rollback:drill
npm run smoke:quote-bind-issue          # post-rollback smoke
```

## Triggers
Tenant isolation test fail · webhook auth regression · p95 > 2× baseline on critical endpoint · error rate > 1% sustained 5 min · backup posture fail discovered during release · DB migration incompatibility / suspected data corruption.

## Choose smallest safe action
| Recovery | When | How |
|---|---|---|
| App rollback | Data layer trusted | Redeploy last known-good release |
| DB restore | Schema changed / data corrupted | [backup-and-restore.md](./backup-and-restore.md) Postgres path |
| Blob recovery | Document binaries deleted/overwritten/drift | [backup-and-restore.md](./backup-and-restore.md) blob path |

## Procedure
1. Stop rollout; announce incident; record IC + rollback owner; capture deploy timing summary + latest `backup-posture.json` + `backup-restore-validation.json` if relevant.
2. Freeze writes if data correctness in doubt.
3. Redeploy last known-good release tag.
4. If migration / destructive path was in release: restore DB from approved recovery point → validate schema parity, table counts, doc-metadata parity.
5. Pause workers → reconcile queues → resume in controlled order.
6. Smoke: bearer auth · tenant isolation R/W · webhook signature · quote-bind-issue.
7. Probes green → restore traffic.

## Targets (binding)
Release rollback RTO < 10 min · data restore RTO ≤ 4 h · PostgreSQL RPO ≤ 15 min.

## Forbidden
- Skipping the smoke subset.
- Resuming traffic before health/readiness probes are green.
- Leaving workers in an unknown state across the rollback window.
- Restoring data without recording the chosen recovery point.

## Escalation
ADR (post-incident) if: rollback uncovered an invariant the system can't enforce · RTO/RPO missed · undocumented procedure required.

## Links
- Adjacent: [deploy.md](./deploy.md) · [backup-and-restore.md](./backup-and-restore.md) · [backup-policy.md](./backup-policy.md) · [incident-response.md](./incident-response.md)
