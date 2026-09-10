import { createHash } from 'node:crypto';
import { buildDomainEvent } from './domainEvents.js';

export function isUniqueOutboxEventIdError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002';
}

export function buildIssuedPackReconcileEvent(args: {
  tenantId: string;
  actorId: 'queue-bootstrap' | 'queue-reconcile';
  scheduleKey: string;
  limit: number;
}): ReturnType<typeof buildDomainEvent> {
  const idempotencyKey = `issued-pack-reconcile:${args.scheduleKey}:${args.tenantId}`;
  return buildDomainEvent({
    eventId: `issued-pack-reconcile:${createHash('sha256').update(idempotencyKey).digest('hex')}`,
    eventType: 'POLICY.ISSUED_PACK_RECONCILE',
    aggregateType: 'POLICY',
    aggregateId: 'system',
    aggregateVersion: Date.now(),
    actorType: 'SYSTEM',
    actorId: args.actorId,
    idempotencyKey,
    data: {
      operatingTenantId: args.tenantId,
      limit: args.limit,
    },
  });
}
