import { beforeEach, describe, expect, it, vi } from 'vitest';

const { routes, executeWorksheetCommand, customerCanAccessPolicy, listCustomerOwnedPolicyIds } = vi.hoisted(() => {
  const routes: { [route: string]: (req: unknown, res: unknown) => Promise<void> } = {};
  return {
    routes,
    executeWorksheetCommand: vi.fn(),
    customerCanAccessPolicy: vi.fn(),
    listCustomerOwnedPolicyIds: vi.fn(),
  };
});

type RouteHandler = (req: unknown, res: unknown) => Promise<void>;

vi.mock('express', () => ({
  Router: () => ({
    get: vi.fn((path: string, ...handlers: unknown[]) => {
      routes[`GET ${path}`] = handlers[handlers.length - 1] as RouteHandler;
    }),
    post: vi.fn((path: string, ...handlers: unknown[]) => {
      routes[`POST ${path}`] = handlers[handlers.length - 1] as RouteHandler;
    }),
  }),
}));

vi.mock('../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    claim: {
      findUnique: vi.fn(async () => ({ id: 'claim-1', policyId: 'policy-1' })),
    },
    policy: { findUnique: vi.fn(async () => ({ programId: 'program-1', binderId: 'binder-1', productType: 'HOME' })) },
  },
}));

vi.mock('../../../insuranceConfiguration/app/journeyCapabilities.js', () => ({
  assertPolicyJourneyAction: vi.fn(async () => ({ workflow: {} })),
}));

vi.mock('../../../policy/app/customerPolicyAccess.js', () => ({
  customerCanAccessPolicy: (...args: unknown[]) => customerCanAccessPolicy(...args),
  listCustomerOwnedPolicyIds: (...args: unknown[]) => listCustomerOwnedPolicyIds(...args),
}));

vi.mock('../../app/httpConductorDeps.js', () => ({
  claimsHttpDeps: {
    normalizeCanonicalIntake: (value: unknown) => value,
  },
}));

vi.mock('../../app/commands/executeWorksheetCommand.js', () => ({
  executeWorksheetCommand: (...args: unknown[]) => executeWorksheetCommand(...args),
}));

vi.mock('../../app/queries/getClaimWorksheetView.js', () => ({
  getClaimWorksheetView: vi.fn(async () => ({ id: 'claim-1' })),
}));

vi.mock('../../app/queries/listClaimsPage.js', () => ({
  listClaimsPage: vi.fn(async () => ({ items: [], total: 0, totalPages: 0 })),
}));

import '../clientClaimsRouter.js';

function mockRes() {
  const res: { status?: ReturnType<typeof vi.fn>; json?: ReturnType<typeof vi.fn> } = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('clientClaimsRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides a claim the customer does not own', async () => {
    const handler = routes['GET /:id'];
    expect(handler).toBeTruthy();
    customerCanAccessPolicy.mockResolvedValueOnce(false);
    const res = mockRes();
    await handler({ params: { id: 'claim-1' }, user: { id: 'c1', role: 'CUSTOMER' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('submits FNOL with payload.fnol for an owned claim', async () => {
    const handler = routes['POST /:id/fnol/submit'];
    expect(handler).toBeTruthy();
    customerCanAccessPolicy.mockResolvedValueOnce(true);
    executeWorksheetCommand.mockResolvedValueOnce(undefined);
    const intake = { incident: { type: 'theft' } };
    const res = mockRes();
    await handler(
      {
        params: { id: 'claim-1' },
        body: { form: intake },
        user: { id: 'c1', role: 'CUSTOMER', name: 'Ada', email: 'ada@example.com' },
      },
      res,
    );
    expect(executeWorksheetCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        claimId: 'claim-1',
        type: 'SUBMIT_FNOL',
        payload: expect.objectContaining({ fnol: intake }),
        actor: expect.objectContaining({ actorType: 'CUSTOMER', actorId: 'c1' }),
      }),
    );
    const firstArg = executeWorksheetCommand.mock.calls[0]?.[0];
    expect(firstArg?.payload?.form).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('returns an empty list when the customer owns no policies', async () => {
    const handler = routes['GET /'];
    expect(handler).toBeTruthy();
    listCustomerOwnedPolicyIds.mockResolvedValueOnce([]);
    const res = mockRes();
    await handler({ query: {}, user: { id: 'c1', role: 'CUSTOMER', primaryAccountId: 'acc-1' } }, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: [],
      }),
    );
  });
});
