import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import { tenantRowToConfig } from '../../../platform/tenant/tenantConfigProjection.js';
import { runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { assignPlatformIssuanceIdentifiers, formatPolicyId, isReservedPolicyNumber, isReservedQuoteId, reserveNextQuoteId, shouldReassignPolicyNumberAtIssuance } from '../../../platform/utils/platformIds.js';

const tenantData = (id: string) => ({ id, tenantSlug: `number-proof-${id}`, countryCode: 'CY', country: 'Cyprus', currency: 'EUR', kind: 'SYNTHETIC' as const, status: 'ACTIVE' as const, legalPack: 'cy', iptJson: {}, adminFee: 0, publicBaseUrl: 'https://example.invalid', fromEmail: 'test@example.invalid', defaultBrokerName: 'Numbering test', priorityCountries: ['Cyprus'], allowedRiskCountries: ['Cyprus'], defaultNationality: 'United Kingdom', defaultDriversLicenseCountry: 'Cyprus' });
afterEach(() => vi.unstubAllEnvs());
describe('shared platform numbering', () => {
  it('fails closed when the durable counter is unavailable', async () => {
    vi.stubEnv('KERNEL_PLATFORM_MODE', 'true');
    await runWithOperatingTenant(tenantRowToConfig(tenantData(randomUUID())), async () => {
      const tx = { policyNumberSequence: { update: async () => { throw new Error('counter unavailable'); } } };
      await expect(reserveNextQuoteId(tx as never, 'HOME')).rejects.toThrow('counter unavailable');
    });
  });
  it('recognizes concise references for all products and retains historical policy references', () => {
    vi.stubEnv('KERNEL_PLATFORM_MODE', 'true');
    const config = tenantRowToConfig(tenantData(randomUUID()));
    runWithOperatingTenant(config, () => {
      for (const product of ['HOME', 'MOTOR', 'TRAVEL', 'HEALTH', 'COMMERCIAL']) {
        const reference = formatPolicyId(5000001, product);
        expect(reference).toBe(`NUMBER-PROOF-CY-${product}-P5000001`);
        expect(isReservedPolicyNumber(reference)).toBe(true);
        expect(isReservedQuoteId(reference)).toBe(false);
        expect(shouldReassignPolicyNumberAtIssuance(product, reference)).toBe(false);
        expect(shouldReassignPolicyNumberAtIssuance(product, reference.replace('-P5000001', '-Q5000001'))).toBe(true);
      }
      expect(shouldReassignPolicyNumberAtIssuance('HOME', 'BZ/CY5000001')).toBe(false);
      expect(shouldReassignPolicyNumberAtIssuance('MOTOR', 'AB/ST/1000100')).toBe(false);
      expect(() => formatPolicyId(-1, 'HOME')).toThrow();
      expect(() => formatPolicyId(1, '../HOME')).toThrow();
    });
  });
});

describe.runIf(process.env.PLATFORM_TENANT_PG_TEST === '1')('PostgreSQL shared numbering', () => {
  it('assigns globally distinct numbers under identical tenant prefixes, converges concurrent retries and rolls back failures', async () => {
    vi.stubEnv('KERNEL_PLATFORM_MODE', 'true');
    const db = new PrismaClient({ log: [] });
    const tenants = await Promise.all([randomUUID(), randomUUID()].map(id => db.tenant.create({ data: tenantData(id) })));
    const scopes = tenants.map(tenantRowToConfig);
    const ids: string[][] = [[], []];
    const products = ['HOME', 'MOTOR', 'TRAVEL', 'HEALTH', 'COMMERCIAL'];
    const scoped = <T>(index: number, work: Parameters<typeof runTenantScopedTransaction<T>>[0]) => runWithOperatingTenant(scopes[index], () => runTenantScopedTransaction(work));
    try {
      const quotes: string[] = [];
      for (let index = 0; index < 2; index++) await scoped(index, async tx => {
        const holder = await tx.policyHolder.create({ data: { operatingTenantId: tenants[index].id, name: 'Synthetic numbering fixture' } });
        for (const productType of [...products, 'HOME']) {
          const policyNumber = await reserveNextQuoteId(tx, productType); quotes.push(policyNumber);
          const row = await tx.policy.create({ data: { operatingTenantId: tenants[index].id, policyHolderId: holder.id, policyNumber, productType, status: 'BOUND', inceptionDate: new Date('2026-09-08'), expiryDate: new Date('2027-09-08') } });
          ids[index].push(row.id);
        }
      });
      expect(new Set(quotes).size).toBe(12);
      const work = ids.flatMap((rows, index) => rows.slice(0, 5).map(id => scoped(index, tx => assignPlatformIssuanceIdentifiers(tx, id, 'MANUAL'))));
      const assigned = await Promise.all(work);
      expect(new Set(assigned.map(row => row.policyNumber)).size).toBe(10);
      expect(new Set(assigned.map(row => row.certificateNumber)).size).toBe(10);
      expect(assigned.every(row => row.policyNumber.startsWith('NUMBER-PROOF-CY-'))).toBe(true);
      expect(assigned.every(row => isReservedPolicyNumber(row.policyNumber))).toBe(true);
      // Every retry enters a fresh real database transaction and competes for the policy lock.
      const retries = await Promise.all(Array.from({ length: 8 }, (_, index) => scoped(index % 2, tx => assignPlatformIssuanceIdentifiers(tx, ids[index % 2][0], 'ONLINE'))));
      for (let index = 0; index < retries.length; index++) expect(retries[index]).toEqual(assigned[(index % 2) * 5]);
      await expect(scoped(0, tx => assignPlatformIssuanceIdentifiers(tx, ids[1][0], 'MANUAL'))).rejects.toThrow(/active operating tenant/);
      const before = await db.policyNumberSequence.findMany({ where: { key: { startsWith: 'PLATFORM:GLOBAL:' } }, orderBy: { key: 'asc' } });
      await expect(scoped(0, async tx => { await assignPlatformIssuanceIdentifiers(tx, ids[0][5], 'MANUAL'); throw new Error('deliberate rollback'); })).rejects.toThrow('deliberate rollback');
      expect(await db.policyNumberSequence.findMany({ where: { key: { startsWith: 'PLATFORM:GLOBAL:' } }, orderBy: { key: 'asc' } })).toEqual(before);
      await scoped(0, async tx => {
        expect(isReservedQuoteId((await tx.policy.findUniqueOrThrow({ where: { id: ids[0][5] } })).policyNumber)).toBe(true);
        const historical = `Imported-${randomUUID()}`;
        await tx.policy.update({ where: { id: ids[0][5] }, data: { policyNumber: historical, issuedAt: null, status: 'ISSUED' } });
        expect(await assignPlatformIssuanceIdentifiers(tx, ids[0][5], 'MANUAL')).toEqual({ policyNumber: historical, certificateNumber: null });
      });
    } finally {
      for (let index = 0; index < tenants.length; index++) {
        await scoped(index, async tx => { await tx.policy.deleteMany({ where: { operatingTenantId: tenants[index].id } }); await tx.policyHolder.deleteMany({ where: { operatingTenantId: tenants[index].id } }); });
        await db.tenant.delete({ where: { id: tenants[index].id } });
      }
      await db.$disconnect();
    }
  }, 30000);
});
