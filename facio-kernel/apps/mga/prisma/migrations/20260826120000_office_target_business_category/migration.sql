ALTER TABLE "office_staff_targets"
    ADD COLUMN "businessCategory" TEXT;

CREATE INDEX "office_staff_targets_operatingTenantId_scope_businessCategory_idx"
    ON "office_staff_targets"("operatingTenantId", "scope", "businessCategory");
