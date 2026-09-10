import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { DeliveryResult } from '../../../modules/communications/domain/types.js';

// Mocks at the adapter boundary. The handler reads the comm message
// from Prisma, transitions status, creates a delivery attempt, calls
// ProviderRouter.deliver, then emits an audit event. We only need the
// happy path for the contract assertion — deeper provider routing is
// proved by communications.test.ts at tier 2/3.

let persistedMessage = { ...queuedMessage('msg_1'), sentAt: null as Date | null, deliveredAt: null as Date | null };
function sendingAttempt() {
  return { id: 'attempt_1', messageId: 'msg_1', status: 'SENDING', externalId: null as string | null,
    errorCode: null as string | null, errorDetail: null as string | null,
    attemptedAt: new Date('2026-09-06T12:00:00.000Z'), resolvedAt: null as Date | null };
}
let persistedAttempt = sendingAttempt();
let latestAttemptId = 'attempt_1';
const messageFindUniqueMock = vi.fn();
const messageFindUniqueOrThrowMock = vi.fn(async () => structuredClone(persistedMessage));
const messageUpdateMock = vi.fn(async () => undefined);
const messageUpdateManyMock = vi.fn<(args: Prisma.CommunicationMessageUpdateManyArgs) => Promise<{ count: number }>>();
const deliveryAttemptCreateMock = vi.fn(async () => structuredClone(persistedAttempt));
const deliveryAttemptUpdateMock = vi.fn<(args: Prisma.CommunicationDeliveryAttemptUpdateArgs) => Promise<ReturnType<typeof sendingAttempt>>>();
const deliveryAttemptUpdateManyMock = vi.fn<(args: Prisma.CommunicationDeliveryAttemptUpdateManyArgs) => Promise<{ count: number }>>();
const deliveryAttemptFindFirstMock = vi.fn(async () => ({ id: latestAttemptId }));
const deliveryAttemptCountMock = vi.fn(async () => 0);
const transactionDb = {
  communicationMessage: { findUnique: messageFindUniqueMock, findUniqueOrThrow: messageFindUniqueOrThrowMock, update: messageUpdateMock, updateMany: messageUpdateManyMock },
  communicationDeliveryAttempt: { count: deliveryAttemptCountMock, create: deliveryAttemptCreateMock, update: deliveryAttemptUpdateMock, updateMany: deliveryAttemptUpdateManyMock, findFirst: deliveryAttemptFindFirstMock },
};
let transactionDepth = 0;
vi.mock('../../../platform/db/connection.js', () => ({ tenantScopedPrisma: transactionDb,
  runTenantScopedTransaction: async <T>(work: (tx: typeof transactionDb) => Promise<T>) => {
    transactionDepth += 1;
    try { return await work(transactionDb); }
    finally { transactionDepth -= 1; }
  },
}));

const providerDeliverMock = vi.fn<(...args: unknown[]) => Promise<DeliveryResult>>();
vi.mock('../../../modules/communications/infra/providerRouter.js', () => ({
  ProviderRouter: { deliver: (...args: unknown[]) => providerDeliverMock(...args) },
}));

const emitCommAuditEventMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
vi.mock('../../../modules/communications/infra/audit/commAuditEvents.js', () => ({
  emitCommAuditEvent: (...args: unknown[]) => emitCommAuditEventMock(...args),
}));

