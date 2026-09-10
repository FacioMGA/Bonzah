import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerPolicyCancellationRoutes } from '../../../modules/policy/http/cancellationsRouter.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { registerAllProducts } from '../../../products/registerProducts.js';

const { transitionPolicyLifecycle, enqueuePolicyListIndexUpdate } = vi.hoisted(() => ({
  transitionPolicyLifecycle: vi.fn(),
  enqueuePolicyListIndexUpdate: vi.fn(),
}));

vi.mock('../../../platform/db/connection.js', () => {
  const prisma = {
    policy: { findUnique: vi.fn(), update: vi.fn() },
    policySearchIndex: { update: vi.fn() },
    policyStateCurrent: { findUnique: vi.fn(), upsert: vi.fn() },
    outbox: { create: vi.fn() },
    $transaction: vi.fn(async (cb: (p: typeof prisma) => unknown) => cb((await import('../../../platform/db/connection.js')).prisma)),
  };
  return { prisma, tenantScopedPrisma: prisma, runTenantScopedTransaction: prisma.$transaction };
});

vi.mock('../../../platform/audit/logger.js', () => ({
  AuditLogger: { log: vi.fn() },
}));

vi.mock('../../../modules/policy/app/commands/policyLifecycleCommands.js', () => ({
  transitionPolicyLifecycle,
}));

vi.mock('../../../modules/policy/app/policyListIndex.js', () => ({
  enqueuePolicyListIndexUpdate,
}));

registerAllProducts();

