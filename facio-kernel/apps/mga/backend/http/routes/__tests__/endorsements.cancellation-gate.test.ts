import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPolicyEndorsementRoutes } from '../../../modules/policy/http/endorsementsRouter.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';

vi.mock('../../../platform/db/connection.js', () => {
  const prisma = {
    policy: { findUnique: vi.fn() },
    riskTransaction: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    policyStateCurrent: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma, tenantScopedPrisma: prisma };
});

vi.mock('../../../platform/audit/logger.js', () => ({
  AuditLogger: { log: vi.fn() },
}));

function mockRes() {
  const res: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function buildRouter() {
  const routes: Record<string, unknown> = {};
  return {
    routes,
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn((path: string, _audit: unknown, handler: unknown) => {
      routes[`POST ${path}`] = handler;
    }),
  };
}

describe('endorsement draft cancellation status gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tenantScopedPrisma.riskTransaction.findMany).mockResolvedValue([]);
    vi.mocked(tenantScopedPrisma.riskTransaction.findFirst).mockImplementation(async (args: unknown) => {
      const where = (args as { where?: Record<string, unknown> })?.where || {};
      if (where?.status === 'BOUND') {
        const boundTxn: Awaited<ReturnType<typeof tenantScopedPrisma.riskTransaction.findFirst>> = {
          id: 'rt-bound',
          transactionNumber: 9,
          snapshotFinal: { quoteData: {} },
        };
        return boundTxn;
      }
      const lastTxn: Awaited<ReturnType<typeof tenantScopedPrisma.riskTransaction.findFirst>> = { transactionNumber: 9 };
      return lastTxn;
    });
    const createdTxn: Awaited<ReturnType<typeof tenantScopedPrisma.riskTransaction.create>> = {
      id: 'rt-draft',
      transactionNumber: 10,
    };
    vi.mocked(tenantScopedPrisma.riskTransaction.create).mockResolvedValue(createdTxn);
    vi.mocked(tenantScopedPrisma.riskTransaction.update).mockResolvedValue(null as never);
    vi.mocked(tenantScopedPrisma.policyStateCurrent.findUnique).mockResolvedValue(null as never);
    vi.mocked(tenantScopedPrisma.policyStateCurrent.upsert).mockResolvedValue(null as never);
    vi.mocked(tenantScopedPrisma.$transaction).mockImplementation(async (cb: (tx: typeof tenantScopedPrisma) => unknown) => cb(tenantScopedPrisma));
  });

  it('blocks non-cancellation draft on CANCELLATION_REQUESTED policy', async () => {
    const router = buildRouter();
    registerPolicyEndorsementRoutes(router as never);
    const handler = router.routes['POST /:id/endorsements/draft'] as (req: unknown, res: unknown) => Promise<void>;

    const policyBlocked: Awaited<ReturnType<typeof tenantScopedPrisma.policy.findUnique>> = {
      id: 'p1',
      status: 'CANCELLATION_REQUESTED',
      stateCurrent: { snapshot: {} },
    };
    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue(policyBlocked);

    const req = { params: { id: 'p1' }, body: { effectiveDate: '2026-02-20' }, user: { id: 'u1' } };
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'INVALID_STATUS' }),
      })
    );
  });

  it('allows cancellation draft on CANCELLATION_REQUESTED policy', async () => {
    const router = buildRouter();
    registerPolicyEndorsementRoutes(router as never);
    const handler = router.routes['POST /:id/endorsements/draft'] as (req: unknown, res: unknown) => Promise<void>;

    const policyAllowed: Awaited<ReturnType<typeof tenantScopedPrisma.policy.findUnique>> = {
      id: 'p2',
      status: 'CANCELLATION_REQUESTED',
      programId: null,
      binderId: null,
      expiryDate: null,
      stateCurrent: {
        snapshot: {
          cancellationRequest: {
            status: 'RECEIVED',
            requestedBy: 'u1',
            requestedEffectiveDate: '2026-02-20',
          },
        },
      },
    };
    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue(policyAllowed);

    const req = {
      params: { id: 'p2' },
      body: { effectiveDate: '2026-02-20', reasonCode: 'CANCELLATION', reason: 'Customer requested' },
      user: { id: 'u1' },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ riskTransactionId: 'rt-draft' }),
      })
    );
    expect(tenantScopedPrisma.policyStateCurrent.upsert).toHaveBeenCalledTimes(1);
    const upsert = vi.mocked(tenantScopedPrisma.policyStateCurrent.upsert).mock.calls[0]?.[0];
    const snapshot = upsert?.update?.snapshot;
    expect(snapshot).toEqual(expect.objectContaining({
      endorsementWorkspace: expect.objectContaining({ reasonCode: 'CANCELLATION' }),
      cancellationRequest: expect.objectContaining({
        status: 'PROCESSING',
        requestedBy: 'u1',
        requestedEffectiveDate: '2026-02-20',
        processingBy: 'u1',
      }),
      flow_context: { channel: 'backoffice', step: 'premium' },
    }));
    expect(tenantScopedPrisma.riskTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'rt-draft' },
      data: expect.objectContaining({ snapshotDraft: expect.anything() }),
    }));
  });

  it('restores an existing cancellation draft and keeps the request PROCESSING', async () => {
    const router = buildRouter();
    Reflect.apply(registerPolicyEndorsementRoutes, undefined, [router]);
    const handler = router.routes['POST /:id/endorsements/draft'] as (req: unknown, res: unknown) => Promise<void>;

    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
      id: 'p3',
      status: 'CANCELLATION_REQUESTED',
      stateCurrent: { snapshot: { cancellationRequest: { status: 'RECEIVED', requestedBy: 'u1' } } },
    });
    vi.mocked(tenantScopedPrisma.riskTransaction.findMany).mockResolvedValue([{
      id: 'rt-existing',
      policyId: 'p3',
      transactionType: 'ENDORSEMENT',
      transactionNumber: 4,
      status: 'DRAFT',
      snapshotDraft: {
        quoteData: { product: 'travel' },
        endorsementWorkspace: { reasonCode: 'CANCELLATION' },
      },
    }]);

    const res = mockRes();
    await handler({
      params: { id: 'p3' },
      body: { effectiveDate: '2026-02-20', reasonCode: 'CANCELLATION' },
      user: { id: 'u1' },
    }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ riskTransactionId: 'rt-existing', deduped: true }),
    }));
    expect(tenantScopedPrisma.riskTransaction.create).not.toHaveBeenCalled();
    const upsert = vi.mocked(tenantScopedPrisma.policyStateCurrent.upsert).mock.calls[0]?.[0];
    const snapshot = upsert?.update?.snapshot;
    expect(snapshot).toEqual(expect.objectContaining({
      quoteData: { product: 'travel' },
      endorsementWorkspace: { reasonCode: 'CANCELLATION' },
      cancellationRequest: expect.objectContaining({ status: 'PROCESSING' }),
    }));
  });
});
