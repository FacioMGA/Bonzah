import { beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertPolicyListDiscoverabilityRow } from '../discoverabilityWriter.js';
import { registerAllProducts } from '../../../../../products/registerProducts.js';

registerAllProducts();

describe('upsertPolicyListDiscoverabilityRow', () => {
  type WriterDb = Parameters<typeof upsertPolicyListDiscoverabilityRow>[0];
  const dbMock = {
    policy: {
      findUnique: vi.fn(),
    },
    policyListIndex: {
      upsert: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when delegates are missing', async () => {
    const noDelegates: WriterDb = {};
    const did = await upsertPolicyListDiscoverabilityRow(noDelegates, 'pol-1');
    expect(did).toBe(false);
  });

  it('upserts minimal discoverability projection', async () => {
    dbMock.policy.findUnique.mockResolvedValue({
      id: 'pol-1',
      policyNumber: 'ABQ1001',
      productType: 'MOTOR',
      status: 'QUOTED',
      bo_status: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      inceptionDate: null,
      expiryDate: null,
      quoteData: { proposer: { firstName: 'Ada', lastName: 'Lovelace' }, year: 2020, make: 'VW', model: 'Golf' },
      quoteResponse: { pricing: { total: 123.45 } },
      vehicleInfo: {},
      policyHolder: { name: null, address: null, contact: { email: 'ada@example.com', phone: '+441234' } },
    });

    const typedDbMock: WriterDb = dbMock;
    const did = await upsertPolicyListDiscoverabilityRow(typedDbMock, 'pol-1');
    expect(did).toBe(true);
    expect(dbMock.policyListIndex.upsert).toHaveBeenCalledTimes(1);
    expect(dbMock.policyListIndex.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { policyId: 'pol-1' },
        create: expect.objectContaining({
          policyNumber: 'ABQ1001',
          insuredName: 'Ada Lovelace',
          insuredDisplay: 'Ada Lovelace',
          vehicleDisplay: '2020 VW Golf',
          policyholderDisplay: 'Ada Lovelace',
          policyholderEmail: 'ada@example.com',
          policyholderPhone: '+441234',
          status: 'QUOTED',
        }),
        update: expect.objectContaining({
          policyNumber: 'ABQ1001',
          insuredName: 'Ada Lovelace',
          insuredDisplay: 'Ada Lovelace',
          status: 'QUOTED',
          indexVersion: { increment: 1 },
        }),
      }),
    );
  });
});

