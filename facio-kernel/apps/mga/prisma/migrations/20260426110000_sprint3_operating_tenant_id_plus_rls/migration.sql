-- Sprint 3: Add operatingTenantId to 29 core business models + enable RLS on all 38 tenant-scoped tables.
--
-- Strategy (same phased approach as Sprint 2):
--   Phase 1 — Add nullable columns (zero downtime, no locks beyond a brief metadata change)
--   Phase 2 — Backfill to the abbeygate-cy deterministic UUID ('00000000-0000-4000-8000-000000000001')
--   Phase 3 — NOT NULL + FK constraint + index (all in one ALTER per table)
--   Phase 4 — Row-Level Security on all 38 tenant-scoped tables (9 Sprint-2 + 29 Sprint-3)
--
-- RLS policy uses current_setting('app.operating_tenant_id', true) — the `true` arg means a
-- missing GUC returns NULL rather than raising an error, so rows are hidden (not errored) when
-- the GUC is unset.  Migrations run as a superuser and bypass RLS automatically.
-- FORCE ROW LEVEL SECURITY ensures the policy applies to the table owner role as well.

-- =============================================================================
-- Phase 1: Add nullable "operatingTenantId" UUID columns (29 new tables)
-- accounts already received this column in Sprint 2 schema work; use IF NOT EXISTS for safety.
-- =============================================================================

ALTER TABLE accounts                     ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE policies                     ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE risk_transactions            ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE endorsements                 ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE endorsement_instances_mbe    ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE documents                    ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE document_sets                ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE invoices                     ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE payments                     ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE reconciliations              ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE claims                       ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE claim_assignments            ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE claim_events                 ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE claim_reserve_transactions   ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE binders                      ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;

-- Historical baseline databases predate BinderProductAuthority but current
-- schema expects it before tenant/RLS migration. Create the empty authority
-- table here so the tenant-scope migration remains retry-safe.
CREATE TABLE IF NOT EXISTS binder_product_authorities (
  id TEXT NOT NULL,
  "binderId" TEXT NOT NULL,
  "productCode" TEXT NOT NULL,
  "classOfBusiness" TEXT NOT NULL,
  "riskCode" TEXT,
  "territorialScope" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "maxPremiumAnnual" DECIMAL(14,2),
  "maxPolicyPeriodDays" INTEGER,
  "maxAdvanceInceptionDays" INTEGER,
  "authorityClasses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  "effectiveFrom" TIMESTAMP(3),
  "effectiveTo" TIMESTAMP(3),
  notes TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "binder_product_authorities_pkey" PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'binder_product_authorities_binderId_fkey'
  ) THEN
    ALTER TABLE binder_product_authorities
      ADD CONSTRAINT "binder_product_authorities_binderId_fkey"
      FOREIGN KEY ("binderId") REFERENCES binders(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'binder_product_authorities_productCode_fkey'
  ) THEN
    ALTER TABLE binder_product_authorities
      ADD CONSTRAINT "binder_product_authorities_productCode_fkey"
      FOREIGN KEY ("productCode") REFERENCES product_definitions(code) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "binder_product_authorities_binderId_productCode_key" ON binder_product_authorities("binderId", "productCode");
CREATE INDEX IF NOT EXISTS "binder_product_authorities_binderId_idx" ON binder_product_authorities("binderId");
CREATE INDEX IF NOT EXISTS "binder_product_authorities_productCode_idx" ON binder_product_authorities("productCode");
CREATE INDEX IF NOT EXISTS "binder_product_authorities_status_idx" ON binder_product_authorities(status);

ALTER TABLE binder_product_authorities   ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE programs                     ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE program_rating_models        ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE policy_holders               ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE entities                     ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE account_activity_feed        ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE account_alerts_projection    ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE account_intelligence_projection ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE account_summary_projection   ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE account_portfolio_metrics    ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE claim_projection_snapshots   ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE policy_state_current         ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE policy_vectors               ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;
ALTER TABLE policy_quote_history         ADD COLUMN IF NOT EXISTS "operatingTenantId" TEXT;

-- =============================================================================
-- Phase 2: Backfill all rows to the abbeygate-cy deterministic UUID.
-- All existing data pre-dates multi-tenancy and belongs to the Cyprus MGA.
-- =============================================================================

