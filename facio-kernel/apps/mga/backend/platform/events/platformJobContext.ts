import type { Job } from 'bullmq';
import { getTenantConfig, type TenantConfig } from '../tenant/tenantConfig.js';
import { runWithOperatingTenant } from '../tenant/tenantAls.js';
import { z } from 'zod';
import { runWithOperatingTenantById } from '../tenant/tenantJobContext.js';

/** Queue payloads originate from the durable relay; handlers still verify their business-object tenant. */
export async function invokeTenantJob<T>(job: Job, handler: (job: Job) => Promise<T>): Promise<T> {
  if (process.env.KERNEL_PLATFORM_MODE !== 'true') return handler(job);
  const envelope = z.object({ operatingTenantId: z.string().uuid() }).parse(job.data);
  return runWithOperatingTenantById(envelope.operatingTenantId, () => handler(job));
}

/** Shared workers inherit the tenant admitted from the durable envelope. Legacy
 * single-tenant workers may supply their explicit CLI configuration at this edge. */
export function runWithWorkerTenant<T>(work: () => T, legacyConfig: () => TenantConfig): T {
  if (process.env.KERNEL_PLATFORM_MODE === 'true') {
    getTenantConfig();
    return work();
  }
  return runWithOperatingTenant(legacyConfig(), work);
}
