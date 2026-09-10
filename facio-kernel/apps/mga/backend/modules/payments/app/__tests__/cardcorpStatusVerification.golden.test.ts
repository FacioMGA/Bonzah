import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  payment: {
    findFirst: vi.fn(),
  },
  riskTransaction: {
    findFirst: vi.fn(),
  },
  policy: {
    findUnique: vi.fn(),
  },
};

const cardcorpGetPaymentStatusMock = vi.fn();
const cardcorpGetPaymentStatusByResourcePathMock = vi.fn();

vi.mock('../../../../platform/db/connection.js', () => ({
  prisma: prismaMock,
  tenantScopedPrisma: prismaMock,
}));

vi.mock('../../../../modules/payments/infra/cardcorpGateway.js', () => ({
  cardcorpGetPaymentStatus: (...args: unknown[]) => cardcorpGetPaymentStatusMock(...args),
  cardcorpGetPaymentStatusByResourcePath: (...args: unknown[]) =>
    cardcorpGetPaymentStatusByResourcePathMock(...args),
}));

vi.mock('../../../../platform/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const parsePaymentRawResult = (raw: unknown) => {
  const result = (raw as { result?: { code?: string; description?: string } })?.result || {};
  return { code: String(result.code || ''), description: result.description };
};

const baseArgs = {
  policyId: 'pol-1',
  checkoutId: 'chk-1',
  resourcePath: '',
  cfg: { entityId: 'ent-1', bearerToken: 'tok-1', baseUrl: 'https://eu-test.oppwa.com' },
  protocol: 'https',
  host: 'example.test',
  parsePaymentRawResult,
};

