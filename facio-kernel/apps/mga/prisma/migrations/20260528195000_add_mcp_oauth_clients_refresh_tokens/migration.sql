-- ADR-0040 — MCP OAuth 2.1 V2.1.
-- Two tables: oauth_clients (DCR registrations) + oauth_refresh_tokens.
-- Authorization codes + access tokens live in Redis (high read volume,
-- short TTL — same precedent as confirmationTokenStore).
--
-- Per-tenant: every row bound to operatingTenantId; tenant-scoped
-- Prisma extension enforces the boundary.
--
-- Single owner: backend/modules/mcp/oauth/. Direct writes from any
-- other module fail the `check-mcp-auth-single-funnel.mjs` guard
-- (Phase B).

CREATE TABLE "oauth_clients" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretHash" TEXT,
    "clientName" TEXT NOT NULL,
    "clientUri" TEXT,
    "redirectUris" TEXT[],
    "scopes" TEXT[],
    "registrationKind" TEXT NOT NULL DEFAULT 'dcr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_clients_clientId_key"
    ON "oauth_clients"("clientId");

CREATE INDEX "oauth_clients_operatingTenantId_revokedAt_idx"
    ON "oauth_clients"("operatingTenantId", "revokedAt");

ALTER TABLE "oauth_clients"
    ADD CONSTRAINT "oauth_clients_operatingTenantId_fkey"
    FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "oauth_refresh_tokens" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT[],
    "resource" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "oauth_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_refresh_tokens_tokenHash_key"
    ON "oauth_refresh_tokens"("tokenHash");

CREATE INDEX "oauth_refresh_tokens_operatingTenantId_expiresAt_idx"
    ON "oauth_refresh_tokens"("operatingTenantId", "expiresAt");

CREATE INDEX "oauth_refresh_tokens_clientId_expiresAt_idx"
    ON "oauth_refresh_tokens"("clientId", "expiresAt");

CREATE INDEX "oauth_refresh_tokens_tokenHash_idx"
    ON "oauth_refresh_tokens"("tokenHash");

ALTER TABLE "oauth_refresh_tokens"
    ADD CONSTRAINT "oauth_refresh_tokens_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "oauth_clients"("clientId")
    ON DELETE RESTRICT ON UPDATE CASCADE;
