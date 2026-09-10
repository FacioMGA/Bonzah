-- ADR-0103: tenant settings replace the legacy unscoped singleton.
-- Existing unowned rows stay unassigned and become invisible; never guess their owner.
ALTER TABLE settings ADD COLUMN "operatingTenantId" TEXT;
CREATE UNIQUE INDEX "settings_operatingTenantId_key" ON settings("operatingTenantId");
ALTER TABLE settings ADD CONSTRAINT "settings_operatingTenantId_fkey" FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- These later-added business tables had tenant keys but lacked database enforcement.
-- Missing GUC and NULL keys fail closed for non-bypass runtime connections.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['settings', 'bdx_import_jobs', 'oauth_clients', 'oauth_refresh_tokens', 'product_launch_drafts', 'synthetic_email_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY op_tenant_isolation ON %I USING ("operatingTenantId" = current_setting(''app.operating_tenant_id'', true)) WITH CHECK ("operatingTenantId" = current_setting(''app.operating_tenant_id'', true))', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

-- Platform identity, organization memberships and immutable provisioning receipts
-- are control-plane authorization records, intentionally queried before tenant selection.
