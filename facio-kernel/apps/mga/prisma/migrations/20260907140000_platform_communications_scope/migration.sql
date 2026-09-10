-- ADR-0103: this new platform has no imported communication business rows.
-- Do not infer an owner for legacy communications. A nonempty source requires
-- a separately reviewed ownership migration and must fail this bootstrap.
DO $$
DECLARE table_name TEXT; row_count BIGINT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['communication_threads', 'communication_messages', 'communication_templates', 'communication_participants', 'communication_delivery_attempts'] LOOP
    EXECUTE format('SELECT count(*) FROM %I', table_name) INTO row_count;
    IF row_count <> 0 THEN RAISE EXCEPTION 'Explicit ownership migration required for %', table_name; END IF;
    EXECUTE format('ALTER TABLE %I ADD COLUMN "operatingTenantId" TEXT NOT NULL DEFAULT current_setting(''app.operating_tenant_id''::text, true)', table_name);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("operatingTenantId") REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE', table_name, table_name || '_operatingTenantId_fkey');
    EXECUTE format('CREATE INDEX %I ON %I("operatingTenantId")', table_name || '_operatingTenantId_idx', table_name);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY op_tenant_isolation ON %I USING ("operatingTenantId" = current_setting(''app.operating_tenant_id'', true)) WITH CHECK ("operatingTenantId" = current_setting(''app.operating_tenant_id'', true))', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

CREATE UNIQUE INDEX "communication_threads_id_operatingTenantId_key" ON communication_threads(id, "operatingTenantId");
CREATE UNIQUE INDEX "communication_messages_id_operatingTenantId_key" ON communication_messages(id, "operatingTenantId");
ALTER TABLE communication_messages DROP CONSTRAINT "communication_messages_threadId_fkey";
ALTER TABLE communication_messages ADD CONSTRAINT "communication_messages_threadId_operatingTenantId_fkey" FOREIGN KEY ("threadId", "operatingTenantId") REFERENCES communication_threads(id, "operatingTenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE communication_delivery_attempts DROP CONSTRAINT "communication_delivery_attempts_messageId_fkey";
ALTER TABLE communication_delivery_attempts ADD CONSTRAINT "communication_delivery_attempts_messageId_operatingTenantId_fkey" FOREIGN KEY ("messageId", "operatingTenantId") REFERENCES communication_messages(id, "operatingTenantId") ON DELETE CASCADE ON UPDATE CASCADE;
