import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks at the adapter boundary. The handler reads the comm message
// from Prisma, transitions status, creates a delivery attempt, calls
// ProviderRouter.deliver, then emits an audit event. We only need the
// happy path for the contract assertion — deeper provider routing is
// proved by communications.test.ts at tier 2/3.

const messageFindUniqueMock = vi.fn();
const messageUpdateMock = vi.fn(async () => undefined);
const messageUpdateManyMock = vi.fn(async () => ({ count: 1 }));
const deliveryAttemptCreateMock = vi.fn(async () => ({ id: 'attempt_1' }));
const deliveryAttemptUpdateMock = vi.fn(async () => undefined);
const deliveryAttemptCountMock = vi.fn(async () => 0);

vi.mock('../../../platform/db/connection.js', () => ({
  prisma: {
    communicationMessage: {
      findUnique: messageFindUniqueMock,
      update: messageUpdateMock,
      updateMany: messageUpdateManyMock,
    },
    communicationDeliveryAttempt: {
      count: deliveryAttemptCountMock,
      create: deliveryAttemptCreateMock,
      update: deliveryAttemptUpdateMock,
    },
  },
}));

const providerDeliverMock = vi.fn(async () => ({ status: 'SENT', externalId: 'ext_1', sentAt: new Date() }));
vi.mock('../../../modules/communications/infra/providerRouter.js', () => ({
  ProviderRouter: { deliver: (...args: unknown[]) => providerDeliverMock(...args) },
}));

const emitCommAuditEventMock = vi.fn(async () => undefined);
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
