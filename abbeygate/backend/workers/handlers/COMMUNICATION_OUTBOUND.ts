import { Job } from 'bullmq';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db/connection.js';
import { logger } from '../../platform/utils/logger.js';
import { ensureCorrelationId, runWithCorrelationId } from '../../platform/observability/context.js';
import { registerHandler, JobHandler } from '../index.js';
import { ProviderRouter } from '../../modules/communications/infra/providerRouter.js';
import { emitCommAuditEvent } from '../../modules/communications/infra/audit/commAuditEvents.js';
import { loadOperatingTenantForCommThread } from '../../platform/tenant/tenantJobContext.js';
import { runWithOperatingTenant } from '../../platform/tenant/tenantAls.js';
import { finaliseSyntheticEmailDelivery } from '../../modules/communications/app/syntheticEmailAudit.js';

function isSyntheticMessage(externalRefs: unknown): boolean {
    return Boolean(
        externalRefs
        && typeof externalRefs === 'object'
        && (externalRefs as { synthetic?: unknown }).synthetic === true,
    );
}

// Producer (canonical): backend/platform/events/queue.ts (relay) wraps
// the outbox row in a DomainEventEnvelope. The relay always sets
// `messageId` directly OR inside the envelope's `data` block, plus the
// envelope's own `eventId` and `correlationId`. The schema below
// reflects that union shape so the worker no longer launders the
// payload through a polite-any record cast.
export const CommunicationOutboundPayloadSchema = z.object({
    messageId: z.string().optional(),
    eventId: z.string().optional(),
    correlationId: z.string().optional(),
    data: z.object({
        messageId: z.string().optional(),
    }).optional(),
});

const MAX_DELIVERY_ATTEMPTS = 3;

function isPrismaRecordNotFoundError(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && (err as { code?: unknown }).code === 'P2025');
}

/**
 * ABY-77 — bind the operating tenant for an audit-event emit derived
 * from the comm thread's entity. When the tenant cannot be resolved
 * (unknown entity type, missing row, etc.) we log and skip so the
 * worker stays alive — audit failures must never break delivery.
 */
async function emitWithCommThreadTenant(
    auditCtx: { entityType: string; entityId: string; messageId: string },
    emit: () => Promise<void>,
): Promise<void> {
    const tenant = await loadOperatingTenantForCommThread({
        entityType: auditCtx.entityType,
        entityId: auditCtx.entityId,
    });
    if (!tenant) {
        logger.warn(
            {
                event: 'comms.audit.tenant_unresolved',
                messageId: auditCtx.messageId,
                entityType: auditCtx.entityType,
                entityId: auditCtx.entityId,
            },
            'comms.audit.tenant_unresolved',
        );
        return;
    }
    try {
        await runWithOperatingTenant(tenant, emit);
    } catch (err) {
        logger.error(
            {
                event: 'comms.audit.emit_failed_after_tenant_bind',
                messageId: auditCtx.messageId,
                err,
            },
            'comms.audit.emit_failed_after_tenant_bind',
        );
    }
}

/**
 * Communications outbound worker — processes queued outbound messages.
 *
 * Flow:
 * 1. Load message + count existing attempts
 * 2. Guard: skip if maxAttempts exceeded
 * 3. Transition status to SENDING
 * 4. Create delivery attempt record
 * 5. Route to provider via ProviderRouter
 * 6. Update delivery attempt + message status
 * 7. Emit audit event
 */
