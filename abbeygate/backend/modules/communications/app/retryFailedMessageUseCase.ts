import { runTenantScopedTransaction, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { appendDomainEvent, buildDomainEvent } from '../../../platform/events/domainEvents.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import { logger } from '../../../platform/utils/logger.js';

export type RetryFailedMessageResult =
  | { status: 'REQUEUED'; messageId: string; previousAttempts: number }
  | { status: 'NOT_FOUND' | 'NOT_FAILED' | 'MAX_ATTEMPTS'; messageId?: string };

/**
 * Canonical retry for a failed outbound communication. It retains the same
 * audit message and creates a new outbox delivery event; it never fabricates
 * a new recipient, template, or tenant context.
 */
export async function retryFailedMessage(messageId: string): Promise<RetryFailedMessageResult> {
  const message = await tenantScopedPrisma.communicationMessage.findUnique({
    where: { id: messageId },
  });
  if (!message) return { status: 'NOT_FOUND' };
  if (message.status !== 'FAILED') return { status: 'NOT_FAILED', messageId };

  const previousAttempts = await tenantScopedPrisma.communicationDeliveryAttempt.count({
    where: { messageId },
  });
  if (previousAttempts >= 3) return { status: 'MAX_ATTEMPTS', messageId };

  await runTenantScopedTransaction(async (tx) => {
    const envelope = buildDomainEvent({
      eventType: 'COMM.OUTBOUND_QUEUED',
      aggregateType: 'COMMUNICATION',
      aggregateId: messageId,
      aggregateVersion: Date.now(),
      actorType: 'SYSTEM',
      actorId: 'system',
      idempotencyKey: `retry:${messageId}:${previousAttempts + 1}`,
      data: { messageId },
    });
    await tx.communicationMessage.update({ where: { id: messageId }, data: { status: 'QUEUED' } });
    await appendDomainEvent(tx, envelope);
  });

  logger.info({ event: 'comms.retry.queued', messageId, attemptCount: previousAttempts + 1 }, 'comms.retry.queued');
  return { status: 'REQUEUED', messageId, previousAttempts };
}

/**
 * Product callers name their template but do not own email status or outbox
 * writes. This keeps a re-rate retry on the same communication record.
 */
export async function retryLatestFailedCustomerEmailForPolicy(input: {
  policyId: string;
  templateKey: string;
}): Promise<RetryFailedMessageResult | { status: 'NO_MATCH' }> {
  const messages = await tenantScopedPrisma.communicationMessage.findMany({
    where: {
      status: 'FAILED',
      direction: 'OUTBOUND',
      channel: 'EMAIL',
      thread: { entityType: 'POLICY', entityId: input.policyId },
    },
    select: { id: true, externalRefs: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const message = messages.find(
    (candidate) => String(parseRecord(candidate.externalRefs).templateKey || '') === input.templateKey,
  );
  return message ? retryFailedMessage(message.id) : { status: 'NO_MATCH' };
}
