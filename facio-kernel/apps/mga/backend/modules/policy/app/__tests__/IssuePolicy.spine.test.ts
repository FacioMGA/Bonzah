import { beforeEach, describe, expect, it, vi } from 'vitest';

const txMock = {
  policy: { update: vi.fn() },
  policySearchIndex: { update: vi.fn() },
  policyStateCurrent: { upsert: vi.fn() },
  outbox: { create: vi.fn() },
};

const prismaMock = {
  policy: { findUnique: vi.fn(), update: vi.fn() },
  riskTransaction: { findFirst: vi.fn() },
  $transaction: vi.fn(),
};

const transitionPolicyLifecycle = vi.fn();
const enqueuePolicyListIndexUpdate = vi.fn();
const evaluateIssueReadiness = vi.fn();
const resolveIndividualScreeningSubject = vi.fn();
const assertClearOrThrow = vi.fn();
const determinePostBindLifecycleStatus = vi.fn();
const assertCanIssuePolicy = vi.fn();
const enqueueIssuedPolicyPackMock = vi.fn();
const appendDomainEventMock = vi.fn();

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

vi.mock('../domain/issuance.js', () => ({
  assertCanIssuePolicy,
  determinePostBindLifecycleStatus,
}));

vi.mock('../commands/issuedPackEnqueue.js', () => ({
  enqueueIssuedPolicyPack: (...args: unknown[]) => enqueueIssuedPolicyPackMock(...args),
}));

vi.mock('../../../../platform/events/domainEvents.js', () => ({
  appendDomainEvent: (...args: unknown[]) => appendDomainEventMock(...args),
  buildDomainEvent: (input: unknown) => input,
}));

