CREATE TABLE IF NOT EXISTS "claim_counterparties" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "roles" TEXT[] NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "providerType" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claim_counterparties_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "claim_counterparties_claimId_idx" ON "claim_counterparties"("claimId");
CREATE INDEX IF NOT EXISTS "claim_counterparties_claimId_status_idx" ON "claim_counterparties"("claimId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "claim_counterparties_claimId_slug_key" ON "claim_counterparties"("claimId", "slug");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'claim_counterparties_claimId_fkey'
  ) THEN
    ALTER TABLE "claim_counterparties"
    ADD CONSTRAINT "claim_counterparties_claimId_fkey"
    FOREIGN KEY ("claimId") REFERENCES "claims"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
