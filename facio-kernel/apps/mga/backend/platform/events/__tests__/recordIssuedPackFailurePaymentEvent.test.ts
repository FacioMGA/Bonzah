/**
 * Audit contract for `recordIssuedPackFailurePaymentEvent`.
 *
 * Failure surfaces (ADR-0017 — used by `evaluateIssueReadiness` to
 * flip `customerOutcome` to terminal `'failed'`):
 *
 *   1. `ISSUED_PACK_GENERATION_FAILED` — the adapter call inside the
 *      `DOC.GENERATE_ISSUED_POLICY_PACK` worker threw (template not
 *      found, PDF render error, storage upload failure).
 *   2. `ISSUED_PACK_MISSING_DOC_TYPES` — adapter ran successfully but
 *      did not produce every required doc type.
 *
 * Both write a structured `paymentEvent` against the latest PAID
 * CardCorp payment so BO + the issue-readiness evaluator can see the
 * half-issued state without tailing logs. This test pins:
 *
 *   - The `eventType` strings (BO + analytics dashboards depend on
 *     them; renaming silently would break alerting).
 *   - The shape of `payload` (specifically the presence of
 *     `missingDocTypes` for the missing-doc-types case).
 *   - The "no payment row" fallback path: we must not crash, we must
 *     emit a structured warn, and we must NOT create a paymentEvent
 *     against a non-existent payment.
 *
 * Pre-ADR-0013 the helper also accepted `'ISSUED_PACK_QUEUE_ENQUEUE_FAILED'`,
 * but transactional outbox enqueue removed that failure mode.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirstMock, createMock, warnMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  createMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock('../../db/connection.js', () => ({
  tenantScopedPrisma: {
    payment: { findFirst: findFirstMock },
    paymentEvent: { create: createMock },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    warn: warnMock,
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { recordIssuedPackFailurePaymentEvent } from '../policyEmailOrchestration.js';

describe('recordIssuedPackFailurePaymentEvent (PR-1B audit contract)', () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    createMock.mockReset();
    warnMock.mockReset();
  });

  it('writes ISSUED_PACK_GENERATION_FAILED against the latest PAID CardCorp payment', async () => {
    findFirstMock.mockResolvedValue({ id: 'pay-1' });

    await recordIssuedPackFailurePaymentEvent({
      policyId: 'policy-1',
      eventType: 'ISSUED_PACK_GENERATION_FAILED',
      reason: 'template_not_found: HOME_CERTIFICATE',
      riskTransactionId: 'rt-1',
    });

    expect(findFirstMock).toHaveBeenCalledWith({
      where: { policyId: 'policy-1', provider: 'CARDCORP', status: 'PAID' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    expect(createMock).toHaveBeenCalledWith({
      data: {
        paymentId: 'pay-1',
        eventType: 'ISSUED_PACK_GENERATION_FAILED',
        verified: true,
        payload: {
          reason: 'template_not_found: HOME_CERTIFICATE',
          policyId: 'policy-1',
          riskTransactionId: 'rt-1',
          missingDocTypes: undefined,
          via: 'DOC.GENERATE_ISSUED_POLICY_PACK',
        },
      },
    });
  });

  it('writes ISSUED_PACK_MISSING_DOC_TYPES with the missing types in the payload', async () => {
    findFirstMock.mockResolvedValue({ id: 'pay-2' });

    await recordIssuedPackFailurePaymentEvent({
      policyId: 'policy-2',
      eventType: 'ISSUED_PACK_MISSING_DOC_TYPES',
      reason: 'missing_required_doc_types: MOTOR_CERTIFICATE_PDF,MOTOR_GREEN_CARD_PDF',
      riskTransactionId: 'rt-2',
      missingDocTypes: ['MOTOR_CERTIFICATE_PDF', 'MOTOR_GREEN_CARD_PDF'],
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const created = createMock.mock.calls[0]![0] as { data: { eventType: string; payload: Record<string, unknown> } };
    expect(created.data.eventType).toBe('ISSUED_PACK_MISSING_DOC_TYPES');
    expect(created.data.payload).toEqual({
      reason: 'missing_required_doc_types: MOTOR_CERTIFICATE_PDF,MOTOR_GREEN_CARD_PDF',
      policyId: 'policy-2',
      riskTransactionId: 'rt-2',
      missingDocTypes: ['MOTOR_CERTIFICATE_PDF', 'MOTOR_GREEN_CARD_PDF'],
      via: 'DOC.GENERATE_ISSUED_POLICY_PACK',
    });
  });

  it('does not create a paymentEvent when no PAID CardCorp payment exists, and surfaces a structured warn', async () => {
    findFirstMock.mockResolvedValue(null);

    await recordIssuedPackFailurePaymentEvent({
      policyId: 'policy-3',
      eventType: 'ISSUED_PACK_GENERATION_FAILED',
      reason: 'enqueue_failed',
    });

    expect(createMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: 'policy-3',
        eventType: 'ISSUED_PACK_GENERATION_FAILED',
        reason: 'enqueue_failed',
      }),
      'issued_pack.failure.no_payment_row',
    );
  });

  it('defaults the reason payload to "unknown_failure" when called with an empty reason string', async () => {
    findFirstMock.mockResolvedValue({ id: 'pay-4' });

    await recordIssuedPackFailurePaymentEvent({
      policyId: 'policy-4',
      eventType: 'ISSUED_PACK_GENERATION_FAILED',
      reason: '',
    });

    const created = createMock.mock.calls[0]![0] as { data: { payload: { reason: string } } };
    expect(created.data.payload.reason).toBe('unknown_failure');
  });
});
