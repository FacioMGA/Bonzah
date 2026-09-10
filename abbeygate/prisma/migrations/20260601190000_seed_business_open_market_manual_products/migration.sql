-- Local-first seed for the manual Business and Open Market products.
-- This migration defines the product/program/binder rows but is not applied
-- unless the developer explicitly runs Prisma migrations locally.

INSERT INTO "product_definitions" ("code", "displayName", "icon", "isActive", "updatedAt")
VALUES
  ('BUSINESS', 'Business Insurance', 'briefcase-business', true, CURRENT_TIMESTAMP),
  ('OPEN_MARKET', 'Open Market', 'file-pen-line', true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE
SET
  "displayName" = EXCLUDED."displayName",
  "icon" = EXCLUDED."icon",
  "isActive" = EXCLUDED."isActive",
  "updatedAt" = CURRENT_TIMESTAMP;

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
WHERE t."countryCode" = 'CY'
  AND NOT EXISTS (
    SELECT 1
    FROM "programs" p
    WHERE p."operatingTenantId" = t."id"
      AND p."productType" = seed."productType"
  );

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
  'OPEN-MARKET-MANUAL-2026',
  t."id",
  'Abbeygate Insurance Brokers Limited',
  '115933OFE',
  'MANUAL OPEN MARKET 2026',
  'OPEN-MARKET-MANUAL-2026',
  'V5.2',
  'EUR',
  'EUR',
  TIMESTAMPTZ '2026-01-01T00:00:00.000Z',
  TIMESTAMPTZ '2026-12-31T23:59:59.999Z',
  'ACTIVE',
  '{"productType":"OPEN_MARKET","scope":{"authorizedClass":"Open Market","riskLocationCountries":["CY"],"selectableProducts":["BUSINESS"]}}'::JSONB,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" t
WHERE t."countryCode" = 'CY'
ORDER BY t."id"
LIMIT 1
ON CONFLICT ("id") DO UPDATE
SET
  "operatingTenantId" = EXCLUDED."operatingTenantId",
  "config" = EXCLUDED."config",
  "status" = EXCLUDED."status",
  "updatedAt" = CURRENT_TIMESTAMP;

WITH cy_binders AS (
  SELECT b."id", b."operatingTenantId"
  FROM "binders" b
  WHERE b."id" = 'OPEN-MARKET-MANUAL-2026'
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
  cb."operatingTenantId",
  cb."id",
  seed."productCode",
  seed."classOfBusiness",
  seed."riskCode",
  ARRAY['CY']::TEXT[],
  seed."authorityClasses",
  'ACTIVE',
  TIMESTAMPTZ '2026-01-01T00:00:00.000Z',
  TIMESTAMPTZ '2026-12-31T23:59:59.999Z',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM cy_binders cb
CROSS JOIN (
  VALUES
    ('BUSINESS', 'COMMERCIAL', 'COM', ARRAY['PROPERTY','LIABILITY','BUSINESS_INTERRUPTION']::TEXT[]),
    ('OPEN_MARKET', 'OPEN_MARKET', 'OM', ARRAY['MANUAL']::TEXT[])
) AS seed("productCode", "classOfBusiness", "riskCode", "authorityClasses")
ON CONFLICT ("binderId", "productCode") DO NOTHING;

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
WHERE p."productType" IN ('BUSINESS', 'OPEN_MARKET')
  AND p."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1
    FROM "program_binder_links" pbl
    WHERE pbl."programId" = p."id"
      AND pbl."binderId" = bpa."binderId"
  );
