-- Durable BDX import job workflow: dry-run/commit status, row logs, and final results.

CREATE TABLE "bdx_import_jobs" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "tenantHost" TEXT NOT NULL,
    "productLine" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "dryRunJobId" TEXT,
    "sourceFileHash" TEXT NOT NULL,
    "sourceFilePath" TEXT NOT NULL,
    "createdBy" TEXT,
    "currentStep" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "summaryJson" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bdx_import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bdx_import_job_logs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL,
    "sourceSheetName" TEXT,
    "sourceMonth" TEXT,
    "rowNumber" INTEGER,
    "policyRef" TEXT,
    "termKey" TEXT,
    "facioPolicyId" TEXT,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detailsJson" JSONB,

    CONSTRAINT "bdx_import_job_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bdx_import_job_results" (
    "jobId" TEXT NOT NULL,
    "summaryJson" JSONB NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bdx_import_job_results_pkey" PRIMARY KEY ("jobId")
);

CREATE INDEX "bdx_import_jobs_operatingTenantId_idx" ON "bdx_import_jobs"("operatingTenantId");
CREATE INDEX "bdx_import_jobs_status_idx" ON "bdx_import_jobs"("status");
CREATE INDEX "bdx_import_jobs_dryRunJobId_idx" ON "bdx_import_jobs"("dryRunJobId");
CREATE INDEX "bdx_import_jobs_sourceFileHash_idx" ON "bdx_import_jobs"("sourceFileHash");
CREATE INDEX "bdx_import_jobs_operatingTenantId_sourceFileHash_idx" ON "bdx_import_jobs"("operatingTenantId", "sourceFileHash");
CREATE INDEX "bdx_import_job_logs_jobId_timestamp_idx" ON "bdx_import_job_logs"("jobId", "timestamp");
CREATE INDEX "bdx_import_job_logs_level_idx" ON "bdx_import_job_logs"("level");
CREATE INDEX "bdx_import_job_logs_code_idx" ON "bdx_import_job_logs"("code");

ALTER TABLE "bdx_import_jobs"
    ADD CONSTRAINT "bdx_import_jobs_operatingTenantId_fkey"
    FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bdx_import_jobs"
    ADD CONSTRAINT "bdx_import_jobs_dryRunJobId_fkey"
    FOREIGN KEY ("dryRunJobId") REFERENCES "bdx_import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bdx_import_job_logs"
    ADD CONSTRAINT "bdx_import_job_logs_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "bdx_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bdx_import_job_results"
    ADD CONSTRAINT "bdx_import_job_results_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "bdx_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
