import { beforeEach, describe, expect, it, vi } from 'vitest';

const txMock = {
  riskTransaction: { update: vi.fn() },
  policyStateCurrent: { update: vi.fn() },
};

const prismaMock = {
  policy: { findFirst: vi.fn() },
  riskTransaction: { findFirst: vi.fn() },
  $transaction: vi.fn(),
};

const enqueueIssuedPolicyPack = vi.fn();

vi.mock('../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: prismaMock,
}));

vi.mock('../../app/commands/issuedPackEnqueue.js', () => ({
  enqueueIssuedPolicyPack,
}));

type Handler = (req: unknown, res: unknown) => Promise<void> | void;

type RouteLayer = {
  route?: {
    path?: string;
    stack?: Array<{ handle?: Handler }>;
  };
};

function getRouteHandler(router: { stack: RouteLayer[] }, path: string): Handler {
  const layer = router.stack.find(
    (entry) => entry.route?.path === path,
  );
  if (!layer) throw new Error(`Route not found: ${path}`);
  const stack = layer.route?.stack || [];
  return stack[stack.length - 1]?.handle as Handler;
}

function mockResponse() {
  const response: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

describe('v1 policies router endorsement bind issued snapshot', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.policy.findFirst.mockResolvedValue({ id: 'policy-1', stateCurrent: { snapshot: {} } });
    prismaMock.riskTransaction.findFirst.mockResolvedValue({
      id: 'risk-transaction-1',
      policyId: 'policy-1',
      status: 'DRAFT',
      transactionType: 'ENDORSEMENT',
      snapshotDraft: JSON.stringify({ endorsement: { limit: 20000 } }),
      pricingFinal: JSON.stringify({
        quoteData: { proposer: { email: 'customer@example.test' } },
        quoteResponse: { primaryOption: { costDetails: { totalPremium: 125 } } },
      }),
    });
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));
    txMock.riskTransaction.update.mockResolvedValue({ id: 'risk-transaction-1' });
    txMock.policyStateCurrent.update.mockResolvedValue({ policyId: 'policy-1' });
    enqueueIssuedPolicyPack.mockResolvedValue({ eventId: 'event-1' });
  });

  it('persists canonical quote payloads in the immutable transaction snapshot before enqueueing issued-pack work', async () => {
    const { default: router } = await import('../v1PoliciesRouter.js');
    const handler = getRouteHandler(router, '/:policyId/endorsements/bind');
    const response = mockResponse();

    await handler({
      params: { policyId: 'policy-1' },
      apiAccount: { id: 'account-1' },
      correlationId: 'correlation-1',
      body: { quoteId: '11111111-1111-4111-8111-111111111111' },
    }, response);

    const finalSnapshot = JSON.parse(txMock.riskTransaction.update.mock.calls[0]?.[0].data.snapshotFinal);
    expect(finalSnapshot).toEqual(expect.objectContaining({
      endorsement: { limit: 20000 },
      quoteData: { proposer: { email: 'customer@example.test' } },
      quoteResponse: { primaryOption: { costDetails: { totalPremium: 125 } } },
    }));
    expect(enqueueIssuedPolicyPack).toHaveBeenCalledWith(txMock, expect.objectContaining({
      policyId: 'policy-1',
      riskTransactionId: 'risk-transaction-1',
    }));
  });
});
