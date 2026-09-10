-- Sprint 2: add operatingTenantId FK to low-risk operational tables.
--
-- Strategy (safe for live databases):
--   1. Add column as nullable (no lock on existing rows).
--   2. Backfill all existing rows to abbeygate-cy (deterministic UUID from Sprint 1 seed).
--   3. Set NOT NULL after backfill.
--   4. Add FK constraint to tenants table.
--   5. Drop old tenantId @default("default") columns from 3 models that had them.
--   6. Drop/add indexes to match new schema.
--
-- Backfill target: '00000000-0000-4000-8000-000000000001' (abbeygate-cy Tenant.id)
-- All pre-Sprint-2 data belongs to the Cyprus coverholder by definition.

-- Ensure deterministic operating tenants exist before FK backfills.
-- Some live databases had the tenants table migration applied before seed data
-- was present, so this migration must be self-contained.
INSERT INTO tenants (
  id,
  "tenantSlug",
  kind,
  status,
  "countryCode",
  country,
  currency,
  ipt,
  "adminFee",
  "legalPack",
  "publicBaseUrl",
  "fromEmail",
  "brandLogos",
  "priorityCountries",
  "allowedRiskCountries",
  "defaultNationality",
  "defaultDriversLicenseCountry",
  "defaultBrokerName",
  "createdAt",
  "updatedAt"
) VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    'abbeygate-cy',
    'PRODUCTION',
    'ACTIVE',
    'CY',
    'Cyprus',
    'EUR',
    '{"flatFee":2}'::jsonb,
    18,
    'cy',
    'https://abbeygate-cy.facio.io',
    'no-reply@facio.io',
    NULL,
    ARRAY['CY']::TEXT[],
    ARRAY['CY','ES','PT','GR']::TEXT[],
    'Cypriot',
    'Cyprus',
    'Abbeygate Cyprus',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'abbeygate-pt',
    'PRODUCTION',
    'ACTIVE',
    'PT',
    'Portugal',
    'EUR',
    '{"rate":0.09}'::jsonb,
    18,
    'pt',
    'https://abbeygate-pt.facio.io',
    'no-reply@facio.io',
    NULL,
    ARRAY['PT']::TEXT[],
    ARRAY['PT','CY','ES','GR']::TEXT[],
    'Portuguese',
    'Portugal',
    'Abbeygate Portugal',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    'abbeygate-gr',
    'PRODUCTION',
    'ACTIVE',
    'GR',
    'Greece',
    'EUR',
    '{"rate":0.15}'::jsonb,
    18,
    'gr',
    'https://abbeygate-gr.facio.io',
    'no-reply@facio.io',
    NULL,
    ARRAY['GR']::TEXT[],
    ARRAY['GR','CY','ES','PT']::TEXT[],
    'Greek',
    'Greece',
    'Abbeygate Greece',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000004',
    'abbeygate-es',
    'PRODUCTION',
    'ACTIVE',
    'ES',
    'Spain',
    'EUR',
    '{"rate":0.0815}'::jsonb,
    18,
    'es',
    'https://abbeygate-es.facio.io',
    'no-reply@facio.io',
    NULL,
    ARRAY['ES']::TEXT[],
    ARRAY['ES','CY','PT','GR']::TEXT[],
    'Spanish',
    'Spain',
    'Abbeygate Spain',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("tenantSlug") DO UPDATE SET
  id = EXCLUDED.id,
  kind = EXCLUDED.kind,
  status = EXCLUDED.status,
  "countryCode" = EXCLUDED."countryCode",
  country = EXCLUDED.country,
  currency = EXCLUDED.currency,
  ipt = EXCLUDED.ipt,
  "adminFee" = EXCLUDED."adminFee",
  "legalPack" = EXCLUDED."legalPack",
  "publicBaseUrl" = EXCLUDED."publicBaseUrl",
  "fromEmail" = EXCLUDED."fromEmail",
  "priorityCountries" = EXCLUDED."priorityCountries",
  "allowedRiskCountries" = EXCLUDED."allowedRiskCountries",
  "defaultNationality" = EXCLUDED."defaultNationality",
  "defaultDriversLicenseCountry" = EXCLUDED."defaultDriversLicenseCountry",
  "defaultBrokerName" = EXCLUDED."defaultBrokerName",
  "updatedAt" = CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------------
-- 1. Add operatingTenantId (nullable) to all 9 tables
-- ---------------------------------------------------------------------------

