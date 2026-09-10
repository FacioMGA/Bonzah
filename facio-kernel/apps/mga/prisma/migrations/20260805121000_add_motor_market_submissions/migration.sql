-- Portugal Segurnet/FIVA internal submission tracking.
-- Tenant-scoped tables with RLS; external runtime calls remain spec-gated.

CREATE TABLE "motor_market_submissions" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "policyId" TEXT,
    "claimId" TEXT,
    "riskTransactionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "externalReference" TEXT,
    "correlationId" TEXT,
    "requestPayload" JSONB,
    "latestResponse" JSONB,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "motor_market_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "motor_market_submission_attempts" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "externalReference" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "motor_market_submission_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "motor_market_submissions_operatingTenantId_idempotencyKey_key"
    ON "motor_market_submissions"("operatingTenantId", "idempotencyKey");
CREATE INDEX "motor_market_submissions_operatingTenantId_provider_channel_status_idx"
    ON "motor_market_submissions"("operatingTenantId", "provider", "channel", "status");
CREATE INDEX "motor_market_submissions_operatingTenantId_policyId_idx"
    ON "motor_market_submissions"("operatingTenantId", "policyId");
CREATE INDEX "motor_market_submissions_operatingTenantId_claimId_idx"
    ON "motor_market_submissions"("operatingTenantId", "claimId");
CREATE INDEX "motor_market_submissions_operatingTenantId_nextRetryAt_idx"
    ON "motor_market_submissions"("operatingTenantId", "nextRetryAt");

CREATE UNIQUE INDEX "motor_market_submission_attempts_submissionId_attemptNumber_key"
    ON "motor_market_submission_attempts"("submissionId", "attemptNumber");
CREATE INDEX "motor_market_submission_attempts_operatingTenantId_status_attemptedAt_idx"
    ON "motor_market_submission_attempts"("operatingTenantId", "status", "attemptedAt");
CREATE INDEX "motor_market_submission_attempts_submissionId_idx"
    ON "motor_market_submission_attempts"("submissionId");

ALTER TABLE "motor_market_submissions"
    ADD CONSTRAINT "motor_market_submissions_operatingTenantId_fkey"
    FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "motor_market_submissions"
    ADD CONSTRAINT "motor_market_submissions_policyId_fkey"
    FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "motor_market_submissions"
    ADD CONSTRAINT "motor_market_submissions_claimId_fkey"
    FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "motor_market_submissions"
    ADD CONSTRAINT "motor_market_submissions_riskTransactionId_fkey"
    FOREIGN KEY ("riskTransactionId") REFERENCES "risk_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "motor_market_submission_attempts"
    ADD CONSTRAINT "motor_market_submission_attempts_operatingTenantId_fkey"
    FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "motor_market_submission_attempts"
    ADD CONSTRAINT "motor_market_submission_attempts_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "motor_market_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE motor_market_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON motor_market_submissions
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE motor_market_submissions FORCE ROW LEVEL SECURITY;

ALTER TABLE motor_market_submission_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON motor_market_submission_attempts
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE motor_market_submission_attempts FORCE ROW LEVEL SECURITY;
