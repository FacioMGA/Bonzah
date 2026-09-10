-- Greece (GR) go-live parity — seed the manual Business and Open Market
-- products for the Greece operating tenant, mirroring the Cyprus-only
-- migration `20260601190000_seed_business_open_market_manual_products`.
--
-- Why this migration exists
-- -------------------------
-- BUSINESS and OPEN_MARKET are manual-referral products. Cyprus already has
-- Programs + a manual binder (`OPEN-MARKET-MANUAL-2026`) + BinderProductAuthority
-- rows (CY-only). The public product catalog offers Business/Open Market on
-- every host, so on `gr.abbeygate.com` the wizard resolved to `TENANT_IDS.GR`,
-- found no GR-operated binder in `findLatestActiveBinderLinkForProduct`, and
-- returned 503 "No active binder linked". To bring Greece to Cyprus product
-- parity we seed the GR-operated Program / Binder / ProgramBinderLink /
-- BinderProductAuthority rows here, scoped to Greece (`territorialScope: ['GR']`,
-- `riskLocationCountries: ['GR']`).
--
-- HEALTH is intentionally NOT part of this migration: it remains Cyprus-only
-- (Brit Immigration Medical, ADR-0032) pending a regulatory follow-up ADR.
--
-- All steps are idempotent (`WHERE NOT EXISTS` guards + `ON CONFLICT`), so
-- re-running is a no-op. `product_definitions` rows are global and already
-- inserted by the Cyprus migration; they are not re-inserted here.

-- ── Step 1: GR Programs (BUSINESS, OPEN_MARKET) ────────────────────────────
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
  seed."name",
  'ACTIVE',
  seed."productType",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (
  VALUES
    ('Abbeygate Business Manual', 'BUSINESS'),
    ('Abbeygate Open Market Manual', 'OPEN_MARKET')
) AS seed("name", "productType")
WHERE t."countryCode" = 'GR'
  AND t."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1
    FROM "programs" p
    WHERE p."operatingTenantId" = t."id"
      AND p."productType" = seed."productType"
  );

-- ── Step 2: GR manual binder mirror ────────────────────────────────────────
-- Deterministic id `OPEN-MARKET-MANUAL-2026-GR` (mirrors the CY binder id with
-- the `-GR` suffix used by the PT/GR/ES mirror migration), operated by GR,
-- risk location Greece.
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
SELECT
  'OPEN-MARKET-MANUAL-2026-GR',
  t."id",
  'Abbeygate Insurance Brokers Limited',
  '115933OFE',
  'MANUAL OPEN MARKET 2026',
  'OPEN-MARKET-MANUAL-2026-GR',
  'V5.2',
  'EUR',
  'EUR',
  TIMESTAMPTZ '2026-01-01T00:00:00.000Z',
  TIMESTAMPTZ '2026-12-31T23:59:59.999Z',
  'ACTIVE',
  '{"productType":"OPEN_MARKET","scope":{"authorizedClass":"Open Market","riskLocationCountries":["GR"],"selectableProducts":["BUSINESS"]}}'::JSONB,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" t
WHERE t."countryCode" = 'GR'
ORDER BY t."id"
LIMIT 1
ON CONFLICT ("id") DO UPDATE
SET
  "operatingTenantId" = EXCLUDED."operatingTenantId",
  "config" = EXCLUDED."config",
  "status" = EXCLUDED."status",
  "updatedAt" = CURRENT_TIMESTAMP;

-- ── Step 3: GR BinderProductAuthority rows (BUSINESS + OPEN_MARKET) ─────────
WITH gr_binder AS (
  SELECT b."id", b."operatingTenantId"
  FROM "binders" b
  WHERE b."id" = 'OPEN-MARKET-MANUAL-2026-GR'
    AND b."status" = 'ACTIVE'
)
INSERT INTO "binder_product_authorities" (
  "id",
  "operatingTenantId",
  "binderId",
  "productCode",
  "classOfBusiness",
  "riskCode",
  "territorialScope",
  "authorityClasses",
  "status",
  "effectiveFrom",
  "effectiveTo",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  gb."operatingTenantId",
  gb."id",
  seed."productCode",
  seed."classOfBusiness",
  seed."riskCode",
  ARRAY['GR']::TEXT[],
  seed."authorityClasses",
  'ACTIVE',
  TIMESTAMPTZ '2026-01-01T00:00:00.000Z',
  TIMESTAMPTZ '2026-12-31T23:59:59.999Z',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM gr_binder gb
CROSS JOIN (
  VALUES
    ('BUSINESS', 'COMMERCIAL', 'COM', ARRAY['PROPERTY','LIABILITY','BUSINESS_INTERRUPTION']::TEXT[]),
    ('OPEN_MARKET', 'OPEN_MARKET', 'OM', ARRAY['MANUAL']::TEXT[])
) AS seed("productCode", "classOfBusiness", "riskCode", "authorityClasses")
ON CONFLICT ("binderId", "productCode") DO NOTHING;

-- ── Step 4: GR ProgramBinderLink rows ──────────────────────────────────────
INSERT INTO "program_binder_links" (
  "id",
  "programId",
  "binderId",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  p."id",
  bpa."binderId",
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "programs" p
JOIN "binder_product_authorities" bpa
  ON bpa."operatingTenantId" = p."operatingTenantId"
 AND bpa."productCode" = p."productType"
 AND bpa."status" = 'ACTIVE'
JOIN "tenants" t
  ON t."id" = p."operatingTenantId"
WHERE t."countryCode" = 'GR'
  AND p."productType" IN ('BUSINESS', 'OPEN_MARKET')
  AND p."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1
    FROM "program_binder_links" pbl
    WHERE pbl."programId" = p."id"
      AND pbl."binderId" = bpa."binderId"
  );
