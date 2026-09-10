-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "runtimeSettings" JSONB,
ADD COLUMN     "runtimeSettingsVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "platform_organizations" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_organization_memberships" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_organization_memberships_pkey" PRIMARY KEY ("organizationId","userId")
);

-- CreateTable
CREATE TABLE "platform_tenant_memberships" (
    "operatingTenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_tenant_memberships_pkey" PRIMARY KEY ("operatingTenantId","userId")
);

-- CreateTable
CREATE TABLE "platform_tenant_provisionings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "templateHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "resultHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_tenant_provisionings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_tenant_commands" (
    "organizationId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "resultHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_tenant_commands_pkey" PRIMARY KEY ("organizationId","operation","idempotencyKey")
);

-- CreateTable
CREATE TABLE "platform_identities" (
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_identities_pkey" PRIMARY KEY ("issuer","subject")
);

-- CreateTable
CREATE TABLE "platform_auth_entries" (
    "kind" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "platform_auth_entries_pkey" PRIMARY KEY ("kind","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_organizations_slug_key" ON "platform_organizations"("slug");

-- CreateIndex
CREATE INDEX "platform_organization_memberships_userId_active_idx" ON "platform_organization_memberships"("userId", "active");

-- CreateIndex
CREATE INDEX "platform_tenant_memberships_userId_active_idx" ON "platform_tenant_memberships"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "platform_tenant_provisionings_operatingTenantId_key" ON "platform_tenant_provisionings"("operatingTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_tenant_provisionings_organizationId_idempotencyKey_key" ON "platform_tenant_provisionings"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "platform_identities_userId_issuer_key" ON "platform_identities"("userId", "issuer");

-- CreateIndex
CREATE INDEX "platform_auth_entries_expiresAt_idx" ON "platform_auth_entries"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_id_operatingTenantId_key" ON "accounts"("id", "operatingTenantId");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_parentOrganizationId_fkey" FOREIGN KEY ("parentOrganizationId") REFERENCES "platform_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_organization_memberships" ADD CONSTRAINT "platform_organization_memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "platform_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_organization_memberships" ADD CONSTRAINT "platform_organization_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_tenant_memberships" ADD CONSTRAINT "platform_tenant_memberships_operatingTenantId_fkey" FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_tenant_memberships" ADD CONSTRAINT "platform_tenant_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_tenant_memberships" ADD CONSTRAINT "platform_tenant_memberships_accountId_operatingTenantId_fkey" FOREIGN KEY ("accountId", "operatingTenantId") REFERENCES "accounts"("id", "operatingTenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_tenant_provisionings" ADD CONSTRAINT "platform_tenant_provisionings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "platform_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_tenant_provisionings" ADD CONSTRAINT "platform_tenant_provisionings_operatingTenantId_fkey" FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_tenant_provisionings" ADD CONSTRAINT "platform_tenant_provisionings_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_tenant_commands" ADD CONSTRAINT "platform_tenant_commands_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "platform_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_tenant_commands" ADD CONSTRAINT "platform_tenant_commands_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_identities" ADD CONSTRAINT "platform_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Control-plane authorization records are accessed only by the actor-scoped service.
-- Business writes continue through existing forced operating-tenant RLS.
ALTER TABLE platform_organization_memberships ADD CONSTRAINT platform_org_role_check CHECK (role IN ('OWNER','ADMIN','BUILDER'));
ALTER TABLE platform_organization_memberships ADD CONSTRAINT platform_org_version_check CHECK (version > 0);
ALTER TABLE platform_tenant_memberships ADD CONSTRAINT platform_tenant_role_check CHECK (role IN ('ADMIN','UNDERWRITER'));
ALTER TABLE platform_tenant_memberships ADD CONSTRAINT platform_tenant_version_check CHECK (version > 0);
ALTER TABLE tenants ADD CONSTRAINT tenant_runtime_version_check CHECK ("runtimeSettingsVersion" > 0);
CREATE FUNCTION prevent_platform_receipt_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Platform command receipts are immutable'; END $$;
CREATE TRIGGER platform_provisioning_immutable BEFORE UPDATE OR DELETE ON platform_tenant_provisionings FOR EACH ROW EXECUTE FUNCTION prevent_platform_receipt_mutation();
CREATE TRIGGER platform_command_immutable BEFORE UPDATE OR DELETE ON platform_tenant_commands FOR EACH ROW EXECUTE FUNCTION prevent_platform_receipt_mutation();
