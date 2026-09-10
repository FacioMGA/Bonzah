import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DomainEventEnvelope } from '../../../../platform/events/domainEvents.js';

const prismaMock = {
  policy: {
    findMany: vi.fn(),
  },
  outbox: {
    create: vi.fn(),
  },
  payment: {
    findFirst: vi.fn(),
  },
  riskTransaction: {
    findFirst: vi.fn(),
  },
  document: {
    findMany: vi.fn(),
  },
};

const runCardcorpPaidIssuanceMock = vi.fn();
const enqueueIssuedPolicyPackStandaloneMock = vi.fn();
const appendDomainEventMock = vi.fn();
const getRequiredIssuedDocTypesMock = vi.fn(() => ['MOTOR_CERTIFICATE_PDF']);
const getAdapterMock = vi.fn(() => ({ getRequiredIssuedDocTypes: getRequiredIssuedDocTypesMock }));

vi.mock('../../../../platform/db/connection.js', () => ({
  prisma: prismaMock,
  tenantScopedPrisma: prismaMock,
}));

vi.mock('../cardcorpPolicyIssuanceService.js', () => ({
  runCardcorpPaidIssuance: (...args: unknown[]) => runCardcorpPaidIssuanceMock(...args),
}));

vi.mock('../../../policy/domain/ProductRegistry.js', () => ({
  ProductRegistry: {
    getInstance: () => ({ getAdapter: getAdapterMock }),
  },
}));

vi.mock('../../../policy/app/commands/issuedPackEnqueue.js', () => ({
  enqueueIssuedPolicyPackStandalone: (...args: unknown[]) => enqueueIssuedPolicyPackStandaloneMock(...args),
  buildIssuedPackReplayIdempotencyKey: ({ policyId, riskTransactionId }: { policyId: string; riskTransactionId?: string | null }) =>
    `issued-pack-replay:${policyId}:${riskTransactionId || 'no-rt'}:bucket`,
  isDuplicateIssuedPackEventIdError: () => false,
}));

vi.mock('../../../../platform/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../../platform/events/domainEvents.js', () => ({
  appendDomainEvent: (...args: unknown[]) => appendDomainEventMock(...args),
  buildDomainEvent: (input: Omit<DomainEventEnvelope, 'eventId' | 'occurredAt' | 'correlationId'> & {
    eventId?: string;
    occurredAt?: string;
    correlationId?: string;
  }) => input as DomainEventEnvelope,
}));

const basePolicy = { id: 'pol-1', policyNumber: 'ABOLV-1', productType: 'MOTOR' };

