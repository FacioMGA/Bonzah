-- CreateTable: product_definitions
CREATE TABLE "product_definitions" (
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "icon" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_definitions_pkey" PRIMARY KEY ("code")
);

-- Seed MOTOR
INSERT INTO "product_definitions" ("code", "displayName", "icon", "isActive", "updatedAt")
VALUES ('MOTOR', 'Motor Insurance', 'car', true, CURRENT_TIMESTAMP);

-- AddColumn: programs.productType
ALTER TABLE "programs" ADD COLUMN "productType" TEXT;
CREATE INDEX "programs_productType_idx" ON "programs"("productType");
ALTER TABLE "programs" ADD CONSTRAINT "programs_productType_fkey"
    FOREIGN KEY ("productType") REFERENCES "product_definitions"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- Normalize AUTO_INSURANCE -> MOTOR
UPDATE "policies" SET "productType" = 'MOTOR' WHERE "productType" = 'AUTO_INSURANCE';
UPDATE "reco_events" SET "productType" = 'MOTOR' WHERE "productType" = 'AUTO_INSURANCE';
UPDATE "reco_bandit_arms" SET "productType" = 'MOTOR' WHERE "productType" = 'AUTO_INSURANCE';

-- Make productType nullable (unassigned policies)
ALTER TABLE "policies" ALTER COLUMN "productType" DROP DEFAULT;
ALTER TABLE "policies" ALTER COLUMN "productType" DROP NOT NULL;

-- Set productType on existing programs
UPDATE "programs" SET "productType" = 'MOTOR' WHERE "productType" IS NULL;