UPDATE accounts                     SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001' WHERE "operatingTenantId" IS NULL;
UPDATE policies                     SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE risk_transactions            SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE endorsements                 SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE endorsement_instances_mbe    SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE documents                    SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE document_sets                SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE invoices                     SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE payments                     SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE reconciliations              SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE claims                       SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE claim_assignments            SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE claim_events                 SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE claim_reserve_transactions   SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE binders                      SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE binder_product_authorities   SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE programs                     SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE program_rating_models        SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE policy_holders               SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE entities                     SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE account_activity_feed        SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE account_alerts_projection    SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE account_intelligence_projection SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE account_summary_projection   SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE account_portfolio_metrics    SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE claim_projection_snapshots   SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE policy_state_current         SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE policy_vectors               SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE policy_quote_history         SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';

-- =============================================================================
-- Phase 3: NOT NULL constraint + FK to tenants + index (one ALTER per table).
-- =============================================================================

-- accounts
ALTER TABLE accounts ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE accounts ADD CONSTRAINT fk_accounts_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_accounts_op_tenant ON accounts("operatingTenantId");

-- policies
ALTER TABLE policies ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE policies ADD CONSTRAINT fk_policies_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_policies_op_tenant ON policies("operatingTenantId");

-- risk_transactions
ALTER TABLE risk_transactions ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE risk_transactions ADD CONSTRAINT fk_risk_transactions_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_risk_transactions_op_tenant ON risk_transactions("operatingTenantId");

-- endorsements
ALTER TABLE endorsements ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE endorsements ADD CONSTRAINT fk_endorsements_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_endorsements_op_tenant ON endorsements("operatingTenantId");

-- endorsement_instances_mbe
ALTER TABLE endorsement_instances_mbe ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE endorsement_instances_mbe ADD CONSTRAINT fk_endorsement_instances_mbe_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_endorsement_instances_mbe_op_tenant ON endorsement_instances_mbe("operatingTenantId");

-- documents
ALTER TABLE documents ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE documents ADD CONSTRAINT fk_documents_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_documents_op_tenant ON documents("operatingTenantId");

-- document_sets
ALTER TABLE document_sets ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE document_sets ADD CONSTRAINT fk_document_sets_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_document_sets_op_tenant ON document_sets("operatingTenantId");

-- invoices
ALTER TABLE invoices ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE invoices ADD CONSTRAINT fk_invoices_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_invoices_op_tenant ON invoices("operatingTenantId");

-- payments
ALTER TABLE payments ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE payments ADD CONSTRAINT fk_payments_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_payments_op_tenant ON payments("operatingTenantId");

-- reconciliations
ALTER TABLE reconciliations ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE reconciliations ADD CONSTRAINT fk_reconciliations_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_reconciliations_op_tenant ON reconciliations("operatingTenantId");

-- claims
ALTER TABLE claims ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE claims ADD CONSTRAINT fk_claims_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_claims_op_tenant ON claims("operatingTenantId");

-- claim_assignments
ALTER TABLE claim_assignments ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE claim_assignments ADD CONSTRAINT fk_claim_assignments_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_claim_assignments_op_tenant ON claim_assignments("operatingTenantId");

-- claim_events
ALTER TABLE claim_events ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE claim_events ADD CONSTRAINT fk_claim_events_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_claim_events_op_tenant ON claim_events("operatingTenantId");

-- claim_reserve_transactions
ALTER TABLE claim_reserve_transactions ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE claim_reserve_transactions ADD CONSTRAINT fk_claim_reserve_transactions_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_claim_reserve_transactions_op_tenant ON claim_reserve_transactions("operatingTenantId");

-- binders
ALTER TABLE binders ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE binders ADD CONSTRAINT fk_binders_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_binders_op_tenant ON binders("operatingTenantId");

-- binder_product_authorities
ALTER TABLE binder_product_authorities ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE binder_product_authorities ADD CONSTRAINT fk_binder_product_authorities_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_binder_product_authorities_op_tenant ON binder_product_authorities("operatingTenantId");

-- programs
ALTER TABLE programs ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE programs ADD CONSTRAINT fk_programs_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_programs_op_tenant ON programs("operatingTenantId");

