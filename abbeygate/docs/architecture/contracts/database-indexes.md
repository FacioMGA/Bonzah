---
title: Database index strategy contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Database index strategy — binding contract

## Governs
How indexes are added and maintained in PostgreSQL.

## Allowed
- Two index management mechanisms only:
  1. **Prisma schema** (`prisma/schema.prisma`) via `@@index`, `@@unique`, `@id` — applied by `prisma db push` / `prisma migrate deploy`.
  2. **Runtime bootstrap** (`backend/platform/db/indexBootstrap.ts`) for query patterns that emerge from production usage. Uses `$executeRawUnsafe` for DDL.
- Hot-table coverage required for: `Policy` (status, accountId, createdAt), `Claim` (policyId, status), `PolicyListIndex` — composite tenant-aware keyset paths covering the default BO list sort and the keyset tie-break: `(operatingTenantId, attentionScore desc, lastActivityAt desc, policyNumber desc, policyId desc)` and `(operatingTenantId, lastActivityAt desc, policyId desc)`. `PolicySearchIndex` carries `(operatingTenantId)` only — its legacy non-motor fields (including `productType`) were removed, so the former per-field coverage list no longer applies.
- pgvector ANN coverage lives in runtime bootstrap: HNSW cosine indexes on `behavior_events.embedding` and `policy_trajectories.trajectoryEmbedding`. They are allowed there because Prisma cannot express HNSW; production readiness requires `EXPLAIN ANALYZE` verification for the similar-policy query.

## Forbidden
- Partial indexes without justification recorded in this contract.
- Indexes on low-cardinality boolean columns. Use composite indexes.
- Duplicate indexes. Check existing coverage first.
- Adding an index without updating this contract.

## Contract debt (tracked, not yet remediated)
- `PolicyListIndex` carries single-column boolean indexes on `invoiceOverdue`, `cancellationPending`, `hasOpenClaim`, `customerActionRequired`, `uwActionRequired`. These violate the "low-cardinality boolean" rule and must be either justified (composite with `operatingTenantId` + sort, or partial `WHERE flag = true`) or removed via a follow-up ADR.
- `Claim.reportedDate` has no index despite date-range reporting queries. Add it (or a composite with `operatingTenantId`) when slow-query data justifies it.

## Escalation
- **Write an ADR** to: add an index that needs a long lock window in production, introduce a new index management mechanism, adopt a different storage backend for hot tables, resolve the `PolicyListIndex` boolean-index debt above.

## Review cadence
- `EXPLAIN ANALYZE` slow queries surfaced by `PRISMA_QUERY_TIMING=true` / `PRISMA_SLOW_QUERY_MS`.
- Quarterly: `pg_stat_user_indexes` review for `idx_scan = 0`.

## Links
- Coverage amendments ratified by [ADR-0058](../decisions/ADR-0058-freshness-review-contract-amendments.md)
- Related: [performance-budgets.md](./performance-budgets.md) · [tenancy.md](./tenancy.md)
- Operate: [database-migrations.md](../../operate/database-migrations.md)
