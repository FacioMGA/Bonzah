import { afterEach, describe, expect, it, vi } from 'vitest';
const findUnique = vi.hoisted(() => vi.fn());
vi.mock('../../db/connection.js', () => ({ prisma: { tenant: { findUnique } } }));
import { runWithOperatingTenant } from '../tenantAls.js';
import { tenantRowToConfig } from '../tenantConfigProjection.js';
import { runWithOperatingTenantById, loadTenantBySlug } from '../tenantJobContext.js';
const row = { id: '10000000-0000-4000-8000-000000000001', tenantSlug: 'isolated-training', countryCode: 'CY', country: 'Cyprus', currency: 'EUR', legalPack: 'cy', iptJson: { flatFee: 0 }, adminFee: 0, publicBaseUrl: 'https://example.invalid', fromEmail: 'training@example.invalid', brandLogos: null, defaultBrokerName: 'Training', status: 'ACTIVE', parentOrganization: { active: true } };
afterEach(() => { vi.unstubAllEnvs(); findUnique.mockReset(); });
describe('durable worker suspension boundary', () => {
  it('does not invoke a retained job when its organization or tenant is inactive', async () => {
    vi.stubEnv('KERNEL_PLATFORM_MODE', 'true');
    await runWithOperatingTenant(tenantRowToConfig(row), async () => {
    const handler = vi.fn(async () => 'handled');
    for (const mutation of [{ parentOrganization: { active: false } }, { parentOrganization: null }, { status: 'SUSPENDED' }]) {
      findUnique.mockResolvedValue({ ...row, ...mutation });
      await expect(runWithOperatingTenantById(row.id, handler)).rejects.toThrow(/inactive/);
      expect(await loadTenantBySlug(row.tenantSlug)).toBeNull();
    }
    expect(handler).not.toHaveBeenCalled();
    findUnique.mockResolvedValue(row);
    expect(await runWithOperatingTenantById(row.id, handler)).toBe('handled');
    expect(handler).toHaveBeenCalledOnce();
    });
  });
});
