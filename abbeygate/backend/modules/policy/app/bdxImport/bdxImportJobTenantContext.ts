import { prisma } from '../../../../platform/db/connection.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import type { TenantConfig } from '../../../../platform/tenant/tenantConfig.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function tenantRowToConfig(row: {
  id: string;
  tenantSlug: string;
  countryCode: string;
  country: string;
  currency: string;
  iptJson: unknown;
  adminFee: unknown;
  legalPack: string;
  publicBaseUrl: string;
  fromEmail: string;
  brandLogos: unknown;
  defaultBrokerName: string | null;
}): TenantConfig {
  const ipt = asRecord(row.iptJson);
  const logos = asRecord(row.brandLogos);
  return {
    id: row.id,
    tenantSlug: row.tenantSlug,
    countryCode: row.countryCode as TenantConfig['countryCode'],
    country: row.country,
    currency: row.currency,
    ipt: {
      rate: typeof ipt.rate === 'number' ? ipt.rate : undefined,
      flatFee: typeof ipt.flatFee === 'number' ? ipt.flatFee : undefined,
    },
    adminFee: Number(row.adminFee),
    legalPack: row.legalPack as TenantConfig['legalPack'],
    publicBaseUrl: row.publicBaseUrl,
    fromEmail: row.fromEmail,
    brandLogo: {
      white: typeof logos.white === 'string' ? logos.white : '',
      blue: typeof logos.blue === 'string' ? logos.blue : '',
    },
    defaultBrokerName: row.defaultBrokerName ?? undefined,
  };
}

export async function runWithBdxJobOperatingTenant<T>(
  jobId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const job = await prisma.bdxImportJob.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from durable BDX job id.
    where: { id: jobId },
    select: { operatingTenantId: true },
  });
  if (!job?.operatingTenantId) throw new Error(`BDX import job tenant context not found: ${jobId}`);
  const tenant = await prisma.tenant.findUnique({ where: { id: job.operatingTenantId } });
  if (!tenant) throw new Error(`Operating tenant not found for BDX import job: ${job.operatingTenantId}`);
  return runWithOperatingTenant(tenantRowToConfig(tenant), fn);
}
