-- ADR-0046 — Product channel switches.
--
-- Per operating-tenant (== operating country) x product, three independent
-- switches gate the public customer journey: questionsEnabled (open/fill the
-- wizard), quoteEnabled (see a price), paymentEnabled (pay online). Backend is
-- the source of truth; the public frontend reads a projection. A logged-in BO
-- user bypasses any OFF gate. Tenant-scoped + RLS posture (ADR-0019).

CREATE TABLE "product_channel_settings" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "questionsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quoteEnabled" BOOLEAN NOT NULL DEFAULT true,
    "paymentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_channel_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_channel_settings_operatingTenantId_productCode_key"
    ON "product_channel_settings"("operatingTenantId", "productCode");
CREATE INDEX "product_channel_settings_operatingTenantId_idx"
    ON "product_channel_settings"("operatingTenantId");

ALTER TABLE "product_channel_settings"
    ADD CONSTRAINT "product_channel_settings_operatingTenantId_fkey"
    FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE product_channel_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON product_channel_settings
    USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE product_channel_settings FORCE ROW LEVEL SECURITY;

-- Seed launch defaults for every tenant. Travel is fully online; motor/home/
-- business are referral-only (payment OFF) at launch; open-market is manual
-- (quote + payment OFF). Health is seeded for Cyprus only (Cyprus-only product).
INSERT INTO "product_channel_settings" (
    "id", "operatingTenantId", "productCode",
    "questionsEnabled", "quoteEnabled", "paymentEnabled",
    "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(),
    t."id",
    seed."productCode",
    seed."questionsEnabled",
    seed."quoteEnabled",
    seed."paymentEnabled",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (
    VALUES
        ('MOTOR', true, true, false),
        ('HOME', true, true, false),
        ('TRAVEL', true, true, true),
        ('BUSINESS', true, true, false),
        ('OPEN_MARKET', true, false, false)
) AS seed("productCode", "questionsEnabled", "quoteEnabled", "paymentEnabled")
ON CONFLICT ("operatingTenantId", "productCode") DO NOTHING;

INSERT INTO "product_channel_settings" (
    "id", "operatingTenantId", "productCode",
    "questionsEnabled", "quoteEnabled", "paymentEnabled",
    "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(),
    t."id",
    'HEALTH',
    true,
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "tenants" t
WHERE t."countryCode" = 'CY'
ON CONFLICT ("operatingTenantId", "productCode") DO NOTHING;
