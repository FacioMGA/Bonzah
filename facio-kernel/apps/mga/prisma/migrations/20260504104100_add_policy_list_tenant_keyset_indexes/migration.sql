-- =====================================================================
-- Performance PR — tenant-aware composite keyset indexes for policy_list_index.
--
-- Purpose
--   Cover the BO `/policies` hot path with tenant-scoped composite indexes
--   matching the default sort (attentionScore DESC, lastActivityAt DESC,
--   policyNumber DESC) plus the keyset tie-break (policyId DESC), and the
--   secondary recent-activity sort.
--
--   Binding contract:
--     docs/architecture/contracts/database-indexes.md
--   Online rollout:
--     backend/platform/db/indexBootstrap.ts (CREATE INDEX CONCURRENTLY)
--
--   Index names are kept in lockstep with `@@index([...], map: ...)`
--   in `prisma/schema.prisma` and the bootstrap's `CREATE INDEX
--   CONCURRENTLY IF NOT EXISTS` so dev/CI/migrate/bootstrap all converge
--   on the same physical objects.
--
-- Idempotency
--   `IF NOT EXISTS` makes this migration safe to re-run on environments
--   where `indexBootstrap.ts` already created the same indexes online.
-- =====================================================================

-- CreateIndex
CREATE INDEX IF NOT EXISTS "policy_list_index_tenant_default_sort_keyset_idx"
  ON "policy_list_index" ("operatingTenantId", "attentionScore" DESC, "lastActivityAt" DESC, "policyNumber" DESC, "policyId" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "policy_list_index_tenant_lastactivity_keyset_idx"
  ON "policy_list_index" ("operatingTenantId", "lastActivityAt" DESC, "policyId" DESC);