vi.mock('../../../platform/tenant/tenantJobContext.js', () => ({
  loadOperatingTenantForCommThread: vi.fn(async () => 'tenant_test'),
}));
vi.mock('../../../platform/tenant/tenantAls.js', () => ({
  runWithOperatingTenant: (_tenant: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../../../platform/observability/context.js', () => ({
  ensureCorrelationId: (id?: string) => id ?? 'cid_test',
  runWithCorrelationId: (_id: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../../../platform/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { runCommunicationOutboundJob, handleCommunicationOutbound, CommunicationOutboundPayloadSchema } =
  await import('../COMMUNICATION_OUTBOUND.js');

function queuedMessage(id: string) {
  return {
    id,
    threadId: 'thread_1',
    status: 'QUEUED',
    provider: 'SENDGRID',
    channel: 'EMAIL',
    fromActor: 'system',
    toRecipients: ['customer@example.com'],
    subject: 'Test',
    body: 'Hello',
    attachments: [],
    externalRefs: {},
    thread: { entityType: 'POLICY', entityId: 'pol_1' },
  };
}

describe('COMMUNICATION_OUTBOUND handler — typed payload contract (ADR-0029)', () => {
  beforeEach(() => {
    messageFindUniqueMock.mockReset();
    persistedMessage = { ...queuedMessage('msg_1'), sentAt: null, deliveredAt: null };
    persistedAttempt = sendingAttempt();
    latestAttemptId = 'attempt_1';
    messageUpdateManyMock.mockImplementation(async ({ where, data }) => {
      const filter = where?.status;
      if (filter && typeof filter === 'object' && Array.isArray(filter.in) && !filter.in.some(status => status === persistedMessage.status)) return { count: 0 };
      if (where?.deliveryAttempts && latestAttemptId !== persistedAttempt.id) return { count: 0 };
      Object.assign(persistedMessage, data);
      return { count: 1 };
    });
    deliveryAttemptUpdateManyMock.mockImplementation(async ({ where, data }) => {
      const filter = where?.status;
      if (filter && typeof filter === 'object' && Array.isArray(filter.in) && !filter.in.some(status => status === persistedAttempt.status)) return { count: 0 };
      Object.assign(persistedAttempt, data);
      return { count: 1 };
    });
    deliveryAttemptUpdateMock.mockImplementation(async ({ data }) => {
      Object.assign(persistedAttempt, data);
      return structuredClone(persistedAttempt);
    });
    providerDeliverMock.mockReset();
    providerDeliverMock.mockResolvedValue({ status: 'SENT', externalId: 'ext_1', sentAt: new Date() });
    messageFindUniqueOrThrowMock.mockClear();
    deliveryAttemptUpdateManyMock.mockClear();
    deliveryAttemptFindFirstMock.mockClear();
    messageUpdateMock.mockClear();
    messageUpdateManyMock.mockClear();
    deliveryAttemptCreateMock.mockClear();
    deliveryAttemptUpdateMock.mockClear();
    deliveryAttemptCountMock.mockClear();
    providerDeliverMock.mockClear();
    emitCommAuditEventMock.mockClear();
  });

  it('exposes the canonical JobHandler shim + pure body', () => {
    expect(typeof handleCommunicationOutbound).toBe('function');
    expect(typeof runCommunicationOutboundJob).toBe('function');
  });

  it('accepts the flat { messageId } payload shape and dispatches via ProviderRouter', async () => {
    messageFindUniqueMock.mockResolvedValueOnce(queuedMessage('msg_1'));
    await runCommunicationOutboundJob({ messageId: 'msg_1' });
    expect(messageFindUniqueMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'msg_1' } }));
    expect(providerDeliverMock).toHaveBeenCalledTimes(1);
    expect(providerDeliverMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg_1' }));
  });

  it('accepts the envelope { data: { messageId } } payload shape (canonical outbox relay)', async () => {
    messageFindUniqueMock.mockResolvedValueOnce(queuedMessage('msg_2'));
    await runCommunicationOutboundJob({
      eventId: 'evt_1',
      correlationId: 'cid_1',
      data: { messageId: 'msg_2' },
    });
    expect(messageFindUniqueMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'msg_2' } }));
    expect(providerDeliverMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg_2' }));
  });

  it.each(['DELIVERED', 'FAILED', 'BOUNCED'])('preserves early %s webhook evidence when provider acceptance returns later', async (status) => {
    const resolvedAt = new Date('2026-09-06T12:00:01.000Z');
    messageFindUniqueMock.mockResolvedValueOnce(queuedMessage('msg_1'));
    providerDeliverMock.mockImplementationOnce(async () => {
      persistedAttempt.status = status;
      persistedAttempt.resolvedAt = resolvedAt;
      persistedAttempt.errorCode = status === 'DELIVERED' ? null : 'WEBHOOK_FAILURE';
      persistedMessage.status = status === 'DELIVERED' ? 'DELIVERED' : 'FAILED';
      persistedMessage.deliveredAt = status === 'DELIVERED' ? resolvedAt : null;
      return { status: 'SENT', externalId: 'ext_early', sentAt: new Date('2026-09-06T12:00:00.000Z') };
    });
    await runCommunicationOutboundJob({ messageId: 'msg_1' });
    expect(persistedAttempt).toMatchObject({ status, resolvedAt, externalId: 'ext_early', errorCode: status === 'DELIVERED' ? null : 'WEBHOOK_FAILURE' });
    expect(persistedMessage).toMatchObject({ status: status === 'DELIVERED' ? 'DELIVERED' : 'FAILED', deliveredAt: status === 'DELIVERED' ? resolvedAt : null, externalRefs: { providerMessageId: 'ext_early' } });
    expect(emitCommAuditEventMock).toHaveBeenCalledWith(status === 'DELIVERED' ? 'COMM.MESSAGE_SENT' : 'COMM.MESSAGE_FAILED', expect.anything(), expect.anything());
  });

  it('normally finalizes provider acceptance as SENT with provider identity on both records', async () => {
    messageFindUniqueMock.mockResolvedValueOnce(queuedMessage('msg_1'));
    await runCommunicationOutboundJob({ messageId: 'msg_1' });
    expect(persistedAttempt).toMatchObject({ status: 'SENT', externalId: 'ext_1', resolvedAt: expect.any(Date) });
    expect(persistedMessage).toMatchObject({ status: 'SENT', sentAt: expect.any(Date), externalRefs: { providerMessageId: 'ext_1' } });
  });

  it('creates the attempt within the claim transaction and contacts the provider only after commit', async () => {
    messageFindUniqueMock.mockResolvedValueOnce(queuedMessage('msg_1'));
    messageUpdateManyMock.mockImplementationOnce(async ({ data }) => {
      expect(transactionDepth).toBe(1);
      expect(data.status).toBe('SENDING');
      Object.assign(persistedMessage, data);
      return { count: 1 };
    });
    deliveryAttemptCreateMock.mockImplementationOnce(async () => {
      expect(transactionDepth).toBe(1);
      expect(persistedMessage.status).toBe('SENDING');
      expect(providerDeliverMock).not.toHaveBeenCalled();
      return structuredClone(persistedAttempt);
    });
    providerDeliverMock.mockImplementationOnce(async () => {
      expect(transactionDepth).toBe(0);
      expect(deliveryAttemptCreateMock).toHaveBeenCalledTimes(1);
      return { status: 'SENT', externalId: 'ext_atomic' };
    });
    await runCommunicationOutboundJob({ messageId: 'msg_1' });
    expect(persistedMessage.status).toBe('SENT');
    expect(persistedAttempt.externalId).toBe('ext_atomic');
  });

  it('stores an older attempt provider identity without projecting over a newer retry', async () => {
    messageFindUniqueMock.mockResolvedValueOnce(queuedMessage('msg_1'));
    providerDeliverMock.mockImplementationOnce(async () => {
      latestAttemptId = 'newer-attempt';
      persistedMessage.status = 'SENDING';
      return { status: 'SENT', externalId: 'ext_old' };
    });
    await runCommunicationOutboundJob({ messageId: 'msg_1' });
    expect(persistedAttempt.externalId).toBe('ext_old');
    expect(persistedMessage.status).toBe('SENDING');
    expect(persistedMessage.externalRefs).toEqual({});
    expect(emitCommAuditEventMock).not.toHaveBeenCalled();
  });

  it('preserves delivery evidence when an early webhook is followed by a provider exception', async () => {
    messageFindUniqueMock.mockResolvedValueOnce(queuedMessage('msg_1'));
    const resolvedAt = new Date('2026-09-06T12:00:01.000Z');
    providerDeliverMock.mockImplementationOnce(async () => {
      persistedAttempt.status = 'DELIVERED'; persistedAttempt.resolvedAt = resolvedAt;
      persistedMessage.status = 'DELIVERED'; persistedMessage.deliveredAt = resolvedAt;
      throw new Error('late transport error');
    });
    await expect(runCommunicationOutboundJob({ messageId: 'msg_1' })).rejects.toThrow('late transport error');
    expect(persistedAttempt).toMatchObject({ status: 'DELIVERED', resolvedAt });
    expect(persistedMessage).toMatchObject({ status: 'DELIVERED', deliveredAt: resolvedAt });
  });

  it('does not project an older attempt exception over a newer retry', async () => {
    messageFindUniqueMock.mockResolvedValueOnce(queuedMessage('msg_1'));
    providerDeliverMock.mockImplementationOnce(async () => {
      latestAttemptId = 'newer-attempt'; persistedMessage.status = 'SENDING';
      throw new Error('older attempt failed');
    });
    await expect(runCommunicationOutboundJob({ messageId: 'msg_1' })).rejects.toThrow('older attempt failed');
    expect(persistedAttempt.status).toBe('FAILED');
    expect(persistedMessage.status).toBe('SENDING');
  });

  it('records a normal provider exception as FAILED and retains retry signalling', async () => {
    messageFindUniqueMock.mockResolvedValueOnce(queuedMessage('msg_1'));
    providerDeliverMock.mockRejectedValueOnce(new Error('transport failed'));
    await expect(runCommunicationOutboundJob({ messageId: 'msg_1' })).rejects.toThrow('transport failed');
    expect(persistedAttempt).toMatchObject({ status: 'FAILED', errorCode: 'UNHANDLED_DELIVERY_EXCEPTION' });
    expect(persistedMessage.status).toBe('FAILED');
  });

  it('does not downgrade a concurrent completion in the maximum-attempt guard', async () => {
    messageFindUniqueMock.mockResolvedValueOnce(queuedMessage('msg_1'));
    deliveryAttemptCountMock.mockImplementationOnce(async () => {
      persistedMessage.status = 'DELIVERED';
      return 3;
    });
    await runCommunicationOutboundJob({ messageId: 'msg_1' });
    expect(persistedMessage.status).toBe('DELIVERED');
    expect(providerDeliverMock).not.toHaveBeenCalled();
  });

  it('does not retry delivery when the tracking row disappears after provider acceptance', async () => {
    messageFindUniqueMock.mockResolvedValueOnce(queuedMessage('msg_missing_attempt'));
    deliveryAttemptUpdateMock.mockRejectedValueOnce(Object.assign(new Error('Record to update not found'), { code: 'P2025' }));

    await expect(runCommunicationOutboundJob({ messageId: 'msg_missing_attempt' })).resolves.toBeUndefined();

    expect(providerDeliverMock).toHaveBeenCalledTimes(1);
    expect(messageUpdateMock).not.toHaveBeenCalled();
  });

  it('short-circuits without dispatching when the payload carries no messageId', async () => {
    await runCommunicationOutboundJob({ eventId: 'evt_only' });
    expect(messageFindUniqueMock).not.toHaveBeenCalled();
    expect(providerDeliverMock).not.toHaveBeenCalled();
  });

  it('rejects a non-object payload at the parse boundary', async () => {
    await expect(runCommunicationOutboundJob('not-an-object')).rejects.toThrow();
    expect(providerDeliverMock).not.toHaveBeenCalled();
  });

  it('payload schema admits both flat and envelope shapes', () => {
    expect(CommunicationOutboundPayloadSchema.parse({ messageId: 'a' }).messageId).toBe('a');
    expect(CommunicationOutboundPayloadSchema.parse({ data: { messageId: 'b' } }).data?.messageId).toBe('b');
  });
});