describe('IssuePolicy use-case spine (ADR-0013 single path)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));
    txMock.policy.update.mockResolvedValue({ updatedAt: new Date('2026-04-05T10:00:00.000Z') });
    txMock.policySearchIndex.update.mockResolvedValue(undefined);
    txMock.policyStateCurrent.upsert.mockResolvedValue(undefined);
    evaluateIssueReadiness.mockResolvedValue({ canIssue: true, blockers: [] });
    resolveIndividualScreeningSubject.mockReturnValue({ subjectName: 'Jane Doe', dateOfBirth: '1985-05-05' });
    assertClearOrThrow.mockResolvedValue(undefined);
    determinePostBindLifecycleStatus.mockReturnValue('ACTIVE');
    assertCanIssuePolicy.mockImplementation(() => undefined);
    transitionPolicyLifecycle.mockResolvedValue(undefined);
    enqueuePolicyListIndexUpdate.mockResolvedValue(undefined);
    enqueueIssuedPolicyPackMock.mockResolvedValue({ eventId: 'evt-issued-pack-1' });
    appendDomainEventMock.mockResolvedValue(undefined);
  });

  it('returns INVALID_STATUS from domain gate when policy is not issuable', async () => {
    const { executeIssuePolicy } = await import('../IssuePolicy.js');
    assertCanIssuePolicy.mockImplementation(() => {
      throw new Error('Invalid status');
    });

    prismaMock.policy.findUnique.mockResolvedValueOnce({
      id: 'pol-1',
      status: 'QUOTED',
      inceptionDate: new Date().toISOString(),
      stateCurrent: null,
      policyHolder: null,
      quoteData: {},
    });

    const result = await executeIssuePolicy({
      policyId: 'pol-1',
      actor: { id: 'u1', name: 'Tester', email: 't@example.com', role: 'UNDERWRITER' },
      correlationId: 'corr-1',
    });

    expect(result.status).toBe('INVALID_STATUS');
    if (result.status !== 'INVALID_STATUS') return;
    expect(result.error).toEqual(expect.objectContaining({ code: 'INVALID_STATUS' }));
    expect(enqueueIssuedPolicyPackMock).not.toHaveBeenCalled();
  });

  it('uses snapshot quoteData, transitions BOUND -> ISSUING -> ACTIVE, and enqueues the spine inside the lifecycle tx', async () => {
    const { executeIssuePolicy } = await import('../IssuePolicy.js');

    prismaMock.policy.findUnique.mockResolvedValueOnce({
      id: 'pol-1',
      status: 'BOUND',
      inceptionDate: new Date('2026-04-05T00:00:00.000Z'),
      issuedAt: null,
      publicSessionToken: null,
      stateCurrent: {
        snapshot: JSON.stringify({
          quoteData: { proposer: { firstName: 'Jane', email: 'snapshot@example.com' } },
          pricing: { hash: 'pricing-hash' },
          uw: { lane: 'GREEN' },
        }),
      },
      policyHolder: { name: 'Jane Doe', contact: null },
      quoteData: { proposer: { email: 'policy@example.com' } },
      policyNumber: 'P-100',
    });
    prismaMock.riskTransaction.findFirst.mockResolvedValueOnce({ id: 'rt-1' });

    const result = await executeIssuePolicy({
      policyId: 'pol-1',
      actor: { id: 'u1', name: 'Tester', email: 't@example.com', role: 'UNDERWRITER' },
      correlationId: 'corr-1',
    });

    expect(resolveIndividualScreeningSubject).toHaveBeenCalledWith(expect.objectContaining({
      quoteData: expect.objectContaining({ proposer: expect.objectContaining({ email: 'snapshot@example.com' }) }),
    }));
    expect(transitionPolicyLifecycle).toHaveBeenCalledTimes(2);
    expect(transitionPolicyLifecycle.mock.calls.map(([arg]) => arg.to)).toEqual(['ISSUING', 'ACTIVE']);
    expect(txMock.policySearchIndex.update).toHaveBeenCalledWith({
      where: { policyId: 'pol-1' },
      data: { status: 'ACTIVE' },
    });

    // ADR-0013 — the issued-pack outbox row MUST be written through the
    // canonical helper, with the supplied tx, and an idempotency key
    // derived from (policyId, riskTransactionId). Any deviation is a
    // duplicate-spine regression.
    expect(enqueueIssuedPolicyPackMock).toHaveBeenCalledTimes(1);
    expect(enqueueIssuedPolicyPackMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        policyId: 'pol-1',
        riskTransactionId: 'rt-1',
        source: 'BO',
        idempotencyKey: 'issued-pack:pol-1:rt-1',
      }),
    );

    const persistedSnapshot = parseJsonValue(txMock.policyStateCurrent.upsert.mock.calls[0][0].update.snapshot);
    expect(persistedSnapshot).toEqual(expect.objectContaining({
      pricing: { hash: 'pricing-hash' },
      uw: { lane: 'GREEN' },
      issuance: expect.objectContaining({
        issuedBy: expect.objectContaining({ id: 'u1' }),
      }),
    }));

    expect(result).toEqual({
      status: 'SUCCESS',
      data: expect.objectContaining({
        status: 'ACTIVE',
        riskTransactionId: 'rt-1',
        issuedPackJobId: 'evt-issued-pack-1',
      }),
    });
  });

  it('migration-quiet issuance (suppressIssuedPack) issues the policy but skips the doc-pack/welcome-email spine', async () => {
    const { executeIssuePolicy } = await import('../IssuePolicy.js');

    prismaMock.policy.findUnique.mockResolvedValueOnce({
      id: 'pol-mig',
      status: 'BOUND',
      inceptionDate: new Date('2026-04-05T00:00:00.000Z'),
      issuedAt: null,
      publicSessionToken: null,
      stateCurrent: {
        snapshot: JSON.stringify({ quoteData: { proposer: { firstName: 'Hist', email: 'bdx-import@import.local' } } }),
      },
      policyHolder: { name: 'Historical Insured', contact: null },
      quoteData: {},
      policyNumber: 'BZ/ABG/00005590SS',
    });
    prismaMock.riskTransaction.findFirst.mockResolvedValueOnce({ id: 'rt-mig' });

    const result = await executeIssuePolicy({
      policyId: 'pol-mig',
      actor: { id: 'system', name: 'BDX', email: null, role: 'SYSTEM' },
      correlationId: 'bdx-run-1',
      suppressIssuedPack: true,
    });

    expect(result.status).toBe('SUCCESS');
    // Policy is still fully issued: lifecycle transition + index/state projection run.
    expect(transitionPolicyLifecycle.mock.calls.map(([arg]) => arg.to)).toEqual(['ISSUING', 'ACTIVE']);
    expect(enqueuePolicyListIndexUpdate).toHaveBeenCalled();
    // But NO doc-pack / welcome-email side-effect is emitted for the migrated policy.
    expect(enqueueIssuedPolicyPackMock).not.toHaveBeenCalled();
    if (result.status === 'SUCCESS') {
      expect((result.data as { issuedPackJobId?: string }).issuedPackJobId).toBeUndefined();
    }
  });

  it('queues the external issued-document email in the same canonical issuance transaction', async () => {
    const { executeIssuePolicy } = await import('../IssuePolicy.js');
    prismaMock.policy.findUnique.mockResolvedValueOnce({
      id: 'pol-open-market', productType: 'MOTOR', status: 'BOUND', inceptionDate: new Date(), issuedAt: null,
      stateCurrent: { snapshot: JSON.stringify({ quoteData: { proposer: { email: 'customer@example.test' } } }) },
      policyHolder: { name: 'Customer', contact: null }, quoteData: {}, policyNumber: 'AB/ST/5000001',
    });
    prismaMock.riskTransaction.findFirst.mockResolvedValueOnce({ id: 'rt-open-market' });

    const result = await executeIssuePolicy({
      policyId: 'pol-open-market',
      actor: { id: 'manager-1', name: 'Manager', email: 'manager@example.test', role: 'UNDERWRITER' },
      suppressIssuedPack: true,
      externalDocumentEmail: { documentIds: ['doc-1', 'doc-2', 'doc-3'] },
    });

    expect(result.status).toBe('SUCCESS');
    expect(appendDomainEventMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        eventType: 'EMAIL.EXTERNAL_ISSUANCE_DOCUMENTS_READY',
        data: { policyId: 'pol-open-market', documentIds: ['doc-1', 'doc-2', 'doc-3'] },
        idempotencyKey: 'external-issuance-documents:pol-open-market:rt-open-market',
      }),
    );
  });

  it.each(['MOTOR', 'HOME', 'TRAVEL', 'HEALTH'])(
    'BO issue-policy for %s uses the same canonical issued-pack spine',
    async (productType) => {
      const { executeIssuePolicy } = await import('../IssuePolicy.js');

      const brandedPolicyNumberByProduct: Record<string, string> = {
        MOTOR: 'AB/ST/5000100',
        HOME: 'BZ/CY5000001',
        TRAVEL: 'DIRECT/BRIT/ABG/CY/5000010',
        HEALTH: 'BRIT/ABG/CY/IM/5001025',
      };

      prismaMock.policy.findUnique.mockResolvedValueOnce({
        id: `pol-${productType.toLowerCase()}`,
        productType,
        status: 'BOUND',
        inceptionDate: new Date('2026-04-05T00:00:00.000Z'),
        issuedAt: null,
        publicSessionToken: null,
        stateCurrent: {
          snapshot: JSON.stringify({
            quoteData: { proposer: { firstName: 'Ada', email: `${productType.toLowerCase()}@example.com` } },
            quoteResponse: { status: 'QUOTED', primaryOption: { annualPremium: 100 } },
          }),
        },
        policyHolder: { name: `${productType} Holder`, contact: null },
        quoteData: {},
        policyNumber: brandedPolicyNumberByProduct[productType],
      });
      prismaMock.riskTransaction.findFirst.mockResolvedValueOnce({ id: `rt-${productType.toLowerCase()}` });

      const result = await executeIssuePolicy({
        policyId: `pol-${productType.toLowerCase()}`,
        actor: { id: 'u1', name: 'Tester', email: 't@example.com', role: 'UNDERWRITER' },
        correlationId: `corr-${productType.toLowerCase()}`,
      });

      expect(result.status).toBe('SUCCESS');
      expect(enqueueIssuedPolicyPackMock).toHaveBeenCalledWith(
        txMock,
        expect.objectContaining({
          policyId: `pol-${productType.toLowerCase()}`,
          riskTransactionId: `rt-${productType.toLowerCase()}`,
          source: 'BO',
          idempotencyKey: `issued-pack:pol-${productType.toLowerCase()}:rt-${productType.toLowerCase()}`,
          correlationId: `corr-${productType.toLowerCase()}`,
        }),
      );
    },
  );
});
