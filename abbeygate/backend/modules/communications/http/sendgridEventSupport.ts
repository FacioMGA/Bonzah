import { z } from 'zod';
import { prisma } from '../../../platform/db/connection.js';

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

function readSendgridCustomArgs(event: SendgridEvent): Record<string, string> {
    const sources = [event.custom_args, event.unique_args];
    const merged: Record<string, string> = {};
    for (const source of sources) {
        if (!source) continue;
        for (const [key, value] of Object.entries(source)) {
            merged[key] = String(value);
        }
    }
    return merged;
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
    const customArgs = readSendgridCustomArgs(event);
    const communicationMessageId = String(
        customArgs.communicationMessageId || customArgs.messageId || '',
    ).trim();
    if (communicationMessageId) {
        const latestForMessage = await prisma.communicationDeliveryAttempt.findFirst({
            where: { messageId: communicationMessageId, provider: 'SENDGRID', channel: 'EMAIL' },
            include: { message: true },
            orderBy: { attemptedAt: 'desc' },
        });
        if (latestForMessage) return latestForMessage;
    }

    const providerMessageId = String(event.sg_message_id || '').trim();
    const providerMessageIdCandidates = sendgridMessageIdCandidates(providerMessageId);
    if (providerMessageIdCandidates.length > 0) {
        const exactAttempt = await prisma.communicationDeliveryAttempt.findFirst({
            where: { externalId: { in: providerMessageIdCandidates }, provider: 'SENDGRID', channel: 'EMAIL' },
            include: { message: true },
            orderBy: { attemptedAt: 'desc' },
        });
        if (exactAttempt) return exactAttempt;

        for (const candidate of providerMessageIdCandidates) {
            const message = await prisma.communicationMessage.findFirst({
                where: {
                    provider: 'SENDGRID',
                    channel: 'EMAIL',
                    externalRefs: {
                        path: ['providerMessageId'],
                        string_contains: candidate,
                    },
                },
            });
            if (message) {
                return prisma.communicationDeliveryAttempt.findFirst({
                    where: { messageId: message.id, provider: 'SENDGRID', channel: 'EMAIL' },
                    include: { message: true },
                    orderBy: { attemptedAt: 'desc' },
                });
            }
        }
    }

    return null;
}
