-- Productionize behavior-vector storage.
--
-- These tables already exist in prisma/schema.prisma and are used by the
-- behavior workers. This migration makes migrate deploy authoritative for
-- fresh environments, while staying tolerant of dev databases that were
-- previously advanced with prisma db push.

CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE IF NOT EXISTS "behavior_events" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "behaviorType" TEXT NOT NULL,
    "canonicalText" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "deltaMsFromPreviousEvent" BIGINT,
    "sourceEventId" TEXT NOT NULL,
    "payload" JSONB,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "behavior_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "policy_trajectories" (
    "policyId" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "lastEventAt" TIMESTAMP(3),
    "lastBehaviorTypes" JSONB NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'HEALTHY',
    "driftScore" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "trajectoryEmbedding" vector(1536),
    "trajectoryWindowSize" INTEGER NOT NULL DEFAULT 50,
    "directionWindowSize" INTEGER NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_trajectories_pkey" PRIMARY KEY ("policyId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "behavior_events_sourceEventId_key"
    ON "behavior_events"("sourceEventId");

CREATE INDEX IF NOT EXISTS "behavior_events_operatingTenantId_idx"
    ON "behavior_events"("operatingTenantId");
CREATE INDEX IF NOT EXISTS "behavior_events_entityType_entityId_occurredAt_idx"
    ON "behavior_events"("entityType", "entityId", "occurredAt");

CREATE INDEX IF NOT EXISTS "policy_trajectories_operatingTenantId_idx"
    ON "policy_trajectories"("operatingTenantId");
CREATE INDEX IF NOT EXISTS "policy_trajectories_direction_idx"
    ON "policy_trajectories"("direction");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'behavior_events_operatingTenantId_fkey'
    ) THEN
        ALTER TABLE "behavior_events"
            ADD CONSTRAINT "behavior_events_operatingTenantId_fkey"
            FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'policy_trajectories_operatingTenantId_fkey'
    ) THEN
        ALTER TABLE "policy_trajectories"
            ADD CONSTRAINT "policy_trajectories_operatingTenantId_fkey"
            FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'policy_trajectories_policyId_fkey'
    ) THEN
        ALTER TABLE "policy_trajectories"
            ADD CONSTRAINT "policy_trajectories_policyId_fkey"
            FOREIGN KEY ("policyId") REFERENCES "policies"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "behavior_events" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'behavior_events'
           AND policyname = 'op_tenant_isolation'
    ) THEN
        CREATE POLICY op_tenant_isolation ON "behavior_events"
            USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
    END IF;
END $$;
ALTER TABLE "behavior_events" FORCE ROW LEVEL SECURITY;

ALTER TABLE "policy_trajectories" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'policy_trajectories'
           AND policyname = 'op_tenant_isolation'
    ) THEN
        CREATE POLICY op_tenant_isolation ON "policy_trajectories"
            USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
    END IF;
END $$;
ALTER TABLE "policy_trajectories" FORCE ROW LEVEL SECURITY;
