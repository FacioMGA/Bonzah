ALTER TABLE "policies"
ADD COLUMN IF NOT EXISTS "renewalFamilyId" TEXT,
ADD COLUMN IF NOT EXISTS "renewalSequence" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "priorTermPolicyId" TEXT;

UPDATE "policies"
SET "renewalFamilyId" = COALESCE("renewalFamilyId", id::text)
WHERE "renewalFamilyId" IS NULL;

ALTER TABLE "policies"
ALTER COLUMN "renewalFamilyId" SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'policies_policyNumber_key'
  ) THEN
    ALTER TABLE "policies" DROP CONSTRAINT "policies_policyNumber_key";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'policies_priorTermPolicyId_fkey'
  ) THEN
    ALTER TABLE "policies"
      ADD CONSTRAINT "policies_priorTermPolicyId_fkey"
      FOREIGN KEY ("priorTermPolicyId")
      REFERENCES "policies"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "policies_renewalFamilyId_idx" ON "policies"("renewalFamilyId");
CREATE INDEX IF NOT EXISTS "policies_priorTermPolicyId_idx" ON "policies"("priorTermPolicyId");
CREATE INDEX IF NOT EXISTS "policies_renewalFamilyId_renewalSequence_idx" ON "policies"("renewalFamilyId", "renewalSequence");
CREATE UNIQUE INDEX IF NOT EXISTS "policies_policyNumber_renewalSequence_key" ON "policies"("policyNumber", "renewalSequence");
