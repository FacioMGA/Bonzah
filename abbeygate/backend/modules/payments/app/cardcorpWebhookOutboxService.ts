import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';

import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { buildDomainEvent } from '../../../platform/events/domainEvents.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';

export async function writeCardcorpWebhookOutboxEvent(eventType: string, details: Prisma.InputJsonValue) {
  const record = parseRecord(details);
  const envelope = buildDomainEvent({
    eventType,
    aggregateType: 'WEBHOOK',
    aggregateId: String(record.customPolicyId || record.payloadId || record.receivedAt || crypto.randomUUID()),
    aggregateVersion: Date.now(),
    actorType: 'SYSTEM',
    actorId: 'cardcorp-webhook',
    data: details,
  });
  const outboxData: Prisma.OutboxUncheckedCreateInput = {
    operatingTenantId: getTenantConfig().id,
    aggregateId: envelope.aggregateId,
    eventType: envelope.eventType,
    payload: envelope as Prisma.InputJsonValue,
  };
  await tenantScopedPrisma.outbox.create({ data: outboxData });
}
