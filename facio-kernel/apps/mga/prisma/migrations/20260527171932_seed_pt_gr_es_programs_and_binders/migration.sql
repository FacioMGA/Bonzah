-- ADR-0034 / ABY-294 / ABY-295 / ABY-296 / ABY-297 — seed the production
-- operational rows (Program, Binder, ProgramBinderLink, BinderProductAuthority)
-- for every non-CY operating tenant (PT, GR, ES) on every Lloyd's BAA whose
-- `territorialScope` already authorises that tenant's country.
--
-- Why this migration exists
-- -------------------------
-- ADR-0009 introduced four operating tenants (CY/PT/GR/ES) and seeded their
-- `tenants` rows. ADR-0019 made the per-tenant fail-closed boundary strict.
-- ADR-0032 added HEALTH on top of TRAVEL binders. But every Program / Binder
-- / ProgramBinderLink / BinderProductAuthority row in production was still
-- pinned to `operatingTenantId = TENANT_IDS.CY` (the seed in
-- `backend/seed/binders.ts` hard-codes CY). When a customer hit
-- `abbeygate-pt.facio.io/quote/{home,travel,health}/new` the request resolved
-- to `TENANT_IDS.PT`, the binder lookup in
-- `findLatestActiveBinderLinkForProduct` joined on
-- `program.operatingTenantId = PT.id` AND `binder.operatingTenantId = PT.id`,
-- found zero rows, and the wizard returned 503 "No active binder linked for X
-- in this tenant" — even though the underlying Lloyd's BAA already
-- authorises PT in `territorialScope: ['CY','ES','PT','GR']` (HOME and TRAVEL
-- BAA families). Motor surfaced as the Prisma unique-constraint crash on
-- `policyNumber` instead because motor creates the policy without checking
-- binder authority first — that check is added in the same PR
-- (`backend/products/motor/quotes/quoteSessionOps.ts`).
--
-- What this migration does
-- ------------------------
-- For every (tenant t ∈ {PT, GR, ES}, productCode ∈ {HOME, TRAVEL, MOTOR}):
--   1. Insert the per-tenant `Program` row if one doesn't already exist.
--   2. For every binder whose CY-anchored `BinderProductAuthority` row carries
--      the tenant's country in its `territorialScope`, insert a per-tenant
--      mirror `Binder` row (new id `<sourceBinderId>-<COUNTRY_CODE>`, same
--      umr/agreementNumber/coverholderName/coverholderPin/startDate/endDate
--      as the source row, but `operatingTenantId = <tenant>`).
--   3. Insert the matching `ProgramBinderLink` row.
--   4. Insert the matching `BinderProductAuthority` row (same productCode,
--      classOfBusiness, riskCode, territorialScope as the source row).
--
-- HEALTH for PT/GR/ES is intentionally skipped — ADR-0032 §6 lists this as a
-- Phase-2 follow-up gated on tax-profile confirmation. MOTOR for PT/GR/ES is
-- also skipped because the `ABBEYGATE0125-*` motor BAA carries
-- `territorialScope: ['CY']` — Lloyd's has not authorised motor outside CY
-- (the seed in `canonicalProgramBinderSeed.ts` reflects this). The motor
-- wizard will now refuse with the canonical 503 instead of crashing.
--
-- All four steps are idempotent (`WHERE NOT EXISTS` guards + `ON CONFLICT
-- DO NOTHING`), so re-running this migration is a no-op.

-- Deterministic tenant ids (mirror TENANT_IDS in
-- backend/platform/tenant/tenantConfig.ts).
DO $$
DECLARE
  v_pt_id  TEXT := '00000000-0000-4000-8000-000000000002';
  v_gr_id  TEXT := '00000000-0000-4000-8000-000000000003';
  v_es_id  TEXT := '00000000-0000-4000-8000-000000000004';
  v_pt_cc  TEXT := 'PT';
  v_gr_cc  TEXT := 'GR';
  v_es_cc  TEXT := 'ES';
BEGIN
  PERFORM 1
    WHERE v_pt_id IS NOT NULL
      AND v_gr_id IS NOT NULL
      AND v_es_id IS NOT NULL;
END $$;

-- ── Step 1: Per-tenant Programs ────────────────────────────────────────────
-- One Program per (tenant, productType). Mirror CY's program naming so BO
-- listings stay consistent across tenants. Only seed rows that don't already
-- exist for that tenant.
INSERT INTO "programs" (
  "id",
  "operatingTenantId",
  "name",
  "status",
  "productType",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  t."id",
  p.product_name,
  'ACTIVE',
  p.product_code,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (VALUES
  ('HOME',   'Abbeygate Home Standard'),
  ('TRAVEL', 'Abbeygate Travel Standard'),
  ('MOTOR',  'Abbeygate Motor Comprehensive')
) AS p(product_code, product_name)
WHERE t."tenantSlug" IN ('abbeygate-pt', 'abbeygate-gr', 'abbeygate-es')
  AND t."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1
    FROM "programs" existing
    WHERE existing."operatingTenantId" = t."id"
      AND existing."productType" = p.product_code
  );