ALTER TABLE reco_events           ADD COLUMN "operatingTenantId" TEXT;
ALTER TABLE reco_bandit_arms      ADD COLUMN "operatingTenantId" TEXT;
ALTER TABLE sanction_screening_runs ADD COLUMN "operatingTenantId" TEXT;
ALTER TABLE policy_search_index   ADD COLUMN "operatingTenantId" TEXT;
ALTER TABLE policy_list_index     ADD COLUMN "operatingTenantId" TEXT;
ALTER TABLE outbox                ADD COLUMN "operatingTenantId" TEXT;
ALTER TABLE audit_actions         ADD COLUMN "operatingTenantId" TEXT;
ALTER TABLE api_keys              ADD COLUMN "operatingTenantId" TEXT;
ALTER TABLE webhook_endpoints     ADD COLUMN "operatingTenantId" TEXT;

-- ---------------------------------------------------------------------------
-- 2. Backfill all existing rows to abbeygate-cy
-- ---------------------------------------------------------------------------

UPDATE reco_events             SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE reco_bandit_arms        SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE sanction_screening_runs SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE policy_search_index     SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE policy_list_index       SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE outbox                  SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE audit_actions           SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE api_keys                SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';
UPDATE webhook_endpoints       SET "operatingTenantId" = '00000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- 3. Set NOT NULL after backfill
-- ---------------------------------------------------------------------------

ALTER TABLE reco_events             ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE reco_bandit_arms        ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE sanction_screening_runs ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE policy_search_index     ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE policy_list_index       ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE outbox                  ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE audit_actions           ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE api_keys                ALTER COLUMN "operatingTenantId" SET NOT NULL;
ALTER TABLE webhook_endpoints       ALTER COLUMN "operatingTenantId" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Add FK constraints → tenants.id
-- ---------------------------------------------------------------------------

ALTER TABLE reco_events
  ADD CONSTRAINT "reco_events_operatingTenantId_fkey"
  FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE reco_bandit_arms
  ADD CONSTRAINT "reco_bandit_arms_operatingTenantId_fkey"
  FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE sanction_screening_runs
  ADD CONSTRAINT "sanction_screening_runs_operatingTenantId_fkey"
  FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE policy_search_index
  ADD CONSTRAINT "policy_search_index_operatingTenantId_fkey"
  FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE policy_list_index
  ADD CONSTRAINT "policy_list_index_operatingTenantId_fkey"
  FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE outbox
  ADD CONSTRAINT "outbox_operatingTenantId_fkey"
  FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE audit_actions
  ADD CONSTRAINT "audit_actions_operatingTenantId_fkey"
  FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE api_keys
  ADD CONSTRAINT "api_keys_operatingTenantId_fkey"
  FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE webhook_endpoints
  ADD CONSTRAINT "webhook_endpoints_operatingTenantId_fkey"
  FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Drop old tenantId @default("default") columns from 3 legacy models
-- ---------------------------------------------------------------------------

-- reco_events: had tenantId String @default("default")
ALTER TABLE reco_events DROP COLUMN IF EXISTS "tenantId";

-- reco_bandit_arms: had tenantId String @default("default") + @@unique
DROP INDEX IF EXISTS "reco_bandit_arms_tenantId_productType_bundleId_key";
ALTER TABLE reco_bandit_arms DROP COLUMN IF EXISTS "tenantId";

-- sanction_screening_runs: had tenantId String @default("default")
ALTER TABLE sanction_screening_runs DROP COLUMN IF EXISTS "tenantId";

-- ---------------------------------------------------------------------------
-- 6. Indexes on new column
-- ---------------------------------------------------------------------------

CREATE INDEX "reco_events_operatingTenantId_idx"             ON reco_events("operatingTenantId");
CREATE INDEX "reco_bandit_arms_operatingTenantId_productType_idx" ON reco_bandit_arms("operatingTenantId", "productType");
CREATE UNIQUE INDEX "reco_bandit_arms_operatingTenantId_productType_bundleId_key" ON reco_bandit_arms("operatingTenantId", "productType", "bundleId");
CREATE INDEX "sanction_screening_runs_operatingTenantId_idx" ON sanction_screening_runs("operatingTenantId");
CREATE INDEX "policy_search_index_operatingTenantId_idx"     ON policy_search_index("operatingTenantId");
CREATE INDEX "policy_list_index_operatingTenantId_idx"       ON policy_list_index("operatingTenantId");
CREATE INDEX "outbox_operatingTenantId_idx"                  ON outbox("operatingTenantId");
CREATE INDEX "audit_actions_operatingTenantId_idx"           ON audit_actions("operatingTenantId");
CREATE INDEX "api_keys_operatingTenantId_idx"                ON api_keys("operatingTenantId");
CREATE INDEX "webhook_endpoints_operatingTenantId_idx"       ON webhook_endpoints("operatingTenantId");
