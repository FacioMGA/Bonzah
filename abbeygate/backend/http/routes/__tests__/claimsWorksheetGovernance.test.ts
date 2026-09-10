import { describe, expect, it, vi, beforeEach } from 'vitest';

const { routes, executeClaimWorksheetCommand } = vi.hoisted(() => {
  const routes: Record<string, unknown> = {};
  return {
    routes,
    executeClaimWorksheetCommand: vi.fn(),
  };
});
const { getClaimWorksheetView } = vi.hoisted(() => ({
  getClaimWorksheetView: vi.fn(),
}));

vi.mock('express', () => ({
  Router: () => ({
    get: vi.fn((path: string, ...handlers: unknown[]) => {
      routes[`GET ${path}`] = handlers[handlers.length - 1];
    }),
    post: vi.fn((path: string, ...handlers: unknown[]) => {
      routes[`POST ${path}`] = handlers[handlers.length - 1];
    }),
  }),
}));

vi.mock('../../../platform/db/connection.js', () => ({
  prisma: {
    claim: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async () => null),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({})),
  },
}));

vi.mock('../../../modules/claims/domain/worksheetCommands.js', () => ({
  executeClaimWorksheetCommand: (...args: unknown[]) => executeClaimWorksheetCommand(...args),
  openClaimCommand: vi.fn(),
}));

vi.mock('../../../modules/claims/domain/worksheetProjection.js', () => ({
  buildClaimWorksheetProjection: vi.fn(),
}));

vi.mock('../../../platform/utils/platformIds.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../platform/utils/platformIds.js')>()),
  reserveNextClaimNumber: vi.fn(async () => 'CLM-1'),
}));

vi.mock('../../../modules/claims/app/queries/getClaimWorksheetView.js', () => ({
  getClaimWorksheetView: (...args: unknown[]) => getClaimWorksheetView(...args),
}));

vi.mock('../../../modules/accessControl/app/permissionService.js', () => ({
  resolveEffectivePermissionsForUser: vi.fn(async () => [
    { key: 'claims.reserve' },
    { key: 'claims.approve_payment' },
  ]),
  hasEffectivePermission: (permissions: Array<{ key: string }>, key: string) =>
    permissions.some((permission) => permission.key === key),
}));

import '../claimsWorksheet.js';

