import { beforeEach, describe, expect, it, vi } from 'vitest';

const txMock = {
  policyStateCurrent: { upsert: vi.fn() },
  policySearchIndex: { update: vi.fn() },
  policy: { update: vi.fn() },
  riskTransaction: { findFirst: vi.fn(), create: vi.fn() },
  binderFinancials: { findUnique: vi.fn() },
  premiumTransaction: { create: vi.fn() },
};

const prismaMock = {
  policy: { findUnique: vi.fn() },
  $transaction: vi.fn(),
};

const transitionPolicyLifecycle = vi.fn();
const enqueuePolicyListIndexUpdate = vi.fn();
const evaluateIssueReadiness = vi.fn();
const resolveIndividualScreeningSubject = vi.fn();
const assertClearOrThrow = vi.fn();

function parseJsonValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>;
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

vi.mock('../../../../platform/db/connection.js', () => ({
  prisma: prismaMock,
  tenantScopedPrisma: prismaMock,
}));

vi.mock('../../../../platform/audit/logger.js', () => ({
  AuditLogger: { log: vi.fn() },
}));

vi.mock('../commands/policyLifecycleCommands.js', () => ({
  transitionPolicyLifecycle,
}));

vi.mock('../../infra/projections/policyListIndex.js', () => ({
  enqueuePolicyListIndexUpdate,
}));

vi.mock('../issueReadiness.js', () => ({
  evaluateIssueReadiness,
}));

vi.mock('../../../compliance/app/index.js', () => ({
  getSanctionsService: () => ({ assertClearOrThrow }),
  resolveIndividualScreeningSubject,
  SanctionsBlockError: class SanctionsBlockError extends Error {},
}));

describe('BindCoverage use-case spine', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));
    txMock.policyStateCurrent.upsert.mockResolvedValue(undefined);
    txMock.policySearchIndex.update.mockResolvedValue(undefined);
    txMock.policy.update.mockResolvedValue(undefined);
    txMock.riskTransaction.findFirst.mockResolvedValue({ transactionNumber: 2 });
    txMock.riskTransaction.create.mockResolvedValue({ id: 'rt-3' });
    txMock.binderFinancials.findUnique.mockResolvedValue(null);
    txMock.premiumTransaction.create.mockResolvedValue({ id: 'pt-1' });
    evaluateIssueReadiness.mockResolvedValue({ canIssue: true, blockers: [] });
    resolveIndividualScreeningSubject.mockReturnValue({ subjectName: 'Jane Doe', dateOfBirth: '1985-05-05' });
    assertClearOrThrow.mockResolvedValue(undefined);
    transitionPolicyLifecycle.mockResolvedValue(undefined);
    enqueuePolicyListIndexUpdate.mockResolvedValue(undefined);
  });

  it('preserves existing snapshot data when binding from a stringified snapshot', async () => {
    const { executeBindCoverage } = await import('../BindCoverage.js');

    prismaMock.policy.findUnique.mockResolvedValueOnce({
      id: 'pol-1',
      status: 'QUOTED',
      programId: 'prog-1',
      binderId: 'binder-1',
      inceptionDate: new Date('2026-04-05T00:00:00.000Z'),
      expiryDate: new Date('2027-04-05T00:00:00.000Z'),
      quoteResponse: { premium: 1234 },
      quoteData: { email: 'policy@example.com' },
      stateCurrent: {
        snapshot: JSON.stringify({
          quoteData: { proposer: { email: 'snapshot@example.com', firstName: 'Jane' } },
          pricing: { hash: 'pricing-hash' },
          uw: { lane: 'GREEN' },
        }),
      },
      policyHolder: { name: 'Jane Doe' },
    });

    const result = await executeBindCoverage({
      policyId: 'pol-1',
      actor: { id: 'u1', name: 'Tester', email: 't@example.com', role: 'UNDERWRITER' },
      correlationId: 'corr-1',
    });

    expect(resolveIndividualScreeningSubject).toHaveBeenCalledWith(expect.objectContaining({
      quoteData: expect.objectContaining({ proposer: expect.objectContaining({ email: 'snapshot@example.com' }) }),
    }));
    expect(transitionPolicyLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      policyId: 'pol-1',
      to: 'BOUND',
    }));

    const persistedSnapshot = parseJsonValue(txMock.policyStateCurrent.upsert.mock.calls[0][0].update.snapshot);
    expect(persistedSnapshot).toEqual(expect.objectContaining({
      quoteData: expect.objectContaining({ proposer: expect.objectContaining({ email: 'snapshot@example.com' }) }),
      pricing: { hash: 'pricing-hash' },
      uw: { lane: 'GREEN' },
      binding: expect.objectContaining({
        boundCoverageBy: expect.objectContaining({ id: 'u1' }),
      }),
    }));

    const createdRiskTransaction = txMock.riskTransaction.create.mock.calls[0][0].data;
    const finalSnapshot = parseJsonValue(createdRiskTransaction.snapshotFinal);
    expect(finalSnapshot).toEqual(expect.objectContaining({
      quoteData: expect.objectContaining({ proposer: expect.objectContaining({ email: 'snapshot@example.com' }) }),
      quoteResponse: { premium: 1234 },
      pricing: { hash: 'pricing-hash' },
      uw: { lane: 'GREEN' },
    }));

    expect(result).toEqual({
      status: 'SUCCESS',
      data: {
        status: 'BOUND',
        riskTransactionId: 'rt-3',
      },
    });
  });
});
