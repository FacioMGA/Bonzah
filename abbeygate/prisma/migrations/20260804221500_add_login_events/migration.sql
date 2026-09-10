-- Peter Sheppard BO transition baseline: login monitoring.

CREATE TABLE "login_events" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "outOfHours" BOOLEAN NOT NULL DEFAULT false,
    "alertRecipient" TEXT,
    "alertQueuedAt" TIMESTAMP(3),
    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "login_events_operatingTenantId_occurredAt_idx" ON "login_events"("operatingTenantId", "occurredAt");
CREATE INDEX "login_events_operatingTenantId_userId_occurredAt_idx" ON "login_events"("operatingTenantId", "userId", "occurredAt");
CREATE INDEX "login_events_outOfHours_occurredAt_idx" ON "login_events"("outOfHours", "occurredAt");
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_operatingTenantId_fkey" FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE login_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON login_events USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE login_events FORCE ROW LEVEL SECURITY;
