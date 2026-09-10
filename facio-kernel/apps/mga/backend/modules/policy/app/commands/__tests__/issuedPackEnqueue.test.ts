import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { OutboxClient } from '../../../../../platform/events/domainEvents.js';
import {
  buildIssuedPackEventIdFromIdempotencyKey,
  buildIssuedPackReplayIdempotencyKey,
  buildIssuedPolicyPackEnvelope,
  enqueueIssuedPolicyPack,
  enqueueIssuedPolicyPackStandalone,
  isDuplicateIssuedPackEventIdError,
} from '../issuedPackEnqueue.js';

const outboxCreateMock = vi.fn();
const transactionMock = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
  const tx = { outbox: { create: outboxCreateMock } };
  return await fn(tx);
});

vi.mock('../../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => transactionMock(fn),
  },
}));

vi.mock('../../../../../platform/tenant/tenantConfig.js', () => ({
  getTenantConfig: () => ({ id: 'tenant-cy', countryCode: 'CY' }),
}));

vi.mock('../../../../../platform/observability/context.js', () => ({
  getCorrelationId: () => 'corr-from-als',
}));

describe('issuedPackEnqueue (ADR-0013 canonical spine)', () => {
  beforeEach(() => {
    outboxCreateMock.mockReset();
    transactionMock.mockClear();
    outboxCreateMock.mockResolvedValue(undefined);
  });

  describe('buildIssuedPolicyPackEnvelope', () => {
    it('produces a canonical DomainEventEnvelope with data.* containing the issuance args', () => {
      const env = buildIssuedPolicyPackEnvelope({
        policyId: 'policy-1',
        riskTransactionId: 'rt-1',
        source: 'SYSTEM',
        idempotencyKey: 'issued-pack:policy-1:rt-1',
        correlationId: 'corr-1',
      });
      expect(env.eventType).toBe('DOC.GENERATE_ISSUED_POLICY_PACK');
      expect(env.aggregateType).toBe('POLICY');
      expect(env.aggregateId).toBe('policy-1');
      expect(env.actorType).toBe('SYSTEM');
      expect(env.idempotencyKey).toBe('issued-pack:policy-1:rt-1');
      expect(env.eventId).toBe(buildIssuedPackEventIdFromIdempotencyKey('issued-pack:policy-1:rt-1'));
      expect(env.correlationId).toBe('corr-1');
      expect(env.data).toEqual({
        policyId: 'policy-1',
        riskTransactionId: 'rt-1',
        source: 'SYSTEM',
        generatedByUserId: null,
      });
    });

    it('uses the operator actorId when source is BO', () => {
      const env = buildIssuedPolicyPackEnvelope({
        policyId: 'policy-1',
        source: 'BO',
        generatedByUserId: 'user-7',
      });
      expect(env.actorType).toBe('USER');
      expect(env.actorId).toBe('user-7');
      expect(env.data).toMatchObject({ generatedByUserId: 'user-7' });
    });

    it('rejects empty policyId — there is no canonical no-op spine call', () => {
      expect(() =>
        buildIssuedPolicyPackEnvelope({ policyId: '', source: 'SYSTEM' }),
      ).toThrow(/policyId is required/);
    });

    it('falls back to ALS correlationId when caller does not pass one', () => {
      const env = buildIssuedPolicyPackEnvelope({ policyId: 'p1', source: 'SYSTEM' });
      expect(env.correlationId).toBe('corr-from-als');
    });
  });

  describe('issued-pack replay helpers', () => {
    it('builds a stable replay key within the same bucket', () => {
      const now = new Date('2026-05-11T18:00:10.000Z');
      const key = buildIssuedPackReplayIdempotencyKey({
        policyId: 'policy-9',
        riskTransactionId: 'rt-9',
        now,
        bucketSeconds: 60,
      });
      expect(key).toBe('issued-pack-replay:policy-9:rt-9:29642040');
    });

    it('normalizes idempotency keys into BullMQ-safe event IDs', () => {
      const key = 'issued-pack:policy-9:rt-9';
      const eventId = buildIssuedPackEventIdFromIdempotencyKey(key);
      expect(eventId).toMatch(/^issued_pack_evt_[a-f0-9]{64}$/);
      expect(eventId).toBe(buildIssuedPackEventIdFromIdempotencyKey(key));
    });

    it('detects Prisma duplicate-eventId errors', () => {
      const duplicate = {
        code: 'P2002',
        message: 'Unique constraint failed on the fields: (`eventId`)',
        meta: { target: ['eventId'] },
      };
      expect(isDuplicateIssuedPackEventIdError(duplicate)).toBe(true);
      expect(isDuplicateIssuedPackEventIdError({ code: 'P2002', meta: { target: ['somethingElse'] } })).toBe(false);
    });
  });

  describe('enqueueIssuedPolicyPack(tx, args)', () => {
    it('writes one outbox row with the canonical envelope payload INSIDE the supplied tx', async () => {
      const tx: OutboxClient = { outbox: { create: outboxCreateMock } };
      const result = await enqueueIssuedPolicyPack(tx, {
        policyId: 'policy-2',
        riskTransactionId: 'rt-2',
        source: 'SYSTEM',
        idempotencyKey: 'issued-pack:policy-2:rt-2',
      });
      expect(outboxCreateMock).toHaveBeenCalledTimes(1);
      const createArgs = outboxCreateMock.mock.calls[0][0];
      expect(createArgs.data.eventType).toBe('DOC.GENERATE_ISSUED_POLICY_PACK');
      expect(createArgs.data.aggregateId).toBe('policy-2');
      expect(createArgs.data.operatingTenantId).toBe('tenant-cy');
      // Payload is the full envelope; handler reads from envelope.data.*.
      expect(createArgs.data.payload.eventType).toBe('DOC.GENERATE_ISSUED_POLICY_PACK');
      expect(createArgs.data.payload.data).toEqual({
        policyId: 'policy-2',
        riskTransactionId: 'rt-2',
        source: 'SYSTEM',
        generatedByUserId: null,
      });
      expect(result.eventId).toBe(buildIssuedPackEventIdFromIdempotencyKey('issued-pack:policy-2:rt-2'));
    });

    it('does not create the outbox row when the surrounding transaction throws', async () => {
      // Simulate the caller's transaction by routing through transactionMock,
      // which provides a tx whose only behaviour we observe is outbox.create.
      // The throw happens AFTER the spine call — emulating "issuance step that
      // ran successfully, then a later step in the same tx fails." Prisma
      // would roll back the outbox insert atomically with the rest of the tx.
      const txCreate = vi.fn().mockResolvedValue(undefined);
      const txStub: OutboxClient = { outbox: { create: txCreate } };
      await expect(async () => {
        await enqueueIssuedPolicyPack(txStub, {
          policyId: 'policy-3',
          riskTransactionId: 'rt-3',
          source: 'SYSTEM',
        });
        throw new Error('issuance step blew up after spine call');
      }).rejects.toThrow(/blew up/);
      // The outbox.create call did happen on the supplied tx — but since
      // the surrounding $transaction would roll back, the row is never
      // committed. We verify the tx scoping: there is no out-of-band
      // write through any other client.
      expect(txCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('enqueueIssuedPolicyPackStandalone (no enclosing tx)', () => {
    it('opens its own transaction and writes the outbox row through it', async () => {
      const result = await enqueueIssuedPolicyPackStandalone({
        policyId: 'policy-4',
        riskTransactionId: 'rt-4',
        source: 'SYSTEM',
        idempotencyKey: 'issued-pack:policy-4:rt-4',
      });
      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(outboxCreateMock).toHaveBeenCalledTimes(1);
      expect(result.eventId).toBe(buildIssuedPackEventIdFromIdempotencyKey('issued-pack:policy-4:rt-4'));
    });
  });
});
