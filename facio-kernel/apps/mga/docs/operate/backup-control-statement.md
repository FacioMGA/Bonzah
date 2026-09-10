---
title: Backup control statement
audience: operator
status: reference
owner: platform-eng
reviewed: 2026-05-04
binding: false
supersedes:
  - docs/engineering/backup-control-statement.md
---

# Backup control statement

For customer security questionnaires and operational due diligence. The binding policy is [backup-policy.md](./backup-policy.md); this is the public-facing summary.

## Scope
Abbeygate production on AKS treats Kubernetes as a stateless application layer. Durable data is protected in external managed services: PostgreSQL (business records), Azure Blob Storage (document binaries), Azure Key Vault (runtime secrets), Redis (queue/cache under explicitly declared recovery mode).

## Production standard
| System | Protection | Frequency |
|---|---|---|
| PostgreSQL | Azure-managed backups with PITR + periodic logical export (`pg_dump -Fc`) for restore validation | Continuous; restore validation ≥ every 30 d and before material migrations |
| Azure Blob Storage | Versioning + soft delete + container-delete retention | Continuous service-level |
| Azure Key Vault | Service-managed secret versioning + soft delete + purge protection | Continuous service-level |
| Redis | Disposable by default; persistent only with declared evidence | Per-environment policy |
| AKS app layer | Declarative rebuild from Git / Helm; immutable container images | N/A (stateless) |

## Restore assurance
- Automated backup posture validation (`tools/quality/aks/check-backup-posture.mjs`).
- DB restore validation: schema parity, critical table counts, document metadata parity (`tools/quality/aks/backup-restore-validate.mjs`).
- Rollback drill reporting (`tools/quality/aks/rollback-drill.mjs`).
- Documented Postgres + blob recovery runbooks ([backup-and-restore.md](./backup-and-restore.md)).

## Evidence retained
`backup-posture.json` · `backup-restore-validation.json` · `rollback-drill.json` · go/no-go evidence packet. Stored as CI artefacts for auditability — these are evidence artefacts only; primary production backup lives in the Azure managed services above.

## Qualification
Reflects repository-backed production control standard. Live Azure resources must be configured to satisfy that standard; compliance is evidenced by the generated backup posture and restore validation reports.

## Links
- Binding policy: [backup-policy.md](./backup-policy.md)
- Procedures: [backup-and-restore.md](./backup-and-restore.md) · [rollback.md](./rollback.md)
