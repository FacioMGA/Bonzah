-- Portugal Immigration is a customer-data collection and operator-referral
-- journey only (Peter Sheppard, 2026-09-02). This creates the tenant-local
-- manual Open Market routing required to save the referral. It is not an
-- insurance authority: it has no automated rate, payment, wording or issuance
-- path, and it does not add the Cyprus HEALTH product to Portugal.

-- The product channel is explicit for this tenant: customers may provide
-- referral details, but cannot receive an automated premium or checkout.
INSERT INTO "product_channel_settings" (
  "id", "operatingTenantId", "productCode", "questionsEnabled", "quoteEnabled", "paymentEnabled", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), t."id", product_channel."productCode", true, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (VALUES ('BUSINESS'), ('OPEN_MARKET')) AS product_channel("productCode")
WHERE t."countryCode" = 'PT'
  AND t."status" = 'ACTIVE'
ON CONFLICT ("operatingTenantId", "productCode") DO UPDATE
SET
  "questionsEnabled" = true,
  "quoteEnabled" = true,
  "paymentEnabled" = false,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "programs" (
  "id", "operatingTenantId", "name", "status", "productType", "metadata", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), t."id", program."name", 'ACTIVE', program."productType",
  '{"referralOnly":true,"referralOnlyReason":"Portugal commercial authority pending"}'::JSONB,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (
  VALUES
    ('Abbeygate Business Referral Only', 'BUSINESS'),
    ('Abbeygate Open Market Referral Only', 'OPEN_MARKET')
) AS program("name", "productType")
WHERE t."countryCode" = 'PT'
  AND t."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM "programs" p
    WHERE p."operatingTenantId" = t."id" AND p."productType" = program."productType"
  );

INSERT INTO "binders" (
  "id", "operatingTenantId", "coverholderName", "coverholderPin", "umr", "agreementNumber",
  "lloydsReportingVer", "defaultCurrency", "settlementCurrency", "startDate", "endDate", "status", "config", "createdAt", "updatedAt"
)
SELECT
  'OPEN-MARKET-MANUAL-2026-PT', t."id", 'Abbeygate Insurance Brokers Limited', '115933OFE',
  'MANUAL OPEN MARKET 2026', 'OPEN-MARKET-MANUAL-2026-PT', 'V5.2', 'EUR', 'EUR',
  TIMESTAMPTZ '2026-01-01T00:00:00.000Z', TIMESTAMPTZ '2026-12-31T23:59:59.999Z', 'ACTIVE',
  '{"productType":"OPEN_MARKET","scope":{"authorizedClass":"Open Market","riskLocationCountries":["PT"],"selectableProducts":["BUSINESS"]}}'::JSONB,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t
WHERE t."countryCode" = 'PT'
  AND t."status" = 'ACTIVE'
ON CONFLICT ("id") DO UPDATE
SET
  "operatingTenantId" = EXCLUDED."operatingTenantId",
  "config" = EXCLUDED."config",
  "status" = EXCLUDED."status",
  "updatedAt" = CURRENT_TIMESTAMP;

WITH pt_binder AS (
  SELECT b."id", b."operatingTenantId"
  FROM "binders" b
  WHERE b."id" = 'OPEN-MARKET-MANUAL-2026-PT' AND b."status" = 'ACTIVE'
)
INSERT INTO "binder_product_authorities" (
  "id", "operatingTenantId", "binderId", "productCode", "classOfBusiness", "riskCode",
  "territorialScope", "authorityClasses", "status", "effectiveFrom", "effectiveTo", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), b."operatingTenantId", b."id", authority."productCode", authority."classOfBusiness", authority."riskCode",
  ARRAY['PT']::TEXT[], ARRAY['MANUAL']::TEXT[], 'ACTIVE',
  TIMESTAMPTZ '2026-01-01T00:00:00.000Z', TIMESTAMPTZ '2026-12-31T23:59:59.999Z', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM pt_binder b
CROSS JOIN (
  VALUES
    ('BUSINESS', 'BUSINESS', 'BUS'),
    ('OPEN_MARKET', 'OPEN_MARKET', 'OM')
) AS authority("productCode", "classOfBusiness", "riskCode")
ON CONFLICT ("binderId", "productCode") DO NOTHING;

INSERT INTO "program_binder_links" ("id", "programId", "binderId", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(), p."id", b."id", 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "programs" p
JOIN "binders" b ON b."operatingTenantId" = p."operatingTenantId" AND b."id" = 'OPEN-MARKET-MANUAL-2026-PT'
WHERE p."productType" IN ('BUSINESS', 'OPEN_MARKET')
  AND p."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM "program_binder_links" pbl
    WHERE pbl."programId" = p."id" AND pbl."binderId" = b."id"
  );
