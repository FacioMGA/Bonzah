---
title: Database migrations
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Database migrations

## Commands
```bash
npm run db:migrate:dev -- --name <change>      # local: create + apply migration
npm run prisma:migrate:deploy                  # local/shared manual verification
npm run db:push:dev                            # disposable local scratch DB only
# AKS deploy: Helm migration Job/hook runs from the promoted immutable image.
```

## Rules
- Real schema changes always go through `db:migrate:dev` (locally) → migration file in `prisma/migrations/` → `prisma:migrate:deploy` (shared/prod).
- Application code MUST be compatible with both pre- and post-migration states for the deploy window.
- Backfills are explicit separate steps, never inside the migration.

## AKS migration path
`aks-deploy.yml` does not connect to Postgres from GitHub. The workflow has a `run_migration` dispatch input (default `true` — migrations are idempotent and a no-op apply is cheap); auto-promoted runs always deploy with `migrate=true`. When enabled, Helm renders the pre-install/pre-upgrade migration Job from the API image for the same SHA. Operators may set it to `false` for an image-only re-promotion that must not touch the schema. Existing non-empty DB baselines and corrective migration history changes are separate operator procedures and must not be hidden in the deploy workflow.

## Forbidden
- `prisma db push` against production.
- `db push --accept-data-loss` anywhere except disposable local scratch.
- Shelling into AKS to run ad-hoc Prisma commands. Use a reviewed Job/runbook.
- Adding runner-side Prisma or Postgres firewall steps to `aks-deploy.yml`.
- Schema change in `prisma/schema.prisma` without a corresponding migration file (CI: `check-prisma-schema-change-requires-migration.mjs`).
- Routine use of the baseline path. It is one-time alignment only.

## Links
- Index strategy: [../architecture/contracts/database-indexes.md](../architecture/contracts/database-indexes.md)
- Adjacent: [backup-and-restore.md](./backup-and-restore.md) · [deploy.md](./deploy.md)
