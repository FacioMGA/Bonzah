import { beforeEach, describe, expect, it, vi } from 'vitest';

const { routes, executeClaimWorksheetCommand, normalizeCanonicalIntake } = vi.hoisted(() => {
  const routes: { [route: string]: (req: unknown, res: unknown) => Promise<void> } = {};
  return {
    routes,
    executeClaimWorksheetCommand: vi.fn(),
    normalizeCanonicalIntake: vi.fn((value: unknown) => value),
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

vi.mock('jsonwebtoken', () => {
  const verify = () => ({ purpose: 'PUBLIC_FNOL', claimId: 'claim-1', policyId: 'policy-1' });
  return { default: { verify }, verify };
});

vi.mock('../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    claim: {
      findUnique: vi.fn(async () => ({ id: 'claim-1', policyId: 'policy-1', status: 'PENDING', policy: { programId: 'program-1', binderId: 'binder-1', productType: 'HOME' } })),
    },
  },
}));

vi.mock('../../../insuranceConfiguration/app/journeyCapabilities.js', () => ({ assertPolicyJourneyAction: vi.fn(async () => ({ workflow: {} })) }));

vi.mock('../../app/httpConductorDeps.js', () => ({
  claimsHttpDeps: {
    executeClaimWorksheetCommand,
    normalizeCanonicalIntake,
  },
}));

import '../publicFnolRouter.js';

function mockRes() {
  const res: { status?: ReturnType<typeof vi.fn>; json?: ReturnType<typeof vi.fn> } = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('publicFnolRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps public submit to SUBMIT_FNOL with payload.fnol (not payload.form)', async () => {
    const handler = routes['POST /:token/submit'];
    expect(handler).toBeTruthy();
    executeClaimWorksheetCommand.mockResolvedValueOnce(undefined);
    const intake = { incident: { type: 'collision', description: 'Rear end collision' } };

    const req = { params: { token: 'token-1' }, body: { form: intake } };
    const res = mockRes();
    await handler(req, res);

    expect(executeClaimWorksheetCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        claimId: 'claim-1',
        type: 'SUBMIT_FNOL',
        payload: expect.objectContaining({
          fnol: intake,
        }),
      }),
    );
    const firstArg = executeClaimWorksheetCommand.mock.calls[0]?.[0];
    expect(firstArg?.payload?.form).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