function mockRes() {
  const res: { status?: ReturnType<typeof vi.fn>; json?: ReturnType<typeof vi.fn> } = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('claimsWorksheet governance route wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('maps /:id/fnol/submit to SUBMIT_FNOL command', async () => {
    const handler = routes['POST /:id/fnol/submit'] as (req: unknown, res: unknown) => Promise<void>;
    expect(handler).toBeTruthy();
    executeClaimWorksheetCommand.mockResolvedValueOnce(undefined);

    const req = {
      params: { id: 'claim-1' },
      body: { form: { incident: { type: 'collision' } } },
      user: { id: 'u1', role: 'UNDERWRITER', name: 'Tester' },
    };
    const res = mockRes();
    await handler(req, res);

    expect(executeClaimWorksheetCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        claimId: 'claim-1',
        type: 'SUBMIT_FNOL',
        payload: expect.objectContaining({
          fnol: expect.objectContaining({
            incident: expect.objectContaining({ type: 'collision' }),
          }),
        }),
        input: expect.objectContaining({
          actorId: 'u1',
          actorName: 'Tester',
          actorType: 'UNDERWRITER',
        }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('returns stable FNOL_NOT_CONFIRMED code on command rejection', async () => {
    const handler = routes['POST /:id/commands'] as (req: unknown, res: unknown) => Promise<void>;
    expect(handler).toBeTruthy();
    executeClaimWorksheetCommand.mockRejectedValueOnce(new Error('FNOL must be confirmed before financial commands'));

    const req = {
      params: { id: 'claim-1' },
      body: {
        type: 'SET_RESERVE',
        payload: { bucket: 'INDEMNITY', amount: 900, reasonCode: 'UW_AUTH', explanation: 'within authority' },
      },
      user: { id: 'u1', role: 'UNDERWRITER', name: 'Tester' },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'FNOL_NOT_CONFIRMED',
          message: 'FNOL must be confirmed before financial commands',
        }),
      }),
    );
  });

  it('returns stable movement metadata and payment codes', async () => {
    const handler = routes['POST /:id/commands'] as (req: unknown, res: unknown) => Promise<void>;
    executeClaimWorksheetCommand.mockRejectedValueOnce(new Error('Reserve movement requires reasonCode'));

    const reqMissingMeta = {
      params: { id: 'claim-1' },
      body: {
        type: 'SET_RESERVE',
        payload: { bucket: 'INDEMNITY', amount: 900, reasonCode: 'UW_AUTH', explanation: 'within authority' },
      },
      user: { id: 'u1', role: 'UNDERWRITER', name: 'Tester' },
    };
    const resMissingMeta = mockRes();
    await handler(reqMissingMeta, resMissingMeta);
    expect(resMissingMeta.status).toHaveBeenCalledWith(400);
    expect(resMissingMeta.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'MOVEMENT_METADATA_REQUIRED' }),
      }),
    );

    executeClaimWorksheetCommand.mockRejectedValueOnce(new Error('Payment exceeds outstanding in strict mode'));
    const reqPayment = {
      params: { id: 'claim-1' },
      body: {
        type: 'ADD_PAYMENT',
        payload: { bucket: 'INDEMNITY', amount: 900, reasonCode: 'SETTLEMENT', explanation: 'customer settlement' },
      },
      user: { id: 'u1', role: 'UNDERWRITER', name: 'Tester' },
    };
    const resPayment = mockRes();
    await handler(reqPayment, resPayment);
    expect(resPayment.status).toHaveBeenCalledWith(409);
    expect(resPayment.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'PAYMENT_EXCEEDS_OUTSTANDING' }),
      }),
    );

    executeClaimWorksheetCommand.mockRejectedValueOnce(new Error('Invalid payee role for selected claim payment classification.'));
    const reqInvalidPayee = {
      params: { id: 'claim-1' },
      body: {
        type: 'ADD_PAYMENT',
        payload: {
          costCategory: 'fees',
          costSubType: 'attorney_coverage_fee',
          payeeCounterpartyId: 'cp-repairer',
          amount: 250,
          reasonCode: 'SETTLEMENT',
          explanation: 'Invalid payee role',
        },
      },
      user: { id: 'u1', role: 'UNDERWRITER', name: 'Tester' },
    };
    const resInvalidPayee = mockRes();
    await handler(reqInvalidPayee, resInvalidPayee);
    expect(resInvalidPayee.status).toHaveBeenCalledWith(400);
    expect(resInvalidPayee.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'INVALID_PAYMENT_PAYEE_ROLE' }),
      }),
    );
  });

  it('keeps reserve and payment command contract stable', async () => {
    const handler = routes['POST /:id/commands'] as (req: unknown, res: unknown) => Promise<void>;
    expect(handler).toBeTruthy();
    executeClaimWorksheetCommand.mockResolvedValue(undefined);
    getClaimWorksheetView.mockResolvedValue({
      claimId: 'claim-1',
      worksheet: { status: 'OPEN', totalOutstanding: 250, totalPaid: 50 },
    });

    const reserveReq = {
      params: { id: 'claim-1' },
      body: {
        type: 'SET_RESERVE',
        payload: { bucket: 'INDEMNITY', amount: 300, reasonCode: 'UW_AUTH', explanation: 'Within authority' },
      },
      user: { id: 'u1', role: 'UNDERWRITER', name: 'Tester' },
    };
    const reserveRes = mockRes();
    await handler(reserveReq, reserveRes);

    const paymentReq = {
      params: { id: 'claim-1' },
      body: {
        type: 'ADD_PAYMENT',
        payload: { bucket: 'INDEMNITY', amount: 50, reasonCode: 'SETTLEMENT', explanation: 'Customer settlement' },
      },
      user: { id: 'u1', role: 'UNDERWRITER', name: 'Tester' },
    };
    const paymentRes = mockRes();
    await handler(paymentReq, paymentRes);

    expect(executeClaimWorksheetCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ claimId: 'claim-1', type: 'SET_RESERVE' }),
    );
    expect(executeClaimWorksheetCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ claimId: 'claim-1', type: 'ADD_PAYMENT' }),
    );
    expect(paymentRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const payload = paymentRes.json.mock.calls.at(-1)?.[0];
    expect(Object.keys(payload.data).sort()).toEqual(['claimId', 'worksheet']);
  });
});