-- program_rating_models
ALTER TABLE program_rating_models ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE program_rating_models ADD CONSTRAINT fk_program_rating_models_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_program_rating_models_op_tenant ON program_rating_models("operatingTenantId");

-- policy_holders
ALTER TABLE policy_holders ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE policy_holders ADD CONSTRAINT fk_policy_holders_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_policy_holders_op_tenant ON policy_holders("operatingTenantId");

-- entities
ALTER TABLE entities ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE entities ADD CONSTRAINT fk_entities_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_entities_op_tenant ON entities("operatingTenantId");

-- account_activity_feed
ALTER TABLE account_activity_feed ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE account_activity_feed ADD CONSTRAINT fk_account_activity_feed_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_account_activity_feed_op_tenant ON account_activity_feed("operatingTenantId");

-- account_alerts_projection
ALTER TABLE account_alerts_projection ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE account_alerts_projection ADD CONSTRAINT fk_account_alerts_projection_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_account_alerts_projection_op_tenant ON account_alerts_projection("operatingTenantId");

-- account_intelligence_projection
ALTER TABLE account_intelligence_projection ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE account_intelligence_projection ADD CONSTRAINT fk_account_intelligence_projection_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_account_intelligence_projection_op_tenant ON account_intelligence_projection("operatingTenantId");

-- account_summary_projection
ALTER TABLE account_summary_projection ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE account_summary_projection ADD CONSTRAINT fk_account_summary_projection_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_account_summary_projection_op_tenant ON account_summary_projection("operatingTenantId");

-- account_portfolio_metrics
ALTER TABLE account_portfolio_metrics ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE account_portfolio_metrics ADD CONSTRAINT fk_account_portfolio_metrics_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_account_portfolio_metrics_op_tenant ON account_portfolio_metrics("operatingTenantId");

-- claim_projection_snapshots
ALTER TABLE claim_projection_snapshots ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE claim_projection_snapshots ADD CONSTRAINT fk_claim_projection_snapshots_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_claim_projection_snapshots_op_tenant ON claim_projection_snapshots("operatingTenantId");

-- policy_state_current
ALTER TABLE policy_state_current ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE policy_state_current ADD CONSTRAINT fk_policy_state_current_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_policy_state_current_op_tenant ON policy_state_current("operatingTenantId");

-- policy_vectors
ALTER TABLE policy_vectors ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE policy_vectors ADD CONSTRAINT fk_policy_vectors_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_policy_vectors_op_tenant ON policy_vectors("operatingTenantId");

-- policy_quote_history
ALTER TABLE policy_quote_history ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE policy_quote_history ADD CONSTRAINT fk_policy_quote_history_op_tenant
    FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id);
CREATE INDEX idx_policy_quote_history_op_tenant ON policy_quote_history("operatingTenantId");

-- =============================================================================
-- Phase 4: Row-Level Security — all 38 tenant-scoped tables.
--
-- Policy: "operatingTenantId" must equal the GUC app.operating_tenant_id.
-- The GUC is set per-query by the tenantScopedPrisma extension via set_config().
-- FORCE RLS: the policy applies to the table owner role (bypassed otherwise).
-- Superuser connections (migrations, seed, pg_dump) bypass RLS unconditionally.
-- =============================================================================

-- --- Sprint 2 tables (9) ---

ALTER TABLE audit_actions             ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON audit_actions
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE audit_actions             FORCE ROW LEVEL SECURITY;

ALTER TABLE outbox                    ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON outbox
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE outbox                    FORCE ROW LEVEL SECURITY;

ALTER TABLE reco_events               ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON reco_events
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE reco_events               FORCE ROW LEVEL SECURITY;

ALTER TABLE reco_bandit_arms          ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON reco_bandit_arms
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE reco_bandit_arms          FORCE ROW LEVEL SECURITY;

ALTER TABLE sanction_screening_runs   ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON sanction_screening_runs
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE sanction_screening_runs   FORCE ROW LEVEL SECURITY;

ALTER TABLE policy_search_index       ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON policy_search_index
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE policy_search_index       FORCE ROW LEVEL SECURITY;