// Pure body exposed for ADR-0029 typed-handler contract tests.
// The JobHandler shim below forwards `job.data` + `job.id` so tests
// can drive the canonical payload-acceptance path without coercing
// a synthetic Job at the seam.
export async function runCommunicationOutboundJob(
    rawJobData: unknown,
    jobId: string | number = 'test',
): Promise<void> {
    const payload = CommunicationOutboundPayloadSchema.parse(rawJobData);
    const messageId = (payload.messageId ?? payload.data?.messageId ?? '').trim();
    const correlationId = ensureCorrelationId(payload.correlationId);
    const eventId = (payload.eventId ?? '').trim() || undefined;
    if (!messageId) {
        logger.warn({ event: 'comms.worker.missing_message_id', jobId, eventId }, 'comms.worker.missing_message_id');
        return;
    }

    return runWithCorrelationId(correlationId, async () => {
        logger.info({ event: 'comms.worker.started', messageId, jobId, eventId }, 'comms.worker.started');
        const msg = await prisma.communicationMessage.findUnique({
            where: { id: messageId },
            include: { thread: { select: { entityType: true, entityId: true } } },
        });
        if (!msg) {
            logger.warn({ event: 'comms.worker.message_not_found', messageId, eventId }, 'comms.worker.message_not_found');
            return;
        }

        // Allow retries from FAILED status
        if (msg.status !== 'QUEUED' && msg.status !== 'FAILED') {
            logger.info({ event: 'comms.worker.skipped_non_queued', messageId, status: msg.status }, 'comms.worker.skipped_non_queued');
            return;
        }

        // Count existing attempts — guard against infinite retries
        const attemptCount = await prisma.communicationDeliveryAttempt.count({
            where: { messageId },
        });
        if (attemptCount >= MAX_DELIVERY_ATTEMPTS) {
            logger.warn({ event: 'comms.outbound.max_attempts_reached', messageId, attemptCount }, 'comms.outbound.max_attempts_reached');
            await prisma.communicationMessage.update({
                where: { id: messageId },
                data: { status: 'FAILED' },
            });
            return;
        }

        // 1. Transition to SENDING atomically (dedupe against concurrent workers/retries).
        const claim = await prisma.communicationMessage.updateMany({
            where: {
                id: messageId,
                status: { in: ['QUEUED', 'FAILED'] },
            },
            data: { status: 'SENDING' },
        });
        if (claim.count !== 1) {
            logger.info({ event: 'comms.worker.concurrent_skip', messageId }, 'comms.worker.concurrent_skip');
            return;
        }

        // 2. Create delivery attempt
        const attempt = await prisma.communicationDeliveryAttempt.create({
            data: {
                messageId,
                provider: msg.provider,
                channel: msg.channel,
                status: 'SENDING',
            },
        });

        try {
            // 3. Route to provider
            logger.info({
                event: 'comms.provider.attempt',
                messageId,
                attemptId: attempt.id,
                provider: msg.provider,
                channel: msg.channel,
            }, 'comms.provider.attempt');
            const result = await ProviderRouter.deliver({
                id: msg.id,
                channel: msg.channel,
                provider: msg.provider,
                fromActor: msg.fromActor,
                toRecipients: msg.toRecipients,
                subject: msg.subject,
                body: msg.body,
                attachments: msg.attachments,
                externalRefs: msg.externalRefs,
            });

            let finalStatus: 'SENT' | 'DELIVERED' | 'FAILED' = 'FAILED';
            try {
                // 4. Update delivery attempt
                await prisma.communicationDeliveryAttempt.update({
                    where: { id: attempt.id },
                    data: {
                        status: result.status,
                        externalId: result.externalId ?? null,
                        errorCode: result.errorCode ?? null,
                        errorDetail: result.errorDetail ?? null,
                        resolvedAt: new Date(),
                    },
                });

                // 5. Update message status
                finalStatus = result.status === 'SENT' || result.status === 'DELIVERED'
                    ? result.status
                    : 'FAILED';
                const messageUpdate: Prisma.CommunicationMessageUpdateInput = { status: finalStatus };
                if (result.sentAt) messageUpdate.sentAt = result.sentAt;
                if (result.deliveredAt) messageUpdate.deliveredAt = result.deliveredAt;
                const existingRefs = msg.externalRefs && typeof msg.externalRefs === 'object'
                    ? (msg.externalRefs as Prisma.JsonObject)
                    : {};
                if (result.externalId) {
                    messageUpdate.externalRefs = {
                        ...existingRefs,
                        providerMessageId: result.externalId,
                    };
                }

                await prisma.communicationMessage.update({
                    where: { id: messageId },
                    data: messageUpdate,
                });
            } catch (finalizeErr) {
                if (!isPrismaRecordNotFoundError(finalizeErr)) throw finalizeErr;
                logger.warn(
                    {
                        event: 'comms.delivery.finalize_record_missing',
                        messageId,
                        attemptId: attempt.id,
                        providerStatus: result.status,
                        externalId: result.externalId,
                        err: finalizeErr,
                    },
                    'comms.delivery.finalize_record_missing',
                );
                return;
            }

            // 6. Emit audit event
            const recipients = Array.isArray(msg.toRecipients) ? msg.toRecipients : [msg.toRecipients];
            const auditCtx = {
                messageId,
                threadId: msg.threadId,
                entityType: msg.thread?.entityType || '',
                entityId: msg.thread?.entityId || '',
                channel: msg.channel,
                actorId: msg.fromActor,
            };

            if (finalStatus === 'FAILED') {
                logger.warn(
                    {
                        event: 'comms.provider.failed',
                        messageId,
                        attemptId: attempt.id,
                        errorCode: result.errorCode,
                        errorDetail: result.errorDetail,
                        attempt: attemptCount + 1,
                    },
                    'comms.provider.failed',
                );
                // ABY-77 — bind operating tenant before the audit emit; the
                // outbox table is tenant-scoped and the prior fire-and-forget
                // call was throwing TenantContextError at runtime, polluting
                // worker logs even though delivery itself succeeded.
                await emitWithCommThreadTenant(auditCtx, () =>
                    emitCommAuditEvent('COMM.MESSAGE_FAILED', auditCtx, {
                        recipient: String(recipients[0] || ''),
                        errorCode: result.errorCode,
                        provider: msg.provider,
                        attemptNumber: attemptCount + 1,
                    }),
                );
            } else {
                logger.info(
                    {
                        event: 'comms.provider.sent',
                        messageId,
                        status: result.status,
                        attemptId: attempt.id,
                        externalId: result.externalId,
                    },
                    'comms.provider.sent',
                );
                await emitWithCommThreadTenant(auditCtx, () =>
                    emitCommAuditEvent('COMM.MESSAGE_SENT', auditCtx, {
                        recipient: String(recipients[0] || ''),
                        provider: msg.provider,
                    }),
                );
            }
            logger.info({ event: 'comms.delivery.finalized', messageId, attemptId: attempt.id, finalStatus }, 'comms.delivery.finalized');

            // Phase 3 — close out the synthetic-run audit with the real delivery
            // outcome so the record is not stuck at QUEUED. Keyed by messageId;
            // best-effort (must never affect real delivery).
            if (isSyntheticMessage(msg.externalRefs)) {
                await finaliseSyntheticEmailDelivery({
                    messageId,
                    result: finalStatus,
                    deliveryIds: result.externalId ? [result.externalId] : [messageId],
                    resultDetail: finalStatus === 'FAILED'
                        ? (result.errorCode || result.errorDetail || 'delivery_failed')
                        : null,
                });
            }
        } catch (err) {
            await prisma.communicationDeliveryAttempt.update({
                where: { id: attempt.id },
                data: {
                    status: 'FAILED',
                    errorCode: 'UNHANDLED_DELIVERY_EXCEPTION',
                    errorDetail: err instanceof Error ? err.message : String(err),
                    resolvedAt: new Date(),
                },
            }).catch(() => undefined);
            await prisma.communicationMessage.update({
                where: { id: messageId },
                data: { status: 'FAILED' },
            }).catch(() => undefined);
            logger.error({ event: 'comms.worker.failed', messageId, attemptId: attempt.id, err }, 'comms.worker.failed');
            throw err;
        }
    });
}

export const handleCommunicationOutbound: JobHandler = (job: Job) =>
    runCommunicationOutboundJob(job.data, job.id ?? 'unknown');

registerHandler('COMM.OUTBOUND_QUEUED', handleCommunicationOutbound);