function mockRes() {
  const res: { status?: ReturnType<typeof vi.fn>; json?: ReturnType<typeof vi.fn> } = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function buildRouter() {
  const routes: Record<string, unknown> = {};
  return {
    routes,
    post: vi.fn((path: string, ...handlers: unknown[]) => {
      routes[`POST ${path}`] = handlers[handlers.length - 1];
    }),
  };
}

describe('cancellation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tenantScopedPrisma.policy.update).mockResolvedValue({ updatedAt: new Date() });
    vi.mocked(tenantScopedPrisma.policySearchIndex.update).mockResolvedValue({});
    vi.mocked(tenantScopedPrisma.policyStateCurrent.findUnique).mockResolvedValue(null);
    vi.mocked(tenantScopedPrisma.policyStateCurrent.upsert).mockResolvedValue({});
    vi.mocked(tenantScopedPrisma.outbox.create).mockResolvedValue({});
    transitionPolicyLifecycle.mockResolvedValue(undefined);
    enqueuePolicyListIndexUpdate.mockResolvedValue(undefined);
  });

  it('includes the policy-holder email in the cancellation-requested outbox event', async () => {
    const router = buildRouter();
    registerPolicyCancellationRoutes(router);
    const handler = router.routes['POST /:id/cancellation/request'] as (req: unknown, res: unknown) => Promise<void>;
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const requestedEffectiveDate = tomorrow.toISOString().slice(0, 10);

    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
      id: 'p-request',
      policyNumber: 'ABQ-REQUEST',
      status: 'ACTIVE',
      inceptionDate: new Date(Date.UTC(2026, 0, 1)),
      expiryDate: new Date(Date.UTC(2027, 0, 1)),
      stateCurrent: { snapshot: {} },
      policyHolder: { contact: JSON.stringify({ email: 'customer@example.com' }) },
    });

    const res = mockRes();
    await handler({
      params: { id: 'p-request' },
      body: { requestedEffectiveDate },
      user: { id: 'u-request', name: 'Tester' },
      headers: {},
    }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(tenantScopedPrisma.outbox.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'EMAIL.CANCELLATION_REQUESTED',
        payload: expect.objectContaining({
          policyId: 'p-request',
          to: 'customer@example.com',
        }),
      }),
    }));
  });

  it('accepts a standalone policy-holder email when queuing cancellation correspondence', async () => {
    const router = buildRouter();
    registerPolicyCancellationRoutes(router);
    const handler = router.routes['POST /:id/cancellation/request'] as (req: unknown, res: unknown) => Promise<void>;
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
      id: 'p-standalone-email',
      policyNumber: 'ABQ-STANDALONE',
      status: 'ACTIVE',
      inceptionDate: new Date(Date.UTC(2026, 0, 1)),
      expiryDate: new Date(Date.UTC(2027, 0, 1)),
      stateCurrent: { snapshot: {} },
      policyHolder: { contact: 'customer@example.com' },
    });

    const res = mockRes();
    await handler({
      params: { id: 'p-standalone-email' },
      body: { requestedEffectiveDate: tomorrow.toISOString().slice(0, 10) },
      user: { id: 'u-request', name: 'Tester' },
      headers: {},
    }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(tenantScopedPrisma.outbox.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        payload: expect.objectContaining({ to: 'customer@example.com' }),
      }),
    }));
  });

  it('does not write an invalid cancellation-requested event without a policy-holder email', async () => {
    const router = buildRouter();
    registerPolicyCancellationRoutes(router);
    const handler = router.routes['POST /:id/cancellation/request'] as (req: unknown, res: unknown) => Promise<void>;

    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
      id: 'p-missing-email',
      policyNumber: 'ABQ-NO-EMAIL',
      status: 'ACTIVE',
      inceptionDate: new Date(Date.UTC(2026, 0, 1)),
      expiryDate: new Date(Date.UTC(2027, 0, 1)),
      stateCurrent: { snapshot: {} },
      policyHolder: { contact: JSON.stringify({ phone: '+35700000000' }) },
    });

    const res = mockRes();
    await handler({
      params: { id: 'p-missing-email' },
      body: { requestedEffectiveDate: '2026-08-29' },
      user: { id: 'u-request', name: 'Tester' },
      headers: {},
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'POLICY_HOLDER_EMAIL_REQUIRED' }),
    }));
    expect(transitionPolicyLifecycle).not.toHaveBeenCalled();
    expect(tenantScopedPrisma.outbox.create).not.toHaveBeenCalled();
  });

  it('supports override path when claim exists and logs audit', async () => {
    const router = buildRouter();
    registerPolicyCancellationRoutes(router);
    const handler = router.routes['POST /:id/cancellation/approve'];
    expect(handler).toBeTruthy();

    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
      id: 'p1',
      policyNumber: 'ABQ1',
      status: 'CANCELLATION_REQUESTED',
      inceptionDate: new Date(Date.now() - 5 * 24 * 3600 * 1000),
      expiryDate: new Date(Date.now() + 360 * 24 * 3600 * 1000),
      stateCurrent: {
        snapshot: {
          quoteData: { hasClaims: true },
          quoteResponse: {
            primaryOption: {
              costDetails: { subtotalNetPremium: 400, tax: 9 },
              calculationTrace: { steps: [{ id: 'endorsement.premium.COV-ROADSIDE', amount: 86 }] },
            },
          },
        },
      },
      policyHolder: { contact: JSON.stringify({ email: 'a@b.com' }) },
    });

    const req = {
      params: { id: 'p1' },
      body: {
        hasClaim: true,
        overrideNoRefund: true,
        overrideReason: 'Manual underwriter decision',
      },
      user: { id: 'u1', name: 'Tester' },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(AuditLogger.log).toHaveBeenCalledWith(
      'p1',
      'POLICY',
      'CANCELLATION.APPROVED',
      'u1',
      'USER',
      expect.objectContaining({ refundAmount: expect.any(Number) }),
      'Tester'
    );
    expect(tenantScopedPrisma.policyStateCurrent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          snapshot: expect.objectContaining({
            cancellation: expect.objectContaining({
              checks: expect.objectContaining({
                overrideNoRefund: true,
                overrideReason: 'Manual underwriter decision',
              }),
            }),
          }),
        }),
      })
    );
  });

  it('floors negative refund to zero', async () => {
    const router = buildRouter();
    registerPolicyCancellationRoutes(router);
    const handler = router.routes['POST /:id/cancellation/approve'];

    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
      id: 'p2',
      policyNumber: 'ABQ2',
      status: 'CANCELLATION_REQUESTED',
      inceptionDate: new Date(Date.now() - 5 * 24 * 3600 * 1000),
      expiryDate: new Date(Date.now() + 360 * 24 * 3600 * 1000),
      stateCurrent: {
        snapshot: {
          quoteData: { hasClaims: false },
          quoteResponse: {
            primaryOption: {
              costDetails: { subtotalNetPremium: 20, tax: 9 },
              calculationTrace: { steps: [{ id: 'endorsement.premium.COV-ROADSIDE', amount: 86 }] },
            },
          },
        },
      },
      policyHolder: { contact: JSON.stringify({ email: 'x@y.com' }) },
    });

    const req = { params: { id: 'p2' }, body: {}, user: { id: 'u1', name: 'Tester' } };
    const res = mockRes();
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ refundAmount: 0 }),
      })
    );
  });
});
