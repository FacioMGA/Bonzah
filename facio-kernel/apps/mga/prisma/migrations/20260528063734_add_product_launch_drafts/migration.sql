-- ADR-0037 — Add product_launch_drafts staging table for Config MCP V1.
--
-- Workflow object only — NOT a canonical configuration source. Drafts stage
-- natural-language-driven configuration changes from the Config MCP Product
-- Architect agent. On publish, `publishToSandbox` translates the `delta`
-- JSONB into writes against canonical rows (Program.metadata,
-- BinderProductAuthority, BinderFinancials, Tenant.adminFee). After publish
-- the draft becomes evidence-only; no runtime consumer reads it.
--
-- Single owner: `backend/modules/configuration/`. Enforced by
-- `tools/quality/check-product-launch-draft-isolation.mjs`.

CREATE TABLE "product_launch_drafts" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseTemplateId" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "delta" JSONB NOT NULL,
    "publishedProgramId" TEXT,
    "publishedBinderId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_launch_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_launch_drafts_operatingTenantId_status_idx"
    ON "product_launch_drafts"("operatingTenantId", "status");
CREATE INDEX "product_launch_drafts_operatingTenantId_productCode_idx"
    ON "product_launch_drafts"("operatingTenantId", "productCode");

ALTER TABLE "product_launch_drafts"
    ADD CONSTRAINT "product_launch_drafts_operatingTenantId_fkey"
    FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
