import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommunicationsService } from '../communicationsService.ts';
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';

/**
 * `CommunicationsService.createMessage` opens its transaction on
 * {@link tenantScopedPrisma}, not the base `prisma` client (per ADR-0009 row-
 * level tenancy: `Outbox` is a tenant-scoped table that requires the
 * fail-closed extension). The mock therefore exposes both clients but only
 * `tenantScopedPrisma.$transaction` is exercised by these tests.
 *
 * The outbox event itself is appended by `appendDomainEvent`, which wraps the
 * raw `tx.outbox.create(...)` call in the canonical `DomainEventEnvelope`
 * shape (`eventId`, `eventType`, `aggregateId`, `idempotencyKey`, `payload`,
 * `operatingTenantId`). The assertions below reflect that contract end-to-end
 * rather than the legacy `{ eventType, aggregateId }`-only call.
 */
vi.mock('../../../../platform/db/connection.js', () => {
  const baseClient = {
    communicationThread: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    communicationMessage: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    outbox: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return {
    prisma: baseClient,
    tenantScopedPrisma: {
      $transaction: vi.fn(),
    },
  };
});

type MockTransactionClient = {
  communicationMessage: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  communicationThread: {
    update: ReturnType<typeof vi.fn>;
  };
  outbox: {
    create: ReturnType<typeof vi.fn>;
  };
};

function buildMockTx(overrides?: Partial<MockTransactionClient>): MockTransactionClient {
  return {
    communicationMessage: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      ...(overrides?.communicationMessage ?? {}),
    },
    communicationThread: {
      update: vi.fn(),
      ...(overrides?.communicationThread ?? {}),
    },
    outbox: {
      create: vi.fn(),
      ...(overrides?.outbox ?? {}),
    },
  };
}

function bindTransactionMock(mockTx: MockTransactionClient): void {
  const txFn = tenantScopedPrisma.$transaction as unknown as {
    mockImplementation: (impl: (cb: (tx: MockTransactionClient) => unknown) => unknown) => void;
  };
  txFn.mockImplementation((cb) => cb(mockTx));
}

describe('CommunicationsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createMessage', () => {
    it('writes the message and a Truth-First outbox envelope when QUEUED + OUTBOUND', async () => {
      const mockTx = buildMockTx({
        communicationMessage: {
          create: vi.fn().mockResolvedValue({ id: 'msg-1', status: 'QUEUED' }),
          findFirst: vi.fn().mockResolvedValue(null),
        },
      });
      bindTransactionMock(mockTx);

      const params = {
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        provider: 'SENDGRID',
        fromActor: 'SYSTEM',
        toRecipients: ['test@example.com'],
        subject: 'Test Subject',
        body: 'Test Body',
        status: 'QUEUED',
        externalRefs: { source: 'unit-test' },
      };

      const result = await CommunicationsService.createMessage('thread-123', params);

      expect(mockTx.communicationMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          threadId: 'thread-123',
          direction: 'OUTBOUND',
          channel: 'EMAIL',
          toRecipients: ['test@example.com'],
          status: 'QUEUED',
          externalRefs: expect.objectContaining({
            source: 'unit-test',
            tenantCountryCode: 'CY',
          }),
        }),
      });

      expect(mockTx.communicationThread.update).toHaveBeenCalledWith({
        where: { id: 'thread-123' },
        data: { lastActivityAt: expect.any(Date) },
      });

      expect(mockTx.outbox.create).toHaveBeenCalledTimes(1);
      const outboxArg = mockTx.outbox.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(outboxArg.data).toEqual(
        expect.objectContaining({
          eventType: 'COMM.OUTBOUND_QUEUED',
          aggregateId: 'msg-1',
          operatingTenantId: expect.any(String),
          eventId: expect.any(String),
          idempotencyKey: expect.any(String),
          payload: expect.objectContaining({
            eventType: 'COMM.OUTBOUND_QUEUED',
            aggregateType: 'COMMUNICATION',
            aggregateId: 'msg-1',
            actorType: 'SYSTEM',
            data: expect.objectContaining({ messageId: 'msg-1', threadId: 'thread-123' }),
          }),
        }),
      );

      expect(result.id).toBe('msg-1');
    });

    it('does not append an outbox event when the message is INTERNAL/LOGGED', async () => {
      const mockTx = buildMockTx({
        communicationMessage: {
          create: vi.fn().mockResolvedValue({ id: 'msg-internal', status: 'LOGGED' }),
          findFirst: vi.fn().mockResolvedValue(null),
        },
      });
      bindTransactionMock(mockTx);

      const params = {
        direction: 'INTERNAL',
        channel: 'NOTE',
        provider: 'SYSTEM',
        fromActor: 'tester',
        toRecipients: [],
        body: 'Internal note',
        status: 'LOGGED',
      };

      await CommunicationsService.createMessage('thread-123', params);

      expect(mockTx.outbox.create).not.toHaveBeenCalled();
    });

    it('returns the existing message and skips writes on idempotency-key hit', async () => {
      const existing = { id: 'msg-existing', status: 'QUEUED' };
      const mockTx = buildMockTx({
        communicationMessage: {
          create: vi.fn(),
          findFirst: vi.fn().mockResolvedValue(existing),
        },
      });
      bindTransactionMock(mockTx);

      const result = await CommunicationsService.createMessage('thread-123', {
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        provider: 'SENDGRID',
        fromActor: 'SYSTEM',
        toRecipients: ['test@example.com'],
        body: 'Hi',
        status: 'QUEUED',
        idempotencyKey: 'idem-1',
      });

      expect(mockTx.communicationMessage.findFirst).toHaveBeenCalledWith({
        where: { threadId: 'thread-123', idempotencyKey: 'idem-1' },
      });
      expect(mockTx.communicationMessage.create).not.toHaveBeenCalled();
      expect(mockTx.communicationThread.update).not.toHaveBeenCalled();
      expect(mockTx.outbox.create).not.toHaveBeenCalled();
      expect(result.id).toBe('msg-existing');
    });
  });
});
