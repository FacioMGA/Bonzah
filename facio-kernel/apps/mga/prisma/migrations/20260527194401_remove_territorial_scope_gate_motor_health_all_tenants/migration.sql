-- ABY-294 follow-up: territorial-scope gate removed per direct operator
-- instruction (2026-05-27, post-deploy of 20260527171932_seed_pt_gr_es_*).
--
-- 1) Every BinderProductAuthority row is widened to the full EU territorial
--    set so MOTOR / HOME / TRAVEL / HEALTH risks can be written in any of
--    the platform's launch jurisdictions plus the Travel-BAA territories
--    enumerated in ADR-0024.
-- 2) Per-tenant Program + Binder mirror + ProgramBinderLink +
--    BinderProductAuthority rows that the previous migration skipped (MOTOR
--    and HEALTH, whose source territorialScope was CY-only) are inserted
--    for PT / GR / ES tenants.
-- 3) Idempotent: every INSERT carries `WHERE NOT EXISTS` or `ON CONFLICT
--    DO NOTHING`. Re-running this migration is a no-op.

-- ── Step 0: widen territorialScope on every CY-anchored authority row ──
UPDATE "binder_product_authorities"
SET "territorialScope" = ARRAY['CY','PT','GR','ES','BE','NL','IT','FR','MT','DE']::text[]
WHERE "operatingTenantId" = '00000000-0000-4000-8000-000000000001';

-- ── Step 1: HEALTH Program for PT / GR / ES ─────────────────────────────
INSERT INTO "programs" ("id", "operatingTenantId", "name", "status", "productType", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t."id", 'Abbeygate Immigration Medical', 'ACTIVE', 'HEALTH', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t
WHERE t."tenantSlug" IN ('abbeygate-pt', 'abbeygate-gr', 'abbeygate-es')
  AND t."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM "programs" existing
    WHERE existing."operatingTenantId" = t."id" AND existing."productType" = 'HEALTH'
  );

-- ── Step 2: MOTOR Program for PT / GR / ES ──────────────────────────────
INSERT INTO "programs" ("id", "operatingTenantId", "name", "status", "productType", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t."id", 'Abbeygate Motor Comprehensive', 'ACTIVE', 'MOTOR', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t
WHERE t."tenantSlug" IN ('abbeygate-pt', 'abbeygate-gr', 'abbeygate-es')
  AND t."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM "programs" existing
    WHERE existing."operatingTenantId" = t."id" AND existing."productType" = 'MOTOR'
  );

-- ── Step 3: Mirror MOTOR + HEALTH source binders (no territorial gate) ──
INSERT INTO "binders" (
  "id", "operatingTenantId", "coverholderName", "coverholderPin", "umr",
  "agreementNumber", "lloydsReportingVer", "defaultCurrency", "settlementCurrency",
  "startDate", "endDate", "status", "config", "createdAt", "updatedAt"
)
SELECT DISTINCT
  CONCAT(b_src."id", '-', t."countryCode"),
  t."id",
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
  ON b_src."operatingTenantId" = '00000000-0000-4000-8000-000000000001'
JOIN "binder_product_authorities" bpa
  ON bpa."binderId" = b_src."id"
WHERE t."tenantSlug" IN ('abbeygate-pt', 'abbeygate-gr', 'abbeygate-es')
  AND t."status" = 'ACTIVE'
  AND bpa."productCode" IN ('MOTOR', 'HEALTH')
  AND bpa."status" = 'ACTIVE'
ON CONFLICT ("id") DO NOTHING;

-- ── Step 4: ProgramBinderLink for MOTOR + HEALTH on PT/GR/ES mirrors ────
INSERT INTO "program_binder_links" ("id", "programId", "binderId", "status", "createdAt", "updatedAt")
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
  AND p_tenant."productType" IN ('MOTOR', 'HEALTH')
  AND p_tenant."status" = 'ACTIVE'
  AND bpa_src."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM "program_binder_links" existing
    WHERE existing."programId" = p_tenant."id"
      AND existing."binderId" = b_mirror."id"
  );

-- ── Step 5: BinderProductAuthority for MOTOR + HEALTH on PT/GR/ES mirrors
INSERT INTO "binder_product_authorities" (
  "id", "operatingTenantId", "binderId", "productCode", "classOfBusiness",
  "riskCode", "territorialScope", "authorityClasses", "maxPremiumAnnual",
  "maxPolicyPeriodDays", "maxAdvanceInceptionDays", "status",
  "effectiveFrom", "effectiveTo", "notes", "createdAt", "updatedAt"
)
SELECT DISTINCT
  gen_random_uuid(),
  t."id",
  b_mirror."id",
  bpa_src."productCode",
  bpa_src."classOfBusiness",
  bpa_src."riskCode",
  ARRAY['CY','PT','GR','ES','BE','NL','IT','FR','MT','DE']::text[],
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
  AND bpa_src."productCode" IN ('MOTOR', 'HEALTH')
  AND bpa_src."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM "binder_product_authorities" existing
    WHERE existing."binderId" = b_mirror."id"
      AND existing."productCode" = bpa_src."productCode"
  );
