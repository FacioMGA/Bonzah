-- AlterTable
ALTER TABLE "communication_templates" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "lastDeployedSha" TEXT,
ADD COLUMN     "lastEditor" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "synthetic_email_runs" (
    "id" TEXT NOT NULL,
    "deployedSha" TEXT NOT NULL DEFAULT 'unknown',
    "trigger" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "templateVersion" INTEGER,
    "recipients" JSONB NOT NULL,
    "deliveryIds" JSONB,
    "result" TEXT NOT NULL DEFAULT 'QUEUED',
    "resultDetail" TEXT,
    "cleanupStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "source" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "synthetic_email_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "synthetic_email_runs_createdAt_idx" ON "synthetic_email_runs"("createdAt");

-- CreateIndex
CREATE INDEX "synthetic_email_runs_trigger_idx" ON "synthetic_email_runs"("trigger");
