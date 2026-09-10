-- ADR-0046 amendment (2026-07-01): open HOME for full online purchase.
--
-- Travel and Immigration (Health) were seeded payment-ON at launch; HOME was
-- referral-only (paymentEnabled=false). This flips HOME paymentEnabled=true for
-- every operating tenant. Binder authority still gates issuance per product/
-- territory (a tenant without a HOME binder still 503s before checkout), so
-- opening the payment channel broadly is safe — same pattern as travel.
--
-- product_channel_settings has FORCE ROW LEVEL SECURITY with a USING policy on
-- app.operating_tenant_id, so a plain UPDATE (no tenant context) would match 0
-- rows. Set the per-tenant GUC in a loop so the RLS policy is satisfied and the
-- table's tenant isolation is preserved. Idempotent.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT "id" FROM "tenants" LOOP
    PERFORM set_config('app.operating_tenant_id', t."id", true);
    UPDATE "product_channel_settings"
    SET "paymentEnabled" = true, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "productCode" = 'HOME' AND "paymentEnabled" = false;
  END LOOP;
END $$;
