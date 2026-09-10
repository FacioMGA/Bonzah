-- ADR-0041 — Claim Memory projection (cached, async-refreshed).
--
-- One row per claim. Written ONLY by `backend/workers/handlers/CLAIM_MEMORY.REFRESH.ts`
-- via `refreshClaimMemoryUseCase`. Read by Claim Workspace co-pilot and V1 operator
-- MCP tools (`operator.get_claim_memory`, `operator.find_similar_claims`,
-- `operator.analyze_claim_memory`, `operator.refresh_claim_memory`).
--
-- Critical-path safe: if Neo4j or the LLM is down, the refresh worker writes
-- `refreshStatus='failed'` (with `refreshError`) and keeps the previous row.
-- The UI degrades to a stale banner; no claim lifecycle action is blocked.
--
-- Sole writer enforced by `tools/quality/check-operator-mcp-no-direct-db-writes.mjs`
-- + the Week-1 module-isolation guards added in ADR-0041 §7.

CREATE TABLE "claim_memory_projections" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "summary" TEXT,
    "summaryCitations" JSONB,
    "memoryObject" JSONB NOT NULL,
    "similarClaims" JSONB NOT NULL DEFAULT '[]',
    "graphSignals" JSONB NOT NULL DEFAULT '{}',
    "lastRefreshedAt" TIMESTAMP(3),
    "refreshStatus" TEXT NOT NULL DEFAULT 'pending',
    "refreshError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claim_memory_projections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "claim_memory_projections_claimId_key"
    ON "claim_memory_projections"("claimId");
CREATE INDEX "claim_memory_projections_operatingTenantId_idx"
    ON "claim_memory_projections"("operatingTenantId");
CREATE INDEX "claim_memory_projections_operatingTenantId_refreshStatus_idx"
    ON "claim_memory_projections"("operatingTenantId", "refreshStatus");
CREATE INDEX "claim_memory_projections_lastRefreshedAt_idx"
    ON "claim_memory_projections"("lastRefreshedAt");

ALTER TABLE "claim_memory_projections"
    ADD CONSTRAINT "claim_memory_projections_operatingTenantId_fkey"
    FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "claim_memory_projections"
    ADD CONSTRAINT "claim_memory_projections_claimId_fkey"
    FOREIGN KEY ("claimId") REFERENCES "claims"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS — mirrors the `claim_projection_snapshots` posture (ADR-0009 / ADR-0019).
-- The Prisma tenant extension (`backend/platform/db/tenantExtension.ts`) sets
-- `app.operating_tenant_id` via `set_config(..., true)` per query; this policy
-- keeps Postgres + Prisma in lock-step.
ALTER TABLE claim_memory_projections ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON claim_memory_projections
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE claim_memory_projections FORCE ROW LEVEL SECURITY;