describe('cardcorpIssuanceHealService.attemptIssuanceHealForPolicy', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    getAdapterMock.mockReturnValue({ getRequiredIssuedDocTypes: getRequiredIssuedDocTypesMock });
    getRequiredIssuedDocTypesMock.mockReturnValue(['MOTOR_CERTIFICATE_PDF']);
    enqueueIssuedPolicyPackStandaloneMock.mockResolvedValue({ eventId: 'evt-1' });
    const { __resetIssuanceHealForTests } = await import('../cardcorpIssuanceHealService.js');
    __resetIssuanceHealForTests();
  });

  it('is a fast no-op when no CardCorp payment exists', async () => {
    prismaMock.payment.findFirst.mockResolvedValueOnce(null);

    const { attemptIssuanceHealForPolicy } = await import('../cardcorpIssuanceHealService.js');
    const result = await attemptIssuanceHealForPolicy({ policy: basePolicy });

    expect(result).toEqual({ healed: false, reason: 'no_payment' });
    expect(runCardcorpPaidIssuanceMock).not.toHaveBeenCalled();
  });

  it('is a fast no-op when payment exists but is not PAID', async () => {
    prismaMock.payment.findFirst.mockResolvedValueOnce({
      id: 'pay-1', paymentId: 'g-1', status: 'PENDING', raw: {}, checkoutId: 'chk-1',
    });

    const { attemptIssuanceHealForPolicy } = await import('../cardcorpIssuanceHealService.js');
    const result = await attemptIssuanceHealForPolicy({ policy: basePolicy });

    expect(result).toEqual({ healed: false, reason: 'payment_not_paid' });
    expect(prismaMock.riskTransaction.findFirst).not.toHaveBeenCalled();
    expect(runCardcorpPaidIssuanceMock).not.toHaveBeenCalled();
  });

  it('is a no-op when an INCEPTION risk transaction already exists (issuance ran)', async () => {
    prismaMock.payment.findFirst.mockResolvedValueOnce({
      id: 'pay-1', paymentId: 'g-1', status: 'PAID', raw: { result: { code: '000.100.110' } }, checkoutId: 'chk-1',
    });
    prismaMock.riskTransaction.findFirst.mockResolvedValueOnce({ id: 'rxn-1' });
    prismaMock.document.findMany.mockResolvedValueOnce([{ type: 'MOTOR_CERTIFICATE_PDF' }]);

    const { attemptIssuanceHealForPolicy } = await import('../cardcorpIssuanceHealService.js');
    const result = await attemptIssuanceHealForPolicy({ policy: basePolicy });

    expect(result).toEqual({ healed: false, reason: 'inception_already_present' });
    expect(runCardcorpPaidIssuanceMock).not.toHaveBeenCalled();
    expect(enqueueIssuedPolicyPackStandaloneMock).not.toHaveBeenCalled();
  });

  it('re-queues issued-pack generation when payment is PAID, INCEPTION exists, and required docs are missing', async () => {
    prismaMock.payment.findFirst.mockResolvedValueOnce({
      id: 'pay-1', paymentId: 'g-1', status: 'PAID', raw: { result: { code: '000.100.110' } }, checkoutId: 'chk-1',
    });
    prismaMock.riskTransaction.findFirst.mockResolvedValueOnce({ id: 'rxn-1' });
    prismaMock.document.findMany.mockResolvedValueOnce([]);

    const { attemptIssuanceHealForPolicy } = await import('../cardcorpIssuanceHealService.js');
    const result = await attemptIssuanceHealForPolicy({ policy: basePolicy, correlationId: 'corr-1' });

    expect(result).toEqual({ healed: true, reason: 'issued_pack_requeued' });
    expect(enqueueIssuedPolicyPackStandaloneMock).toHaveBeenCalledTimes(1);
    expect(enqueueIssuedPolicyPackStandaloneMock).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: 'pol-1',
        riskTransactionId: 'rxn-1',
        source: 'SYSTEM',
        correlationId: 'corr-1',
      }),
    );
  });

  it('FIRES the canonical issuance spine when payment is PAID and no INCEPTION exists (zombie)', async () => {
    prismaMock.payment.findFirst.mockResolvedValueOnce({
      id: 'pay-zombie',
      paymentId: 'gateway-pay-zombie',
      status: 'PAID',
      raw: { id: 'gateway-pay-zombie', amount: '123.45', currency: 'EUR', result: { code: '000.100.110' } },
      checkoutId: 'chk-zombie',
    });
    prismaMock.riskTransaction.findFirst.mockResolvedValueOnce(null);
    runCardcorpPaidIssuanceMock.mockResolvedValueOnce({ selectedBundleId: 'EX250_CP0_VIP0' });

    const { attemptIssuanceHealForPolicy } = await import('../cardcorpIssuanceHealService.js');
    const result = await attemptIssuanceHealForPolicy({ policy: basePolicy, correlationId: 'test-corr' });

    expect(result).toEqual({ healed: true, reason: 'spine_re_enqueued' });
    expect(runCardcorpPaidIssuanceMock).toHaveBeenCalledTimes(1);
    const call = runCardcorpPaidIssuanceMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.policy).toEqual({ id: 'pol-1', policyNumber: 'ABOLV-1' });
    expect(call.updatedPayment).toEqual({ id: 'pay-zombie' });
    expect(call.checkoutId).toBe('chk-zombie');
    expect(call.correlationId).toBe('test-corr');
    expect(call.status).toEqual({ paymentId: 'gateway-pay-zombie', amount: '123.45', currency: 'EUR' });
    // baseUrl is unused inside the issuance transaction (verified by ADR-0013
    // spine — the routes pass it but it never reaches a side-effect). We
    // pass an empty string so the heal path doesn't manufacture a fake URL.
    expect(call.baseUrl).toBe('');
  });

  it('returns heal_failed (not throw) when the issuance spine throws', async () => {
    prismaMock.payment.findFirst.mockResolvedValueOnce({
      id: 'pay-zombie', paymentId: 'g-1', status: 'PAID', raw: { result: { code: '000.100.110' } }, checkoutId: 'chk-1',
    });
    prismaMock.riskTransaction.findFirst.mockResolvedValueOnce(null);
    runCardcorpPaidIssuanceMock.mockRejectedValueOnce(new Error('SANCTION_SCREENING_UNAVAILABLE'));

    const { attemptIssuanceHealForPolicy } = await import('../cardcorpIssuanceHealService.js');
    const result = await attemptIssuanceHealForPolicy({ policy: basePolicy });

    expect(result.healed).toBe(false);
    expect(result.reason).toBe('heal_failed');
    if (result.reason === 'heal_failed') {
      expect(result.error).toContain('SANCTION_SCREENING_UNAVAILABLE');
    }
  });

  it('coalesces concurrent heal calls for the same policy via in-flight lock', async () => {
    prismaMock.payment.findFirst.mockResolvedValue({
      id: 'pay-zombie', paymentId: 'g-1', status: 'PAID', raw: { result: { code: '000.100.110' } }, checkoutId: 'chk-1',
    });
    prismaMock.riskTransaction.findFirst.mockResolvedValue(null);
    let resolveSpine: (value: unknown) => void = () => {};
    const spinePending = new Promise<unknown>((r) => { resolveSpine = r; });
    runCardcorpPaidIssuanceMock.mockReturnValue(spinePending);

    const { attemptIssuanceHealForPolicy } = await import('../cardcorpIssuanceHealService.js');
    const first = attemptIssuanceHealForPolicy({ policy: basePolicy });
    const second = attemptIssuanceHealForPolicy({ policy: basePolicy });
    const third = attemptIssuanceHealForPolicy({ policy: basePolicy });

    // Yield so all three calls register against the in-flight map
    // before we resolve the spine. Without this, the spine promise
    // can resolve before call #2/#3 reach their `await pending`.
    await new Promise<void>((r) => setImmediate(r));

    resolveSpine({ selectedBundleId: 'EX250_CP0_VIP0' });
    const [r1, r2, r3] = await Promise.all([first, second, third]);

    expect(runCardcorpPaidIssuanceMock).toHaveBeenCalledTimes(1);
    expect(r1.healed).toBe(true);
    expect(r2.healed).toBe(true);
    expect(r3.healed).toBe(true);
  });
});

