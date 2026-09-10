-- Peter Sheppard BO transition baseline: targets + staff attribution.
-- Tenant-scoped tables with RLS; no policy lifecycle fields are added.

CREATE TABLE "office_staff_targets" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "userId" TEXT,
    "productCode" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "premiumTarget" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "policyCountTarget" INTEGER NOT NULL DEFAULT 0,
    "conversionTarget" DECIMAL(5,4),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "office_staff_targets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "office_staff_targets_operatingTenantId_periodStart_periodEnd_idx"
    ON "office_staff_targets"("operatingTenantId", "periodStart", "periodEnd");
CREATE INDEX "office_staff_targets_operatingTenantId_scope_userId_idx"
    ON "office_staff_targets"("operatingTenantId", "scope", "userId");

ALTER TABLE "office_staff_targets"
    ADD CONSTRAINT "office_staff_targets_operatingTenantId_fkey"
    FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE office_staff_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON office_staff_targets
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE office_staff_targets FORCE ROW LEVEL SECURITY;

CREATE TABLE "policy_assignments" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "assignedToUserId" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "policy_assignments_policyId_key"
    ON "policy_assignments"("policyId");
CREATE INDEX "policy_assignments_operatingTenantId_assignedToUserId_status_idx"
    ON "policy_assignments"("operatingTenantId", "assignedToUserId", "status");
CREATE INDEX "policy_assignments_operatingTenantId_assignedAt_idx"
    ON "policy_assignments"("operatingTenantId", "assignedAt");

ALTER TABLE "policy_assignments"
    ADD CONSTRAINT "policy_assignments_operatingTenantId_fkey"
    FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "policy_assignments"
    ADD CONSTRAINT "policy_assignments_policyId_fkey"
    FOREIGN KEY ("policyId") REFERENCES "policies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE policy_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON policy_assignments
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE policy_assignments FORCE ROW LEVEL SECURITY;
