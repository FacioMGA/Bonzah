-- CreateEnum
CREATE TYPE "TenantKind" AS ENUM ('PRODUCTION', 'SYNTHETIC', 'TEST');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "tenants" (
    "id"                          TEXT NOT NULL,
    "tenantSlug"                  TEXT NOT NULL,
    "kind"                        "TenantKind" NOT NULL DEFAULT 'PRODUCTION',
    "status"                      "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "countryCode"                 TEXT NOT NULL,
    "country"                     TEXT NOT NULL,
    "currency"                    TEXT NOT NULL DEFAULT 'EUR',
    "ipt"                         JSONB NOT NULL,
    "adminFee"                    DECIMAL(10,2) NOT NULL DEFAULT 0,
    "legalPack"                   TEXT NOT NULL,
    "publicBaseUrl"               TEXT NOT NULL,
    "fromEmail"                   TEXT NOT NULL,
    "brandLogos"                  JSONB,
    "priorityCountries"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "allowedRiskCountries"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "defaultNationality"          TEXT NOT NULL DEFAULT '',
    "defaultDriversLicenseCountry" TEXT NOT NULL DEFAULT '',
    "defaultBrokerName"           TEXT,
    "authority"                   JSONB,
    "parentOrganizationId"        TEXT,
    "createdAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_tenantSlug_key" ON "tenants"("tenantSlug");

-- CreateIndex
CREATE INDEX "tenants_tenantSlug_idx" ON "tenants"("tenantSlug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");