ALTER TABLE policy_list_index         ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON policy_list_index
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE policy_list_index         FORCE ROW LEVEL SECURITY;

ALTER TABLE api_keys                  ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON api_keys
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE api_keys                  FORCE ROW LEVEL SECURITY;

ALTER TABLE webhook_endpoints         ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON webhook_endpoints
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE webhook_endpoints         FORCE ROW LEVEL SECURITY;

-- --- Sprint 3 tables (29) ---

ALTER TABLE accounts                  ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON accounts
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE accounts                  FORCE ROW LEVEL SECURITY;

ALTER TABLE policies                  ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON policies
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE policies                  FORCE ROW LEVEL SECURITY;

ALTER TABLE risk_transactions         ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON risk_transactions
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE risk_transactions         FORCE ROW LEVEL SECURITY;

ALTER TABLE endorsements              ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON endorsements
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE endorsements              FORCE ROW LEVEL SECURITY;

ALTER TABLE endorsement_instances_mbe ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON endorsement_instances_mbe
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE endorsement_instances_mbe FORCE ROW LEVEL SECURITY;

ALTER TABLE documents                 ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON documents
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE documents                 FORCE ROW LEVEL SECURITY;

ALTER TABLE document_sets             ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON document_sets
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE document_sets             FORCE ROW LEVEL SECURITY;

ALTER TABLE invoices                  ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON invoices
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE invoices                  FORCE ROW LEVEL SECURITY;

ALTER TABLE payments                  ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON payments
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE payments                  FORCE ROW LEVEL SECURITY;

ALTER TABLE reconciliations           ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON reconciliations
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE reconciliations           FORCE ROW LEVEL SECURITY;

ALTER TABLE claims                    ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON claims
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE claims                    FORCE ROW LEVEL SECURITY;

ALTER TABLE claim_assignments         ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON claim_assignments
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE claim_assignments         FORCE ROW LEVEL SECURITY;

ALTER TABLE claim_events              ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON claim_events
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE claim_events              FORCE ROW LEVEL SECURITY;

ALTER TABLE claim_reserve_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON claim_reserve_transactions
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE claim_reserve_transactions FORCE ROW LEVEL SECURITY;

ALTER TABLE binders                   ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON binders
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE binders                   FORCE ROW LEVEL SECURITY;

ALTER TABLE binder_product_authorities ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON binder_product_authorities
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE binder_product_authorities FORCE ROW LEVEL SECURITY;

ALTER TABLE programs                  ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON programs
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE programs                  FORCE ROW LEVEL SECURITY;

ALTER TABLE program_rating_models     ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON program_rating_models
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE program_rating_models     FORCE ROW LEVEL SECURITY;

ALTER TABLE policy_holders            ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON policy_holders
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE policy_holders            FORCE ROW LEVEL SECURITY;

ALTER TABLE entities                  ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON entities
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE entities                  FORCE ROW LEVEL SECURITY;

ALTER TABLE account_activity_feed     ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON account_activity_feed
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE account_activity_feed     FORCE ROW LEVEL SECURITY;

ALTER TABLE account_alerts_projection ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON account_alerts_projection
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE account_alerts_projection FORCE ROW LEVEL SECURITY;

ALTER TABLE account_intelligence_projection ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON account_intelligence_projection
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE account_intelligence_projection FORCE ROW LEVEL SECURITY;

ALTER TABLE account_summary_projection ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON account_summary_projection
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE account_summary_projection FORCE ROW LEVEL SECURITY;

ALTER TABLE account_portfolio_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON account_portfolio_metrics
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE account_portfolio_metrics FORCE ROW LEVEL SECURITY;

ALTER TABLE claim_projection_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON claim_projection_snapshots
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE claim_projection_snapshots FORCE ROW LEVEL SECURITY;

ALTER TABLE policy_state_current      ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON policy_state_current
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE policy_state_current      FORCE ROW LEVEL SECURITY;

ALTER TABLE policy_vectors            ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON policy_vectors
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE policy_vectors            FORCE ROW LEVEL SECURITY;

ALTER TABLE policy_quote_history      ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON policy_quote_history
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE policy_quote_history      FORCE ROW LEVEL SECURITY;
