-- ADR-0101: complete versioned programme configuration and explicit
-- binder-product-authority mapping. Runtime migration is intentionally
-- separate from component extraction; no old setting is silently copied or
-- used as a fallback.

CREATE TABLE "program_definition_versions" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "pricingMode" TEXT NOT NULL,
    "programRatingModelId" TEXT,
    "underwriting" JSONB NOT NULL,
    "coverage" JSONB NOT NULL,
    "questionnaire" JSONB NOT NULL,
    "workflow" JSONB NOT NULL,
    "channels" JSONB NOT NULL,
    "documents" JSONB NOT NULL,
    "source" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "program_definition_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_definition_versions_programId_version_key"
    ON "program_definition_versions"("programId", "version");
CREATE INDEX "program_definition_versions_operatingTenantId_idx"
    ON "program_definition_versions"("operatingTenantId");
CREATE INDEX "program_definition_versions_programId_status_idx"
    ON "program_definition_versions"("programId", "status");

ALTER TABLE "program_definition_versions"
    ADD CONSTRAINT "program_definition_versions_operatingTenantId_fkey"
    FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "program_definition_versions_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "program_definition_versions_programRatingModelId_fkey"
    FOREIGN KEY ("programRatingModelId") REFERENCES "program_rating_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "program_definition_versions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON "program_definition_versions"
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE "program_definition_versions" FORCE ROW LEVEL SECURITY;

CREATE TABLE "binder_product_authority_program_definitions" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "binderProductAuthorityId" TEXT NOT NULL,
    "programDefinitionVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "binder_product_authority_program_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "binder_product_authority_program_definitions_binderProductAuthorityId_key"
    ON "binder_product_authority_program_definitions"("binderProductAuthorityId");
CREATE INDEX "binder_product_authority_program_definitions_operatingTenantId_idx"
    ON "binder_product_authority_program_definitions"("operatingTenantId");
CREATE INDEX "binder_product_authority_program_definitions_programDefinitionVersionId_idx"
    ON "binder_product_authority_program_definitions"("programDefinitionVersionId");

ALTER TABLE "binder_product_authority_program_definitions"
    ADD CONSTRAINT "binder_product_authority_program_definitions_binderProductAuthorityId_fkey"
    FOREIGN KEY ("binderProductAuthorityId") REFERENCES "binder_product_authorities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "binder_product_authority_program_definitions_operatingTenantId_fkey"
    FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "binder_product_authority_program_definitions_programDefinitionVersionId_fkey"
    FOREIGN KEY ("programDefinitionVersionId") REFERENCES "program_definition_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "binder_product_authority_program_definitions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON "binder_product_authority_program_definitions"
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE "binder_product_authority_program_definitions" FORCE ROW LEVEL SECURITY;
