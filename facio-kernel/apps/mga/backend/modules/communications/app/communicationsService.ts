import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { Prisma } from '@prisma/client';
import { appendDomainEvent, buildDomainEvent } from '../../../platform/events/domainEvents.js';
import { logger } from '../../../platform/utils/logger.js';
import crypto from 'node:crypto';
import { enqueueClaimMemoryRefresh } from '../../claims/infra/mailgraph/enqueueClaimMemoryRefresh.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';

function asJsonObject(value: Prisma.InputJsonValue | undefined): Prisma.JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Prisma.JsonObject
        : {};
}

function stampEmailTenantCountry(input: {
    direction: string;
    channel: string;
    externalRefs?: Prisma.InputJsonValue;
}): Prisma.InputJsonValue | undefined {
    if (input.direction !== 'OUTBOUND' || input.channel !== 'EMAIL') {
        return input.externalRefs;
    }
    return {
        ...asJsonObject(input.externalRefs),
        tenantCountryCode: getTenantConfig().countryCode,
    };
}

export class CommunicationsService {
    /**
     * Retrieves a thread, or creates one if it doesn't exist.
     */
    static async getOrCreateThread(
        entityType: string,
        entityId: string,
        primaryPartyId?: string
    ) {
        let thread = await tenantScopedPrisma.communicationThread.findFirst({
            where: { entityType, entityId },
        });

        if (!thread) {
            thread = await tenantScopedPrisma.communicationThread.create({
                data: {
                    entityType,
                    entityId,
                    primaryPartyId,
                },
            });
            logger.info({ event: 'comms.thread.created', threadId: thread.id, entityType, entityId }, 'comms.thread.created');
        }

        return thread;
    }

    /**
     * Creates a message and an outbox event in a single transaction.
     */
    static async createMessage(
        threadId: string,
        input: {
            direction: string;
            channel: string;
            provider: string;
            fromActor: string;
            toRecipients: Prisma.InputJsonValue;
            subject?: string;
            body?: string;
            attachments?: Prisma.InputJsonValue;
            status?: string;
            communicationType?: string;
            externalRefs?: Prisma.InputJsonValue;
            idempotencyKey?: string;
        }
    ) {
        const status = input.status || 'QUEUED';
        const communicationType = input.communicationType || 'EXTERNAL';
        const externalRefs = stampEmailTenantCountry(input);

        // We must use a transaction to ensure Truth-First (SoR + Outbox write together).
        return await runTenantScopedTransaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
            if (input.idempotencyKey) {
                const existing = await tx.communicationMessage.findFirst({
                    where: {
                        threadId,
                        idempotencyKey: input.idempotencyKey,
                    },
                });
                if (existing) {
                    logger.info({
                        event: 'comms.message.idempotent_hit',
                        messageId: existing.id,
                        threadId,
                        idempotencyKey: input.idempotencyKey,
                    }, 'comms.message.idempotent_hit');
                    return existing;
                }
            }

            // 1. the SoR record
            const message = await tx.communicationMessage.create({
                data: {
                    threadId,
                    direction: input.direction,
                    channel: input.channel,
                    provider: input.provider,
                    communicationType,
                    fromActor: input.fromActor,
                    toRecipients: input.toRecipients,
                    subject: input.subject,
                    body: input.body || '',
                    attachments: input.attachments,
                    externalRefs,
                    status,
                    idempotencyKey: input.idempotencyKey || null,
                },
            });
            logger.info({
                event: 'comms.message.created',
                messageId: message.id,
                threadId,
                direction: input.direction,
                channel: input.channel,
                provider: input.provider,
                status,
            }, 'comms.message.created');

            // 2. update thread lastActivity
            await tx.communicationThread.update({
                where: { id: threadId },
                data: { lastActivityAt: new Date() },
            });

            // 2b. CLAIM_MEMORY refresh hook (ADR-0041).  Any inbound or
            // operator-driven message on a CLAIM thread invalidates the
            // cached `ClaimMemoryProjection`.  System-only outbound
            // queue rows (welcome / link emails) do not change claim
            // context, so we skip them; the BullMQ debounce + idempotent
            // pipeline absorbs duplicate enqueues anyway.  The thread
            // is looked up via `findFirst` (rather than the `update`
            // return) so the legacy callers + tests that mock `update`
            // as a void function keep working.
            const shouldRefreshClaim =
                input.direction === 'INBOUND' ||
                input.direction === 'INTERNAL' ||
                (input.direction === 'OUTBOUND' && input.fromActor !== 'SYSTEM' && input.fromActor !== 'system');
            if (shouldRefreshClaim) {
                const findThread = (tx as unknown as { communicationThread?: { findUnique?: (args: unknown) => Promise<{ id: string; entityType: string; entityId: string } | null> } }).communicationThread?.findUnique;
                const threadRow = typeof findThread === 'function'
                    ? await findThread({ where: { id: threadId }, select: { id: true, entityType: true, entityId: true } })
                    : null;
                if (threadRow && threadRow.entityType === 'CLAIM' && threadRow.entityId) {
                    await enqueueClaimMemoryRefresh(tx, {
                        claimId: threadRow.entityId,
                        reason: 'email_arrived',
                        actorId: input.fromActor,
                        actorType: input.fromActor === 'SYSTEM' || input.fromActor === 'system' ? 'SYSTEM' : 'USER',
                    });
                }
            }

            // 3. Outbox event (if OUTBOUND and not just LOGGED)
            if (input.direction === 'OUTBOUND' && status === 'QUEUED') {
                const envelopeIdempotencyKey = input.idempotencyKey
                    || crypto.createHash('sha256').update(`comm:${message.id}:${threadId}`).digest('hex');
                const envelope = buildDomainEvent({
                    eventType: 'COMM.OUTBOUND_QUEUED',
                    aggregateType: 'COMMUNICATION',
                    aggregateId: message.id,
                    aggregateVersion: Date.now(),
                    actorType: 'SYSTEM',
                    actorId: 'system',
                    data: { messageId: message.id, threadId },
                    idempotencyKey: envelopeIdempotencyKey,
                });
                await appendDomainEvent(tx, envelope);
                logger.info({
                    event: 'comms.outbox.queued',
                    messageId: message.id,
                    threadId,
                    eventId: envelope.eventId,
                    correlationId: envelope.correlationId,
                }, 'comms.outbox.queued');
            }

            return message;
        });
    }
}
