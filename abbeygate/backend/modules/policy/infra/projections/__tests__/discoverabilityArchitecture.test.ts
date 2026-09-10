import { beforeEach, describe, expect, it, vi } from 'vitest';

// Architectural contract — the policy-list discoverability writer must
// delegate product-specific projection to the canonical resolver in
// app/discoverability/registry.ts. Earlier shape of this test read
// the writer source and asserted the literal 'MOTOR' was absent. We
// now drive the writer with a fake db delegate and observe that it
// dispatches through resolveProductDiscoverability instead of
// branching on productType internally.

const resolveProductDiscoverabilityMock = vi.fn(() => ({
  insuredName: 'Synthetic Insured',
  insuredDisplay: 'Synthetic Insured',
  vehicleDisplay: 'Synthetic Vehicle',
  policyholderDisplay: 'Synthetic Insured',
  policyholderEmail: null,
  policyholderPhone: null,
  coverageStart: null,
  coverageEnd: null,
  vehicleSearch: null,
  address: null,
  segment: null,
  totalPremium: null,
  renewalDate: null,
  quoteExpiryDate: null,
}));

vi.mock('../../../app/discoverability/registry.js', () => ({
  resolveProductDiscoverability: (args: unknown) => resolveProductDiscoverabilityMock(args),
}));

vi.mock('../../../../../platform/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { upsertPolicyListDiscoverabilityRow } = await import('../discoverabilityWriter.js');
const { resolveProductDiscoverability } = await import('../../../app/discoverability/registry.js');

type FakePolicy = {
  id: string;
  productType: string;
  status: string;
  policyNumber?: string;
  operatingTenantId?: string;
  updatedAt?: Date;
  policyHolder?: { name?: string | null; address?: string | null; contact?: unknown };
};

function fakeDelegate(policy: FakePolicy) {
  const policyListIndexUpsert = vi.fn(async () => undefined);
  const policyListIndexFindUnique = vi.fn(async () => null);
  const policyFindUnique = vi.fn(async () => policy);
  return {
    delegate: {
      policy: { findUnique: policyFindUnique },
      policyListIndex: { findUnique: policyListIndexFindUnique, upsert: policyListIndexUpsert },
    },
    policyListIndexUpsert,
  };
}

describe('discoverability writer architecture boundaries', () => {
  beforeEach(() => {
    resolveProductDiscoverabilityMock.mockClear();
  });

  it('delegates product-specific projection to the canonical resolver', async () => {
    const { delegate, policyListIndexUpsert } = fakeDelegate({
      id: 'pol_motor',
      productType: 'MOTOR',
      status: 'ISSUED',
      policyNumber: 'POL-0001',
      operatingTenantId: 'tenant_test',
      updatedAt: new Date('2026-05-20T00:00:00Z'),
      policyHolder: { name: 'Synthetic', address: 'Synthetic', contact: null },
    });

    const ok = await upsertPolicyListDiscoverabilityRow(delegate, 'pol_motor');

    expect(ok).toBe(true);
    expect(resolveProductDiscoverabilityMock).toHaveBeenCalledTimes(1);
    expect(resolveProductDiscoverabilityMock).toHaveBeenCalledWith(
      expect.objectContaining({ productType: 'MOTOR', status: 'ISSUED' }),
    );
    expect(policyListIndexUpsert).toHaveBeenCalledTimes(1);
  });

  it('does the same delegation for HOME / TRAVEL — no product-specific branches in the writer', async () => {
    for (const productType of ['HOME', 'TRAVEL'] as const) {
      resolveProductDiscoverabilityMock.mockClear();
      const { delegate, policyListIndexUpsert } = fakeDelegate({
        id: `pol_${productType.toLowerCase()}`,
        productType,
        status: 'BOUND',
        policyNumber: `POL-${productType}-1`,
        operatingTenantId: 'tenant_test',
        updatedAt: new Date('2026-05-20T00:00:00Z'),
        policyHolder: { name: 'Synthetic', address: 'Synthetic', contact: null },
      });
      const ok = await upsertPolicyListDiscoverabilityRow(delegate, `pol_${productType.toLowerCase()}`);
      expect(ok).toBe(true);
      expect(resolveProductDiscoverabilityMock).toHaveBeenCalledWith(
        expect.objectContaining({ productType }),
      );
      expect(policyListIndexUpsert).toHaveBeenCalledTimes(1);
    }
  });

  it('exposes the canonical resolver export contract', () => {
    expect(typeof resolveProductDiscoverability).toBe('function');
    expect(typeof upsertPolicyListDiscoverabilityRow).toBe('function');
  });
});
