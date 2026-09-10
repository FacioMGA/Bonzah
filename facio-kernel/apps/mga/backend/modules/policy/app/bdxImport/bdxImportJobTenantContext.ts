import { prisma } from '../../../../platform/db/connection.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';

import { tenantRowToConfig } from '../../../../platform/tenant/tenantConfigProjection.js';

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
