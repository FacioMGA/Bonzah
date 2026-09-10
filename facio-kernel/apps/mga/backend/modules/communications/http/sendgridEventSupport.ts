import { z } from 'zod';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';

export const SendgridEventSchema = z.object({
    event: z.string(),
    timestamp: z.number().optional(),
    sg_event_id: z.string().optional(),
    sg_message_id: z.string().optional(),
    'smtp-id': z.string().optional(),
    email: z.string().optional(),
    reason: z.string().optional(),
    response: z.string().optional(),
    status: z.string().optional(),
    unique_args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    custom_args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
}).passthrough();

export type SendgridEvent = z.infer<typeof SendgridEventSchema>;
export type SendgridAttemptStatus = 'SENDING' | 'SENT' | 'DELIVERED' | 'BOUNCED' | 'FAILED';
export type SendgridMessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED';

function readSendgridMessageIds(event: SendgridEvent): string[] {
    // SendGrid flattens v3 custom arguments into event fields. Retain the
    // nested legacy forms, but never silently choose between conflicting IDs.
    return [...new Set([
        event.communicationMessageId,
        event.messageId,
        event.custom_args?.communicationMessageId,
        event.custom_args?.messageId,
        event.unique_args?.communicationMessageId,
        event.unique_args?.messageId,
    ].filter((value): value is string => typeof value === 'string' && value.trim() !== '').map((value) => value.trim()))];
}

function sendgridMessageIdCandidates(value: string): string[] {
    const normalized = String(value || '').trim();
    if (!normalized) return [];
    const root = normalized.split('.')[0]?.trim() || '';
    return [...new Set([normalized, root].filter(Boolean))];
}

export function mapSendgridEventToAttemptStatus(eventName: string): SendgridAttemptStatus | null {
    const event = String(eventName || '').trim().toLowerCase();
    if (event === 'processed') return 'SENT';
    if (event === 'delivered') return 'DELIVERED';
    if (event === 'deferred') return 'SENDING';
    if (event === 'bounce') return 'BOUNCED';
    if (event === 'dropped' || event === 'blocked') return 'FAILED';
    return null;
}

export function mapAttemptStatusToMessageStatus(status: SendgridAttemptStatus): SendgridMessageStatus {
    if (status === 'DELIVERED') return 'DELIVERED';
    if (status === 'BOUNCED' || status === 'FAILED') return 'FAILED';
    if (status === 'SENDING') return 'QUEUED';
    return 'SENT';
}

export function statusPriority(status: string): number {
    switch (String(status || '').toUpperCase()) {
        case 'FAILED':
            return 5;
        case 'DELIVERED':
            return 4;
        case 'SENT':
            return 3;
        case 'QUEUED':
            return 2;
        case 'SENDING':
            return 1;
        default:
            return 0;
    }
}

export async function resolveSendgridAttempt(event: SendgridEvent) {
    const messageIds = readSendgridMessageIds(event);
    if (messageIds.length > 1) return null;
    const communicationMessageId = messageIds[0];
    const providerMessageId = String(event.sg_message_id || '').trim();
    const providerMessageIdCandidates = sendgridMessageIdCandidates(providerMessageId);
    if (providerMessageIdCandidates.length > 0) {
        const exactAttempts = await tenantScopedPrisma.communicationDeliveryAttempt.findMany({
            where: { externalId: { in: providerMessageIdCandidates }, provider: 'SENDGRID', channel: 'EMAIL' },
            include: { message: true },
            take: 2,
        });
        if (exactAttempts.length > 1) return null;
        const exactAttempt = exactAttempts[0];
        if (exactAttempt) return !communicationMessageId || exactAttempt.messageId === communicationMessageId ? exactAttempt : null;

        if (communicationMessageId) {
            const attempts = await tenantScopedPrisma.communicationDeliveryAttempt.findMany({
                where: { messageId: communicationMessageId, provider: 'SENDGRID', channel: 'EMAIL' },
                include: { message: true },
                take: 2,
            });
            const attempt = attempts.length === 1 ? attempts[0] : null;
            if (!attempt || String(attempt.externalId || '').trim()) return null;
            const refs = attempt.message.externalRefs;
            const knownProviderId = refs && typeof refs === 'object' && !Array.isArray(refs) ? refs.providerMessageId : null;
            // A first-attempt callback can precede persistence of x-message-id.
            // Only an explicit, unambiguous message identity with no conflicting
            // stored provider evidence may bridge that transport race.
            return !knownProviderId || (typeof knownProviderId === 'string' && providerMessageIdCandidates.includes(knownProviderId.trim())) ? attempt : null;
        }

        // Some legacy sends kept the provider ID only on the message. An
        // exact reference and exactly one attempt are required to recover it;
        // substring matches or a message-ID hint cannot identify a retry.
        const messages = await tenantScopedPrisma.communicationMessage.findMany({
            where: {
                provider: 'SENDGRID',
                channel: 'EMAIL',
                ...(communicationMessageId ? { id: communicationMessageId } : {}),
                OR: providerMessageIdCandidates.map((candidate) => ({
                    externalRefs: { path: ['providerMessageId'], equals: candidate },
                })),
            },
            take: 2,
        });
        if (messages.length !== 1) return null;
        const attempts = await tenantScopedPrisma.communicationDeliveryAttempt.findMany({
            where: { messageId: messages[0].id, provider: 'SENDGRID', channel: 'EMAIL' },
            include: { message: true },
            take: 2,
        });
        const attempt = attempts.length === 1 ? attempts[0] : null;
        return attempt && (!attempt.externalId || providerMessageIdCandidates.includes(attempt.externalId)) ? attempt : null;
    }

    if (!communicationMessageId) return null;
    const attempts = await tenantScopedPrisma.communicationDeliveryAttempt.findMany({
        where: { messageId: communicationMessageId, provider: 'SENDGRID', channel: 'EMAIL' },
        include: { message: true },
        take: 2,
    });
    return attempts.length === 1 ? attempts[0] : null;
}
