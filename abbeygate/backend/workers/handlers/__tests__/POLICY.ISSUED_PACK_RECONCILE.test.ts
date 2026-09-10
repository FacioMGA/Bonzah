import { beforeEach, describe, expect, it, vi } from 'vitest';

const reconcileCardcorpPaidIssuanceBatchMock = vi.fn();
const enqueueCardcorpPaidIssuanceReconciliationContinuationMock = vi.fn();
vi.mock('../../../modules/payments/app/cardcorpIssuanceHealService.js', () => ({
  reconcileCardcorpPaidIssuanceBatch: (...args: unknown[]) =>
    reconcileCardcorpPaidIssuanceBatchMock(...args),
  enqueueCardcorpPaidIssuanceReconciliationContinuation: (...args: unknown[]) =>
    enqueueCardcorpPaidIssuanceReconciliationContinuationMock(...args),
}));

const runWithOperatingTenantByIdMock = vi.fn();
vi.mock('../../../platform/tenant/tenantJobContext.js', () => ({
  runWithOperatingTenantById: (...args: [string, () => Promise<unknown>]) =>
    runWithOperatingTenantByIdMock(...args),
}));

vi.mock('../../index.js', () => ({
  registerHandler: vi.fn(),
}));

const { runIssuedPackReconcile } = await import('../POLICY.ISSUED_PACK_RECONCILE.js');

describe('POLICY.ISSUED_PACK_RECONCILE handler', () => {
  beforeEach(() => {
    reconcileCardcorpPaidIssuanceBatchMock.mockReset();
    enqueueCardcorpPaidIssuanceReconciliationContinuationMock.mockReset();
    runWithOperatingTenantByIdMock.mockReset();
    runWithOperatingTenantByIdMock.mockImplementation(async (_tenantId: string, work: () => Promise<unknown>) => work());
    reconcileCardcorpPaidIssuanceBatchMock.mockResolvedValue({
      scanned: 0,
      healed: 0,
      unchanged: 0,
      failed: 0,
      nextCursor: null,
    });
  });

  it('runs the batch and every continuation in the envelope tenant context', async () => {
    const operatingTenantId = '00000000-0000-4000-8000-000000000002';
    reconcileCardcorpPaidIssuanceBatchMock.mockResolvedValueOnce({
      scanned: 100,
      healed: 1,
      unchanged: 99,
      failed: 0,
      nextCursor: {
        updatedAt: new Date('2026-09-02T12:00:00.000Z'),
        id: '00000000-0000-4000-8000-000000000099',
      },
    });

    await runIssuedPackReconcile({
      eventId: 'sweep-pt-1',
      data: { operatingTenantId, limit: 100 },
    });

    expect(runWithOperatingTenantByIdMock).toHaveBeenCalledWith(operatingTenantId, expect.any(Function));
    expect(reconcileCardcorpPaidIssuanceBatchMock).toHaveBeenCalledWith(100, undefined);
    expect(enqueueCardcorpPaidIssuanceReconciliationContinuationMock).toHaveBeenCalledWith({
      operatingTenantId,
      limit: 100,
      sweepId: 'sweep-pt-1',
      cursor: {
        updatedAt: new Date('2026-09-02T12:00:00.000Z'),
        id: '00000000-0000-4000-8000-000000000099',
      },
      correlationId: 'sweep-pt-1',
    });
  });

  it('rejects a tenantless envelope instead of defaulting the work to another territory', async () => {
    await expect(runIssuedPackReconcile({ eventId: 'missing-tenant', data: { limit: 100 } }))
      .rejects.toThrow(/operatingTenantId/);

    expect(runWithOperatingTenantByIdMock).not.toHaveBeenCalled();
    expect(reconcileCardcorpPaidIssuanceBatchMock).not.toHaveBeenCalled();
  });
});
