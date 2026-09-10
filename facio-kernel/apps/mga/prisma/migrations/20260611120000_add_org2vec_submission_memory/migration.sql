-- ADR-0044 — Org2Vec demo: submission memory projection + ingestion event log.
--
-- submission_memory_projections mirrors claim_memory_projections but is
-- anchored to a Policy id (the underwriting submission). org2vec_ingestion_events
-- is a durable audit log of every ingested email + the business object it
-- resolved to. Both follow the tenant-scoped + RLS posture (ADR-0019).

CREATE TABLE "submission_memory_projections" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "summary" TEXT,
    "summaryCitations" JSONB,
    "memoryObject" JSONB NOT NULL,
    "similarSubmissions" JSONB NOT NULL DEFAULT '[]',
    "graphSignals" JSONB NOT NULL DEFAULT '{}',
    "lastRefreshedAt" TIMESTAMP(3),
    "refreshStatus" TEXT NOT NULL DEFAULT 'pending',
    "refreshError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submission_memory_projections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "submission_memory_projections_submissionId_key"
    ON "submission_memory_projections"("submissionId");
CREATE INDEX "submission_memory_projections_operatingTenantId_idx"
    ON "submission_memory_projections"("operatingTenantId");
CREATE INDEX "submission_memory_projections_operatingTenantId_refreshStatus_idx"
    ON "submission_memory_projections"("operatingTenantId", "refreshStatus");
CREATE INDEX "submission_memory_projections_lastRefreshedAt_idx"
    ON "submission_memory_projections"("lastRefreshedAt");

ALTER TABLE "submission_memory_projections"
    ADD CONSTRAINT "submission_memory_projections_operatingTenantId_fkey"
    FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "submission_memory_projections"
    ADD CONSTRAINT "submission_memory_projections_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "policies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE submission_memory_projections ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON submission_memory_projections
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE submission_memory_projections FORCE ROW LEVEL SECURITY;

CREATE TABLE "org2vec_ingestion_events" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "threadId" TEXT,
    "conversationId" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSED',
    "matchedBy" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org2vec_ingestion_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "org2vec_ingestion_events_operatingTenantId_idx"
    ON "org2vec_ingestion_events"("operatingTenantId");
CREATE INDEX "org2vec_ingestion_events_operatingTenantId_scopeType_scopeId_idx"
    ON "org2vec_ingestion_events"("operatingTenantId", "scopeType", "scopeId");
CREATE INDEX "org2vec_ingestion_events_createdAt_idx"
    ON "org2vec_ingestion_events"("createdAt");

ALTER TABLE "org2vec_ingestion_events"
    ADD CONSTRAINT "org2vec_ingestion_events_operatingTenantId_fkey"
    FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE org2vec_ingestion_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON org2vec_ingestion_events
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE org2vec_ingestion_events FORCE ROW LEVEL SECURITY;