-- ── Step 2: Per-tenant Binder mirrors ──────────────────────────────────────
-- For every CY-anchored BinderProductAuthority whose territorialScope
-- contains the tenant's country, mirror the Binder row under the tenant. The
-- mirror carries:
--   - new id (`<sourceBinderId>-<COUNTRY_CODE>`, deterministic so re-runs
--     don't proliferate UUIDs)
--   - source umr, agreementNumber, coverholderName, coverholderPin,
--     defaultCurrency, settlementCurrency, lloydsReportingVer, startDate,
--     endDate (this is the same Lloyd's BAA, just operated under a different
--     coverholder tenant)
--   - `operatingTenantId = <tenant>`
-- The composite identity at the Lloyd's level (umr + agreementNumber +
-- coverholderPin) is preserved across the mirror rows.
INSERT INTO "binders" (
  "id",
  "operatingTenantId",
  "coverholderName",
  "coverholderPin",
  "umr",
  "agreementNumber",
  "lloydsReportingVer",
  "defaultCurrency",
  "settlementCurrency",
  "startDate",
  "endDate",
  "status",
  "config",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT
  CONCAT(b_src."id", '-', t."countryCode") AS new_id,
  t."id" AS new_operating_tenant_id,
  b_src."coverholderName",
  b_src."coverholderPin",
  b_src."umr",
  b_src."agreementNumber",
  b_src."lloydsReportingVer",
  b_src."defaultCurrency",
  b_src."settlementCurrency",
  b_src."startDate",
  b_src."endDate",
  b_src."status",
  b_src."config",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" t
JOIN "binders" b_src
  ON b_src."operatingTenantId" = '00000000-0000-4000-8000-000000000001' -- CY tenant id
JOIN "binder_product_authorities" bpa
  ON bpa."binderId" = b_src."id"
  AND t."countryCode" = ANY(bpa."territorialScope")
WHERE t."tenantSlug" IN ('abbeygate-pt', 'abbeygate-gr', 'abbeygate-es')
  AND t."status" = 'ACTIVE'
  AND bpa."productCode" IN ('HOME', 'TRAVEL') -- HEALTH defers per ADR-0032 §6; MOTOR territory is CY-only
  AND bpa."status" = 'ACTIVE'
ON CONFLICT ("id") DO NOTHING;

-- ── Step 3: Per-tenant ProgramBinderLink rows ──────────────────────────────
-- Link each tenant's Program(productType=X) to the tenant's matching
-- Binder mirror (where the source binder's authority for productCode=X
-- includes the tenant's country in territorialScope).
INSERT INTO "program_binder_links" (
  "id",
  "programId",
  "binderId",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT
  gen_random_uuid(),
  p_tenant."id",
  b_mirror."id",
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" t
JOIN "programs" p_tenant
  ON p_tenant."operatingTenantId" = t."id"
JOIN "binder_product_authorities" bpa_src
  ON bpa_src."productCode" = p_tenant."productType"
JOIN "binders" b_src
  ON b_src."id" = bpa_src."binderId"
  AND b_src."operatingTenantId" = '00000000-0000-4000-8000-000000000001'
JOIN "binders" b_mirror
  ON b_mirror."id" = CONCAT(b_src."id", '-', t."countryCode")
  AND b_mirror."operatingTenantId" = t."id"
WHERE t."tenantSlug" IN ('abbeygate-pt', 'abbeygate-gr', 'abbeygate-es')
  AND t."countryCode" = ANY(bpa_src."territorialScope")
  AND p_tenant."status" = 'ACTIVE'
  AND bpa_src."status" = 'ACTIVE'
  AND p_tenant."productType" IN ('HOME', 'TRAVEL')
  AND NOT EXISTS (
    SELECT 1
    FROM "program_binder_links" existing
    WHERE existing."programId" = p_tenant."id"
      AND existing."binderId" = b_mirror."id"
  );

-- ── Step 4: Per-tenant BinderProductAuthority rows ─────────────────────────
-- Mirror the source BinderProductAuthority onto each tenant's binder mirror.
-- Same productCode/classOfBusiness/riskCode/authorityClasses/territorialScope
-- as the source row — the underlying Lloyd's authority is unchanged. The
-- per-tenant `operatingTenantId` is the only structural difference.
INSERT INTO "binder_product_authorities" (
  "id",
  "operatingTenantId",
  "binderId",
  "productCode",
  "classOfBusiness",
  "riskCode",
  "territorialScope",
  "authorityClasses",
  "maxPremiumAnnual",
  "maxPolicyPeriodDays",
  "maxAdvanceInceptionDays",
  "status",
  "effectiveFrom",
  "effectiveTo",
  "notes",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT
  gen_random_uuid(),
  t."id" AS new_operating_tenant_id,
  b_mirror."id" AS new_binder_id,
  bpa_src."productCode",
  bpa_src."classOfBusiness",
  bpa_src."riskCode",
  bpa_src."territorialScope",
  bpa_src."authorityClasses",
  bpa_src."maxPremiumAnnual",
  bpa_src."maxPolicyPeriodDays",
  bpa_src."maxAdvanceInceptionDays",
  bpa_src."status",
  bpa_src."effectiveFrom",
  bpa_src."effectiveTo",
  bpa_src."notes",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" t
JOIN "binder_product_authorities" bpa_src
  ON bpa_src."operatingTenantId" = '00000000-0000-4000-8000-000000000001'
JOIN "binders" b_src
  ON b_src."id" = bpa_src."binderId"
JOIN "binders" b_mirror
  ON b_mirror."id" = CONCAT(b_src."id", '-', t."countryCode")
  AND b_mirror."operatingTenantId" = t."id"
WHERE t."tenantSlug" IN ('abbeygate-pt', 'abbeygate-gr', 'abbeygate-es')
  AND t."countryCode" = ANY(bpa_src."territorialScope")
  AND bpa_src."productCode" IN ('HOME', 'TRAVEL')
  AND bpa_src."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1
    FROM "binder_product_authorities" existing
    WHERE existing."binderId" = b_mirror."id"
      AND existing."productCode" = bpa_src."productCode"
  );
