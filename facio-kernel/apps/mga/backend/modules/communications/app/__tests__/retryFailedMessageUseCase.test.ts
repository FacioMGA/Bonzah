import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUniqueMock = vi.fn();
const countMock = vi.fn();
const updateMock = vi.fn();
const runTenantScopedTransactionMock = vi.fn();
const appendDomainEventMock = vi.fn();

vi.mock('../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    communicationMessage: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
    communicationDeliveryAttempt: { count: (...args: unknown[]) => countMock(...args) },
  },
  runTenantScopedTransaction: (callback: (tx: { communicationMessage: { update: typeof updateMock } }) => unknown) =>
    runTenantScopedTransactionMock(callback),
}));

vi.mock('../../../../platform/events/domainEvents.js', () => ({
  buildDomainEvent: <T extends object>(event: T) => ({ eventId: 'event-1', ...event }),
  appendDomainEvent: (...args: unknown[]) => appendDomainEventMock(...args),
}));

const { retryFailedMessage } = await import('../retryFailedMessageUseCase.js');

describe('retryFailedMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runTenantScopedTransactionMock.mockImplementation(async (callback) => callback({
      communicationMessage: { update: updateMock },
    }));
    findUniqueMock.mockResolvedValue({ id: 'message-1', status: 'FAILED' });
    countMock.mockResolvedValue(1);
  });

  it('requeues the existing failed message and appends the canonical outbound event', async () => {
    await expect(retryFailedMessage('message-1')).resolves.toEqual({
      status: 'REQUEUED', messageId: 'message-1', previousAttempts: 1,
    });

    expect(updateMock).toHaveBeenCalledWith({ where: { id: 'message-1' }, data: { status: 'QUEUED' } });
    expect(appendDomainEventMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        eventType: 'COMM.OUTBOUND_QUEUED',
        aggregateType: 'COMMUNICATION',
        aggregateId: 'message-1',
        idempotencyKey: 'retry:message-1:2',
      }),
    );
  });

  it('does not requeue after the delivery-attempt limit', async () => {
    countMock.mockResolvedValue(3);

    await expect(retryFailedMessage('message-1')).resolves.toEqual({ status: 'MAX_ATTEMPTS', messageId: 'message-1' });

    expect(runTenantScopedTransactionMock).not.toHaveBeenCalled();
    expect(appendDomainEventMock).not.toHaveBeenCalled();
  });
});