describe('cardcorpIssuanceHealService.reconcileCardcorpPaidIssuanceBatch', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    getAdapterMock.mockReturnValue({ getRequiredIssuedDocTypes: getRequiredIssuedDocTypesMock });
    getRequiredIssuedDocTypesMock.mockReturnValue(['MOTOR_CERTIFICATE_PDF']);
    enqueueIssuedPolicyPackStandaloneMock.mockResolvedValue({ eventId: 'evt-1' });
    const { __resetIssuanceHealForTests } = await import('../cardcorpIssuanceHealService.js');
    __resetIssuanceHealForTests();
  });

  it('reconciles only paid policies whose canonical issuance evidence is incomplete', async () => {
    prismaMock.policy.findMany.mockResolvedValueOnce([
      { id: 'pol-missing-pack', policyNumber: 'BZ/PT5000002', productType: 'HOME', updatedAt: new Date('2026-09-01T10:00:00.000Z') },
    ]);
    prismaMock.payment.findFirst.mockResolvedValueOnce({
      id: 'pay-1', paymentId: 'gateway-1', status: 'PAID', raw: {}, checkoutId: 'checkout-1',
    });
    prismaMock.riskTransaction.findFirst.mockResolvedValueOnce({ id: 'rt-1' });
    prismaMock.document.findMany.mockResolvedValueOnce([]);

    const { reconcileCardcorpPaidIssuanceBatch } = await import('../cardcorpIssuanceHealService.js');
    await expect(reconcileCardcorpPaidIssuanceBatch(25)).resolves.toEqual({
      scanned: 1, healed: 1, unchanged: 0, failed: 0, nextCursor: null,
    });

    expect(prismaMock.policy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 25,
      where: expect.objectContaining({
        payments: { some: { provider: 'CARDCORP', status: 'PAID' } },
      }),
    }));
    const [{ where }] = prismaMock.policy.findMany.mock.calls[0] as [{ where: unknown }];
    expect(JSON.stringify(where)).not.toContain('updatedAt');
    expect(enqueueIssuedPolicyPackStandaloneMock).toHaveBeenCalledWith(expect.objectContaining({
      policyId: 'pol-missing-pack',
      riskTransactionId: 'rt-1',
      correlationId: 'issuance-reconcile:pol-missing-pack',
    }));
  });

  it('records a failed candidate without aborting the rest of the bounded batch', async () => {
    prismaMock.policy.findMany.mockResolvedValueOnce([
      { id: 'pol-failed', policyNumber: 'BZ/PT5000003', productType: 'HOME', updatedAt: new Date('2026-09-01T10:00:00.000Z') },
      { id: 'pol-recovered', policyNumber: 'BZ/PT5000004', productType: 'HOME', updatedAt: new Date('2026-09-01T10:01:00.000Z') },
    ]);
    prismaMock.payment.findFirst
      .mockResolvedValueOnce({ id: 'pay-failed', paymentId: 'gateway-failed', status: 'PAID', raw: {}, checkoutId: 'checkout-failed' })
      .mockResolvedValueOnce({ id: 'pay-recovered', paymentId: 'gateway-recovered', status: 'PAID', raw: {}, checkoutId: 'checkout-recovered' });
    prismaMock.riskTransaction.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'rt-recovered' });
    runCardcorpPaidIssuanceMock.mockRejectedValueOnce(new Error('storage unavailable'));
    prismaMock.document.findMany.mockResolvedValueOnce([]);

    const { reconcileCardcorpPaidIssuanceBatch } = await import('../cardcorpIssuanceHealService.js');
    await expect(reconcileCardcorpPaidIssuanceBatch()).resolves.toEqual({
      scanned: 2, healed: 1, unchanged: 0, failed: 1, nextCursor: null,
    });
    expect(enqueueIssuedPolicyPackStandaloneMock).toHaveBeenCalledWith(expect.objectContaining({
      policyId: 'pol-recovered',
    }));
  });

  it('continues after the ordered cursor when a prior page was full', async () => {
    prismaMock.policy.findMany.mockResolvedValueOnce([]);

    const { reconcileCardcorpPaidIssuanceBatch } = await import('../cardcorpIssuanceHealService.js');
    await expect(reconcileCardcorpPaidIssuanceBatch(10, {
      updatedAt: new Date('2026-09-01T10:00:00.000Z'),
      id: '00000000-0000-4000-8000-000000000001',
    })).resolves.toEqual({
      scanned: 0, healed: 0, unchanged: 0, failed: 0, nextCursor: null,
    });

    const [{ where }] = prismaMock.policy.findMany.mock.calls[0] as [{ where: unknown }];
    expect(where).toEqual(expect.objectContaining({
      AND: [{
        OR: [
          { updatedAt: { gt: new Date('2026-09-01T10:00:00.000Z') } },
          { updatedAt: new Date('2026-09-01T10:00:00.000Z'), id: { gt: '00000000-0000-4000-8000-000000000001' } },
        ],
      }],
    }));
  });

  it('writes each continuation to the outbox once per reconciliation sweep', async () => {
    appendDomainEventMock.mockResolvedValueOnce(undefined);
    const { enqueueCardcorpPaidIssuanceReconciliationContinuation } = await import('../cardcorpIssuanceHealService.js');

    await enqueueCardcorpPaidIssuanceReconciliationContinuation({
      operatingTenantId: '00000000-0000-4000-8000-000000000002',
      sweepId: 'scheduled-event-1',
      limit: 100,
      cursor: {
        updatedAt: new Date('2026-09-01T10:00:00.000Z'),
        id: '00000000-0000-4000-8000-000000000001',
      },
      correlationId: 'scheduled-event-1',
    });

    expect(appendDomainEventMock).toHaveBeenCalledWith(prismaMock, expect.objectContaining({
      eventType: 'POLICY.ISSUED_PACK_RECONCILE',
      idempotencyKey: 'issued-pack-reconcile:scheduled-event-1:2026-09-01T10:00:00.000Z:00000000-0000-4000-8000-000000000001',
      data: {
        operatingTenantId: '00000000-0000-4000-8000-000000000002',
        limit: 100,
        sweepId: 'scheduled-event-1',
        cursor: {
          updatedAt: '2026-09-01T10:00:00.000Z',
          id: '00000000-0000-4000-8000-000000000001',
        },
      },
    }));
  });
});
