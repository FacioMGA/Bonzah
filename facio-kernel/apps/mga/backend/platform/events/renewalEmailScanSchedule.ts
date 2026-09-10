import { createHash } from 'node:crypto';
import { buildDomainEvent } from './domainEvents.js';

export function buildRenewalEmailScanEvent(args: {
  tenantId: string;
  scheduleKey: string;
  scheduledAt: string;
}): ReturnType<typeof buildDomainEvent> {
  const idempotencyKey = `renewal-email-scan:${args.scheduleKey}:${args.tenantId}`;
  return buildDomainEvent({
    eventId: `renewal-email-scan:${createHash('sha256').update(idempotencyKey).digest('hex')}`,
    eventType: 'RENEWAL.EMAIL_SCAN',
    aggregateType: 'POLICY',
    aggregateId: 'system',
    aggregateVersion: Date.now(),
    actorType: 'SYSTEM',
    actorId: 'queue-renewal-scan',
    idempotencyKey,
    data: {
      operatingTenantId: args.tenantId,
      scheduledAt: args.scheduledAt,
    },
  });
}