describe('cardcorp status verification', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.policy.findUnique.mockResolvedValue({ status: 'AWAITING_PAYMENT' });
  });

  it('replays verified paid outcome when gateway session is expired AND issuance already ran', async () => {
    const { verifyCardcorpPaymentStatus } = await import('../cardcorpStatusVerificationService.js');

    prismaMock.payment.findFirst
      .mockResolvedValueOnce({
        id: 'pay-1',
        paymentId: 'gateway-pay-1',
        status: 'PENDING',
        raw: {},
        checkoutId: 'chk-1',
      })
      .mockResolvedValueOnce({
        id: 'pay-2',
        paymentId: 'gateway-pay-2',
        status: 'PAID',
        raw: { result: { code: '000.100.110', description: 'Request successfully processed in test mode' } },
        checkoutId: 'chk-1',
      });
    // INCEPTION exists → spine ran → safe to short-circuit.
    prismaMock.riskTransaction.findFirst.mockResolvedValueOnce({ id: 'rxn-1' });

    cardcorpGetPaymentStatusMock.mockRejectedValueOnce(new Error('No payment session found (200.300.404)'));

    const result = await verifyCardcorpPaymentStatus(baseArgs);

    expect(result.kind).toBe('response');
    if (result.kind !== 'response') return;
    expect(Object.keys(result.data).sort()).toEqual([
      'code',
      'description',
      'idempotent',
      'note',
      'ok',
      'paymentStatus',
      'policyStatus',
    ]);
    expect(result.data.ok).toBe(true);
    expect(result.data.idempotent).toBe(true);
    expect(result.data.policyStatus).toBe('PAID');
  });

  // ABY-54 — regression guard for "PAID-but-no-INCEPTION" zombies. Before the
  // ABY-54 fix the verifier short-circuited on `payment.status === 'PAID'`
  // alone, which silently locked customers out of the welcome email + docs
  // forever when issuance failed after the PAID commit. Now we MUST fall
  // through to the apply-side and let runCardcorpPaidIssuance recover.
  it('falls through to continue when payment is PAID but no INCEPTION exists yet', async () => {
    const { verifyCardcorpPaymentStatus } = await import('../cardcorpStatusVerificationService.js');

    prismaMock.payment.findFirst.mockResolvedValueOnce({
      id: 'pay-zombie',
      paymentId: 'gateway-pay-zombie',
      status: 'PAID',
      raw: {
        id: 'gateway-pay-zombie',
        amount: '123.45',
        currency: 'EUR',
        result: { code: '000.100.110', description: 'Verified in test mode' },
      },
      checkoutId: 'chk-zombie',
    });
    prismaMock.riskTransaction.findFirst.mockResolvedValueOnce(null);

    const result = await verifyCardcorpPaymentStatus(baseArgs);

    expect(result.kind).toBe('continue');
    if (result.kind !== 'continue') return;
    expect(result.payment.id).toBe('pay-zombie');
    expect(result.status.ok).toBe(true);
    expect(result.status.code).toBe('000.100.110');
    expect(result.status.amount).toBe('123.45');
    expect(result.status.currency).toBe('EUR');
    expect(result.status.paymentId).toBe('gateway-pay-zombie');
    expect(cardcorpGetPaymentStatusMock).not.toHaveBeenCalled();
  });

  it('short-circuits a paid policy awaiting authorised external issuance', async () => {
    const { verifyCardcorpPaymentStatus } = await import('../cardcorpStatusVerificationService.js');
    prismaMock.payment.findFirst.mockResolvedValueOnce({
      id: 'pay-open-market',
      paymentId: 'gateway-open-market',
      status: 'PAID',
      raw: { result: { code: '000.100.110', description: 'Payment complete' } },
      checkoutId: 'chk-1',
    });
    prismaMock.riskTransaction.findFirst.mockResolvedValueOnce(null);
    prismaMock.policy.findUnique.mockResolvedValueOnce({ status: 'AWAITING_EXTERNAL_ISSUANCE' });

    const result = await verifyCardcorpPaymentStatus(baseArgs);

    expect(result).toMatchObject({
      kind: 'response',
      data: { ok: true, paymentStatus: 'PAID', policyStatus: 'PAID' },
    });
    expect(cardcorpGetPaymentStatusMock).not.toHaveBeenCalled();
  });

  it('falls through to continue when gateway session expired AND no INCEPTION exists', async () => {
    const { verifyCardcorpPaymentStatus } = await import('../cardcorpStatusVerificationService.js');

    prismaMock.payment.findFirst
      .mockResolvedValueOnce({
        id: 'pay-1',
        paymentId: 'gateway-pay-1',
        status: 'PENDING',
        raw: {},
        checkoutId: 'chk-1',
      })
      .mockResolvedValueOnce({
        id: 'pay-2',
        paymentId: 'gateway-pay-2',
        status: 'PAID',
        raw: {
          id: 'gateway-pay-2',
          amount: '50.00',
          currency: 'EUR',
          result: { code: '000.100.110', description: 'Verified in test mode' },
        },
        checkoutId: 'chk-1',
      });
    prismaMock.riskTransaction.findFirst.mockResolvedValueOnce(null);

    cardcorpGetPaymentStatusMock.mockRejectedValueOnce(new Error('No payment session found (200.300.404)'));

    const result = await verifyCardcorpPaymentStatus(baseArgs);

    expect(result.kind).toBe('continue');
    if (result.kind !== 'continue') return;
    expect(result.payment.id).toBe('pay-2');
    expect(result.status.ok).toBe(true);
    expect(result.status.amount).toBe('50.00');
    expect(result.status.currency).toBe('EUR');
  });

  it('still short-circuits FAILED payments without checking INCEPTION', async () => {
    const { verifyCardcorpPaymentStatus } = await import('../cardcorpStatusVerificationService.js');

    prismaMock.payment.findFirst.mockResolvedValueOnce({
      id: 'pay-failed',
      paymentId: 'gateway-pay-failed',
      status: 'FAILED',
      raw: { result: { code: '800.100.151', description: 'Card declined' } },
      checkoutId: 'chk-failed',
    });

    const result = await verifyCardcorpPaymentStatus(baseArgs);

    expect(result.kind).toBe('response');
    if (result.kind !== 'response') return;
    expect(result.data.ok).toBe(false);
    expect(result.data.policyStatus).toBe('UNPAID');
    expect(prismaMock.riskTransaction.findFirst).not.toHaveBeenCalled();
  });

  it('treats a cancelled checkout as terminal and never re-applies its gateway result', async () => {
    const { verifyCardcorpPaymentStatus } = await import('../cardcorpStatusVerificationService.js');
    prismaMock.payment.findFirst.mockResolvedValueOnce({
      id: 'pay-cancelled',
      paymentId: 'gateway-pay-cancelled',
      status: 'CANCELLED',
      raw: { result: { code: '000.100.110' } },
      checkoutId: 'chk-cancelled',
    });

    const result = await verifyCardcorpPaymentStatus(baseArgs);

    expect(result.kind).toBe('response');
    if (result.kind !== 'response') return;
    expect(result.data).toMatchObject({ ok: false, code: 'PAYMENT_CANCELLED', paymentStatus: 'CANCELLED' });
    expect(cardcorpGetPaymentStatusMock).not.toHaveBeenCalled();
    expect(prismaMock.riskTransaction.findFirst).not.toHaveBeenCalled();
  });
});
