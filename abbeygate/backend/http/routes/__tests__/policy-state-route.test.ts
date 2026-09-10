import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPolicyStateRoutes } from '../../../modules/policy/http/stateRouter.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';

vi.mock('../../../platform/db/connection.js', () => {
  const prisma = {
    policy: { findUnique: vi.fn() },
    riskTransaction: { findMany: vi.fn() },
  };
  return { prisma, tenantScopedPrisma: prisma };
});

vi.mock('../../../modules/policy/domain/issueReadiness.js', () => ({
  evaluateIssueReadiness: vi.fn(async () => ({ canIssue: true })),
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
    get: vi.fn((path: string, _audit: unknown, handler: unknown) => {
      routes[`GET ${path}`] = handler;
    }),
  };
}

describe('policy state route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns derived bo_status and state payload', async () => {
    const router = buildRouter();
    registerPolicyStateRoutes(router as never);
    const handler = router.routes['GET /:id/state'] as (req: unknown, res: unknown) => Promise<void>;

    const policyRecord = {
      id: 'p1',
      policyNumber: 'AB-100',
      status: 'CANCELLATION_REQUESTED',
      inceptionDate: new Date('2026-01-01T00:00:00.000Z'),
      expiryDate: new Date('2027-01-01T00:00:00.000Z'),
      isLocked: false,
      stateCurrent: { snapshot: { cancellationRequest: { status: 'PROCESSING' } } },
      claims: [{ status: 'OPEN' }],
    };
    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue(policyRecord as never);
    vi.mocked(tenantScopedPrisma.riskTransaction.findMany).mockResolvedValue([]);

    const res = mockRes();
    await handler({ params: { id: 'p1' } }, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          policyId: 'p1',
          bo_status: 'CANCELLATION_REQUESTED',
          state: expect.objectContaining({ hasOpenClaims: true }),
        }),
      })
    );
  });
});
