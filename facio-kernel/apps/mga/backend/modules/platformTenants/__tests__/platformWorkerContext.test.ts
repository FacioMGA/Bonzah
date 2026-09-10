import { afterEach, describe, expect, it, vi } from 'vitest';
const seen = vi.hoisted(() => [] as string[]);
const legacy = vi.hoisted(() => vi.fn());
vi.mock('../../../workers/index.js', () => ({ registerHandler: vi.fn() }));
vi.mock('../../../platform/tenant/tenantConfigForCli.js', () => ({ buildTenantConfigFromEnv: legacy }));
vi.mock('../../accounts360/infra/projections/accountIntelligenceProjection.js', async () => {
  const { getTenantConfig } = await import('../../../platform/tenant/tenantConfig.js');
  const work = async () => { seen.push(getTenantConfig().id); };
  return { backfillAccountIntelligenceProjection: work, reconcileAccountIntelligenceProjectionBatch: work };
});
vi.mock('../../accounts360/infra/projections/accounts360Projection.js', async () => {
  const { getTenantConfig } = await import('../../../platform/tenant/tenantConfig.js');
  const work = async () => { seen.push(getTenantConfig().id); };
  return { backfillAccounts360Projection: work, reconcileAccounts360ProjectionBatch: work };
});
vi.mock('../../policy/infra/projections/policyListIndex.js', async () => {
  const { getTenantConfig } = await import('../../../platform/tenant/tenantConfig.js');
  const work = async () => { seen.push(getTenantConfig().id); };
  return { backfillPolicyListIndex: work, reconcilePolicyListIndexBatch: work, reconcilePolicyBoStatusBatch: work };
});
import { runWithOperatingTenant, withoutOperatingTenantForTest } from '../../../platform/tenant/tenantAls.js';
import { tenantRowToConfig } from '../../../platform/tenant/tenantConfigProjection.js';
import { handleAccountIntelligenceProjectionBackfill } from '../../../workers/handlers/ACCOUNT_INTELLIGENCE.PROJECTION_BACKFILL.js';
import { handleAccountIntelligenceProjectionReconcile } from '../../../workers/handlers/ACCOUNT_INTELLIGENCE.PROJECTION_RECONCILE.js';
import { handleAccounts360ProjectionBackfill } from '../../../workers/handlers/ACCOUNTS360.PROJECTION_BACKFILL.js';
import { handleAccounts360ProjectionReconcile } from '../../../workers/handlers/ACCOUNTS360.PROJECTION_RECONCILE.js';
import { handlePolicyIndexBackfill } from '../../../workers/handlers/POLICY.INDEX_BACKFILL.js';
import { handlePolicyIndexReconcile } from '../../../workers/handlers/POLICY.INDEX_RECONCILE.js';
import { handlePolicyStateReconcile } from '../../../workers/handlers/POLICY.STATE_RECONCILE.js';
const handlers = [handleAccountIntelligenceProjectionBackfill, handleAccountIntelligenceProjectionReconcile, handleAccounts360ProjectionBackfill, handleAccounts360ProjectionReconcile, handlePolicyIndexBackfill, handlePolicyIndexReconcile, handlePolicyStateReconcile];
const config = (id: string) => tenantRowToConfig({ id, tenantSlug: 'worker-' + id, brandLogos: null, defaultBrokerName: 'Synthetic worker', countryCode: 'CY', country: 'Cyprus', currency: 'EUR', legalPack: 'cy', iptJson: {}, adminFee: 0, publicBaseUrl: 'https://example.invalid', fromEmail: 'test@example.invalid' });
afterEach(() => { vi.unstubAllEnvs(); legacy.mockReset(); seen.length = 0; });
describe('shared batch worker tenant context', () => {
  it('runs every batch handler inside its admitted tenant without reading deployment defaults', async () => {
    vi.stubEnv('KERNEL_PLATFORM_MODE', 'true');
    legacy.mockImplementation(() => { throw new Error('Deployment default must not be used'); });
    for (const id of ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']) await runWithOperatingTenant(config(id), async () => {
      for (const handler of handlers) await handler({ data: { data: { limit: 1, batchSize: 1, maxBatches: 1 } } } as never);
    });
    expect(seen).toEqual([...Array(7).fill('00000000-0000-4000-8000-000000000001'), ...Array(7).fill('00000000-0000-4000-8000-000000000002')]);
    expect(legacy).not.toHaveBeenCalled();
  });
  it('fails every shared batch before projection work when the relay has not admitted a tenant', async () => {
    vi.stubEnv('KERNEL_PLATFORM_MODE', 'true');
    await withoutOperatingTenantForTest(async () => {
      for (const handler of handlers) await expect(handler({ data: {} } as never)).rejects.toThrow();
    });
    expect(seen).toEqual([]); expect(legacy).not.toHaveBeenCalled();
  });
});
