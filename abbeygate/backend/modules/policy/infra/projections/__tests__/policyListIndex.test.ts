import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  policy: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  policyListIndex: {
    findUnique: vi.fn().mockResolvedValue(null), // null = no existing row; preserves SLA timestamp logic for new rows
    upsert: vi.fn(),
    update: vi.fn(),
  },
  policySearchIndex: {
    upsert: vi.fn(),
  },
};

vi.mock('../../../../../platform/db/connection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../platform/db/connection.js')>();
  return {
    ...actual,
    prisma: {
      ...actual.prisma,
      policy: prismaMock.policy,
      policyListIndex: prismaMock.policyListIndex,
      policySearchIndex: prismaMock.policySearchIndex,
    },
    tenantScopedPrisma: {
      ...actual.tenantScopedPrisma,
      policy: prismaMock.policy,
      policyListIndex: {
        findUnique: prismaMock.policyListIndex.findUnique,
        findMany: vi.fn(async () => []),
        update: prismaMock.policyListIndex.update,
      },
      policySearchIndex: {
        upsert: prismaMock.policySearchIndex.upsert,
      },
    },
  };
});

function mkPolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id || 'pol-1',
    policyNumber: overrides.policyNumber || 'AB-1',
    status: overrides.status || 'ACTIVE',
    expiryDate: overrides.expiryDate ?? null,
    updatedAt: overrides.updatedAt || new Date('2026-02-10T10:00:00.000Z'),
    policyHolder: overrides.policyHolder ?? { name: 'John Doe', address: 'Nicosia' },
    claims: overrides.claims ?? [],
    invoices: overrides.invoices ?? [],
    quoteData: overrides.quoteData ?? {},
    quoteResponse: overrides.quoteResponse ?? { pricing: { total: 123.45 } },
    stateCurrent: overrides.stateCurrent ?? { snapshot: {} },
    riskTransactions: overrides.riskTransactions ?? [],
    segment: overrides.segment ?? 'Auto Insurance',
  };
}

describe('policyListIndex projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues POLICY.INDEX_UPDATE event', async () => {
    const { enqueuePolicyListIndexUpdate } = await import('../policyListIndex.js');
    const outboxCreate = vi.fn(async () => ({ id: 'evt-1' }));
    await enqueuePolicyListIndexUpdate({ outbox: { create: outboxCreate } }, 'pol-123');

    expect(outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aggregateId: 'pol-123',
          eventType: 'POLICY.INDEX_UPDATE',
          payload: expect.objectContaining({
            eventType: 'POLICY.INDEX_UPDATE',
            data: expect.objectContaining({ policyId: 'pol-123' }),
            actorType: 'SYSTEM',
          }),
        }),
      })
    );
  });

  it('rebuilds one index row with computed activity and attention fields', async () => {
    const { rebuildPolicyListIndexRow } = await import('../policyListIndex.js');
    prismaMock.policy.findUnique.mockResolvedValue(
      mkPolicy({
        id: 'pol-2',
        policyNumber: 'AB-2',
        status: 'REFERRAL',
        updatedAt: new Date('2026-02-10T10:00:00.000Z'),
        claims: [
          { status: 'OPEN', updatedAt: new Date('2026-02-11T10:00:00.000Z') },
          { status: 'CLOSED', updatedAt: new Date('2026-02-09T10:00:00.000Z') },
        ],
        invoices: [
          { amount: 40, status: 'OPEN', dueDate: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-02-12T10:00:00.000Z') },
          { amount: 60, status: 'PAID', dueDate: new Date('2026-02-01T00:00:00.000Z'), updatedAt: new Date('2026-02-08T10:00:00.000Z') },
        ],
      })
    );

    await rebuildPolicyListIndexRow('pol-2');

    expect(prismaMock.policyListIndex.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.policyListIndex.update).toHaveBeenCalledTimes(1);
    const payload = prismaMock.policyListIndex.update.mock.calls[0][0];
    expect(payload.where).toEqual({ policyId: 'pol-2' });
    expect(payload.data.openClaimCount).toBe(1);
    expect(payload.data.invoiceOverdue).toBe(true);
    expect(payload.data.outstandingBalance).toBe(40);
    expect(payload.data.attentionBucket).toBe('UW_REFERRAL');
    expect(payload.data.uwActionRequired).toBe(true);
    expect(payload.data.customerActionRequired).toBe(false);
    expect(prismaMock.policySearchIndex.upsert).toHaveBeenCalledTimes(1);
  });

  it('uses annualPremium when product quote responses do not expose costDetails.totalPremium', async () => {
    const { rebuildPolicyListIndexRow } = await import('../policyListIndex.js');
    prismaMock.policy.findUnique.mockResolvedValue(
      mkPolicy({
        id: 'travel-1',
        productType: 'TRAVEL',
        quoteResponse: {
          primaryOption: {
            annualPremium: 190.19,
            costDetails: { subtotalNetPremium: 172.19 },
          },
        },
      })
    );

    await rebuildPolicyListIndexRow('travel-1');

    expect(prismaMock.policySearchIndex.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ totalPremium: 190.19 }),
      }),
    );
  });

  it('reconcile and backfill process policy ids and return counts', async () => {
    const { reconcilePolicyListIndexBatch, backfillPolicyListIndex } = await import('../policyListIndex.js');

    prismaMock.policy.findMany
      .mockResolvedValueOnce([{ id: 'r-1' }, { id: 'r-2' }]) // reconcile
      .mockResolvedValueOnce([{ id: 'b-1' }, { id: 'b-2' }]) // backfill chunk 1
      .mockResolvedValueOnce([{ id: 'b-3' }]) // backfill chunk 2
      .mockResolvedValueOnce([]); // backfill end

    prismaMock.policy.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      mkPolicy({ id: where.id, policyNumber: where.id.toUpperCase() })
    );

    const reconciled = await reconcilePolicyListIndexBatch(2);
    const backfilled = await backfillPolicyListIndex(2, 5);

    expect(reconciled).toBe(2);
    expect(backfilled).toBe(3);
    expect(prismaMock.policyListIndex.upsert).toHaveBeenCalledTimes(5);
    expect(prismaMock.policyListIndex.update).toHaveBeenCalledTimes(5);
  });
});
