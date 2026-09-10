import { describe, expect, it, vi } from 'vitest';
type PaymentStatusTransitionTx = Parameters<
  typeof import('../riskPaymentDocCommands.js').transitionPaymentStatus
>[0]['tx'];

const appendDomainEventMock = vi.fn();
const enqueueAccounts360ProjectionUpdateMock = vi.fn();
const enqueueAccountIntelligenceProjectionUpdateMock = vi.fn();

vi.mock('../../../../../platform/events/domainEvents.js', () => ({
  appendDomainEvent: (...args: unknown[]) => appendDomainEventMock(...args),
  buildDomainEvent: vi.fn((value: unknown) => value),
}));
vi.mock('../../../../accounts360/infra/projections/accounts360Projection.js', () => ({
  enqueueAccounts360ProjectionUpdate: (...args: unknown[]) => enqueueAccounts360ProjectionUpdateMock(...args),
}));
vi.mock('../../../../accounts360/infra/projections/accountIntelligenceProjection.js', () => ({
  enqueueAccountIntelligenceProjectionUpdate: (...args: unknown[]) => enqueueAccountIntelligenceProjectionUpdateMock(...args),
}));

const { PaymentStatusTransitionConflictError, transitionPaymentStatus } = await import('../riskPaymentDocCommands.js');

describe('transitionPaymentStatus', () => {
  it('fails closed when a concurrent cancellation changes a pending payment first', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const tx = {
      payment: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'pay-1', status: 'PENDING', updatedAt: new Date(), policyId: 'policy-1',
        }),
        updateMany,
      },
      policy: { findUnique: vi.fn() },
      outbox: { create: vi.fn() },
    } satisfies PaymentStatusTransitionTx;

    await expect(transitionPaymentStatus({
      tx,
      paymentId: 'pay-1',
      to: 'PAID',
      actorId: 'cardcorp',
    })).rejects.toBeInstanceOf(PaymentStatusTransitionConflictError);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'pay-1', status: 'PENDING' },
      data: { status: 'PAID' },
    });
    expect(appendDomainEventMock).not.toHaveBeenCalled();
  });
});
