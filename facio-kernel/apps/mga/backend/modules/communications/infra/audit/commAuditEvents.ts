/**
 * Communication Audit Events — emits structured domain events for the communications lifecycle.
 *
 * Events emitted:
 * - COMM.MESSAGE_SENT     — outbound message successfully sent
 * - COMM.MESSAGE_DELIVERED — delivery confirmation received
 * - COMM.MESSAGE_FAILED   — delivery failed
 * - COMM.MESSAGE_RECEIVED — inbound message received
 * - COMM.NOTE_CREATED     — internal note logged
 *
 * These are AUDIT-ONLY events: they land in the outbox table for compliance
 * but have no worker handler by design. The relay treats them as
 * `audit_only` via `AUDIT_ONLY_EVENT_TYPES` in
 * `backend/platform/events/queue.ts` and never enqueues them. If you add
 * a new audit event here, also add it to that set or the relay will
 * exhaust 3 retries with `Unsupported data-sync queue job:` (this was
 * ABBEYGATE-7 before the 2026-05-17 fix).
 */
import { runTenantScopedTransaction } from '../../../../platform/db/connection.js';
import { buildDomainEvent, appendDomainEvent } from '../../../../platform/events/domainEvents.js';
import type { Prisma } from '@prisma/client';
import { logger } from '../../../../platform/utils/logger.js';

interface AuditContext {
    messageId: string;
    threadId?: string;
    entityType: string;
    entityId: string;
    channel: string;
    actorId: string;
    actorType?: 'USER' | 'SYSTEM' | 'CUSTOMER' | 'UNDERWRITER' | 'OPS';
}

function redact(value: string | undefined | null): string {
    if (!value) return '';
    if (value.includes('@')) {
        // Email: show first 2 chars + domain
        const [local, domain] = value.split('@');
        return `${local?.slice(0, 2)}***@${domain}`;
    }
    if (/^\+?\d{7,}$/.test(value.replace(/[\s\-()]/g, ''))) {
        // Phone: show last 4 digits
        return `***${value.slice(-4)}`;
    }
    return value;
}

export async function emitCommAuditEvent(
    eventType: string,
    ctx: AuditContext,
    extra?: Record<string, unknown>,
): Promise<void> {
    try {
        const eventData: Prisma.InputJsonValue = {
            threadId: ctx.threadId,
            entityType: ctx.entityType,
            entityId: ctx.entityId,
            channel: ctx.channel,
            // PII-redacted in event payload
            ...(extra?.recipient ? { recipient: redact(String(extra.recipient)) } : {}),
            ...(extra?.errorCode ? { errorCode: extra.errorCode } : {}),
            ...(extra?.provider ? { provider: extra.provider } : {}),
            ...(extra?.attemptNumber ? { attemptNumber: extra.attemptNumber } : {}),
        };
        const event = buildDomainEvent({
            eventType,
            aggregateType: 'COMMUNICATION',
            aggregateId: ctx.messageId,
            aggregateVersion: Date.now(),
            actorType: ctx.actorType || 'SYSTEM',
            actorId: ctx.actorId,
            data: eventData,
        });

        await runTenantScopedTransaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
            await appendDomainEvent(tx, event);
        });
    } catch (err) {
        // Audit failures must never break the main flow
        logger.error({ event: 'comms.audit.emit_failed', eventType, err }, 'comms.audit.emit_failed');
    }
}
