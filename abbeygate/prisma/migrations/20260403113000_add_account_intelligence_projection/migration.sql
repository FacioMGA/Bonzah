-- CreateTable
CREATE TABLE "account_intelligence_projection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "secondaryIdentity" TEXT,
    "activePolicies" INTEGER NOT NULL DEFAULT 0,
    "totalPolicies" INTEGER NOT NULL DEFAULT 0,
    "totalPremium" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "openClaimsCount" INTEGER NOT NULL DEFAULT 0,
    "outstandingReserve" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "overdueAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "failedPaymentsCount" INTEGER NOT NULL DEFAULT 0,
    "nextRenewalAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "lastActivityType" TEXT,
    "lastActivitySummary" TEXT,
    "state" TEXT NOT NULL DEFAULT 'HEALTHY',
    "stateReasons" JSONB,
    "stateScore" INTEGER,
    "statePriority" INTEGER NOT NULL DEFAULT 4,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_intelligence_projection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_intelligence_projection_accountId_key" ON "account_intelligence_projection"("accountId");

-- CreateIndex
CREATE INDEX "account_intelligence_projection_state_idx" ON "account_intelligence_projection"("state");

-- CreateIndex
CREATE INDEX "account_intelligence_projection_statePriority_lastActivityAt_accountId_idx" ON "account_intelligence_projection"("statePriority", "lastActivityAt" DESC, "accountId");

-- CreateIndex
CREATE INDEX "account_intelligence_projection_nextRenewalAt_idx" ON "account_intelligence_projection"("nextRenewalAt");

-- CreateIndex
CREATE INDEX "account_intelligence_projection_accountName_idx" ON "account_intelligence_projection"("accountName");
