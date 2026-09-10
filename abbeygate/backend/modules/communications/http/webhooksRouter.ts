import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { logger } from '../../../platform/utils/logger.js';
import { z } from 'zod';
import crypto from 'crypto';
import { createPublicKey, verify as verifySignature } from 'crypto';
import { registerWebhookReplayAttempt } from '../../../platform/security/webhookReplayGuard.js';
import {
    mapAttemptStatusToMessageStatus,
    mapSendgridEventToAttemptStatus,
    resolveSendgridAttempt,
    SendgridEventSchema,
    statusPriority,
} from './sendgridEventSupport.js';

const router = Router();
const INBOUND_WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;
const InboundWebhookRawBodySchema = z.union([
    z.string(),
    z.instanceof(Buffer),
    z.record(z.string(), z.unknown()),
]);
const TwilioSignatureParamsSchema = z.record(z.string(), z.unknown());

function getInboundWebhookSecret(): string {
    return String(process.env.INBOUND_WEBHOOK_SECRET || '').trim();
}

function readRawBody(body: unknown): string {
    const b = body;
    if (typeof b === 'string') return b;
    if (Buffer.isBuffer(b)) return new TextDecoder().decode(b as Uint8Array);
    if (b && typeof b === 'object') {
        try {
            return JSON.stringify(b);
        } catch {
            return '';
        }
    }
    return '';
}

function readRawBodyBytes(body: unknown): Buffer {
    const b = body;
    if (Buffer.isBuffer(b)) return b;
    if (typeof b === 'string') return Buffer.from(b, 'utf8');
    return Buffer.from(readRawBody(b), 'utf8');
}

function readHeader(req: { headers: Record<string, unknown> }, key: string): string {
    const v = req.headers[key] ?? req.headers[key.toLowerCase()];
    return typeof v === 'string' ? v.trim() : '';
}

function signatureFor(rawBody: string, timestamp: string, secret: string): string {
    return crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');
}

async function createCommunicationMessage(
    tx: Prisma.TransactionClient,
    data: {
        threadId: string;
        direction: string;
        channel: string;
        provider: string;
        fromActor: string;
        toRecipients: string[];
        body: string;
        subject?: string;
        status: string;
        receivedAt?: Date;
        externalRefs?: Prisma.InputJsonValue;
    }
) {
    await tx.communicationMessage.create({
        data: {
            threadId: data.threadId,
            direction: data.direction,
            channel: data.channel,
            provider: data.provider,
            fromActor: data.fromActor,
            toRecipients: data.toRecipients,
            body: data.body,
            subject: data.subject,
            status: data.status,
            receivedAt: data.receivedAt,
            externalRefs: data.externalRefs,
        }
    });
}

function resolveExternalBaseUrl(req: { protocol?: string; headers: Record<string, unknown>; originalUrl?: string; path?: string }): string {
    const configured = String(
        process.env.PUBLIC_API_BASE_URL ||
        process.env.PUBLIC_BASE_URL ||
        process.env.APP_BASE_URL ||
        ''
    ).trim().replace(/\/$/, '');
    const host = readHeader(req, 'x-forwarded-host') || readHeader(req, 'host');
    const proto = readHeader(req, 'x-forwarded-proto') || req.protocol || 'https';
    const path = String(req.originalUrl || req.path || '').trim();
    if (configured && path) return `${configured}${path}`;
    return `${proto}://${host}${path}`;
}

function verifyTwilioSignature(args: {
    url: string;
    params: Record<string, unknown>;
    signature: string;
    authToken: string;
}): boolean {
    const payload = Object.keys(args.params)
        .sort()
        .reduce((acc, key) => acc + key + String(args.params[key] ?? ''), args.url);
    const expected = crypto
        .createHmac('sha1', args.authToken)
        .update(payload, 'utf8')
        .digest('base64');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const providedBuffer = Buffer.from(args.signature, 'utf8');
    if (expectedBuffer.length !== providedBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function normalizePhoneAddress(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^whatsapp:/i.test(raw)) {
        return `whatsapp:${raw.slice('whatsapp:'.length)}`;
    }
    return raw;
}

async function verifyTwilioWebhook(req: { protocol?: string; headers: Record<string, unknown>; originalUrl?: string; path?: string; body?: unknown }): Promise<{ ok: boolean; reason?: string }> {
    const signature = readHeader(req, 'x-twilio-signature');
    const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
    if (!signature || !authToken) {
        return { ok: false, reason: 'Missing Twilio signature or auth token' };
    }
    const parsedParams = TwilioSignatureParamsSchema.safeParse(req.body || {});
    const body = parsedParams.success ? parsedParams.data : {};
    const url = resolveExternalBaseUrl(req);
    const ok = verifyTwilioSignature({
        url,
        params: body,
        signature,
        authToken,
    });
    if (!ok) return { ok: false, reason: 'Invalid Twilio webhook signature' };
    const messageSid = String(body.MessageSid || body.SmsSid || '').trim();
    const replayKey = messageSid || JSON.stringify(body);
    const replay = await registerWebhookReplayAttempt({
        namespace: 'communications:twilio',
        payload: replayKey,
        signature,
        timestamp: String(Date.now()),
        ttlSeconds: 60 * 10,
    });
    if (replay.duplicate) return { ok: false, reason: 'Duplicate webhook payload rejected' };
    return { ok: true };
}

async function verifyInboundWebhook(req: { headers: Record<string, unknown>; body?: unknown }): Promise<{ ok: boolean; reason?: string }> {
    const secret = getInboundWebhookSecret();
    if (!secret) {
        return { ok: false, reason: 'Webhook secret not configured' };
    }

    const timestamp =
        readHeader(req, 'x-webhook-timestamp') ||
        readHeader(req, 'x-timestamp') ||
        readHeader(req, 'x-sendgrid-timestamp') ||
        '';
    const signature =
        readHeader(req, 'x-webhook-signature') ||
        readHeader(req, 'x-facio-signature') ||
        readHeader(req, 'x-sendgrid-signature') ||
        '';
    if (!timestamp || !signature) {
        return { ok: false, reason: 'Missing webhook authentication headers' };
    }

    const tsMs = Number(timestamp);
    if (!Number.isFinite(tsMs)) {
        return { ok: false, reason: 'Invalid timestamp' };
    }
    if (Math.abs(Date.now() - tsMs) > INBOUND_WEBHOOK_MAX_AGE_MS) {
        return { ok: false, reason: 'Webhook timestamp expired' };
    }

    const rawPayload = InboundWebhookRawBodySchema.safeParse(req.body);
    if (!rawPayload.success) {
        return { ok: false, reason: 'Invalid webhook payload shape' };
    }
    const rawBody = readRawBody(rawPayload.data);
    const expected = signatureFor(rawBody, timestamp, secret);
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signature, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { ok: false, reason: 'Invalid webhook signature' };
    }
    const replay = await registerWebhookReplayAttempt({
        namespace: 'communications:email_inbound',
        payload: rawBody,
        signature,
        timestamp,
        ttlSeconds: Math.ceil(INBOUND_WEBHOOK_MAX_AGE_MS / 1000),
    });
    if (replay.duplicate) {
        return { ok: false, reason: 'Duplicate webhook payload rejected' };
    }
    return { ok: true };
}

async function verifySendgridEventWebhook(req: {
    headers: Record<string, unknown>;
    payload: Array<z.infer<typeof SendgridEventSchema>>;
    rawBody?: Buffer;
}): Promise<{ ok: boolean; reason?: string }> {
    const signature = readHeader(req, 'x-twilio-email-event-webhook-signature');
    const timestamp = readHeader(req, 'x-twilio-email-event-webhook-timestamp');
    const publicKeyPem = String(process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY || '').trim();
    if (!signature || !timestamp || !publicKeyPem) {
        return { ok: false, reason: 'Missing SendGrid event webhook signature, timestamp, or public key' };
    }

    try {
        const publicKey = createPublicKey(publicKeyPem);
        const verified = verifySignature(
            'sha256',
            Buffer.concat([Buffer.from(timestamp, 'utf8'), req.rawBody || readRawBodyBytes(req.payload)]),
            { key: publicKey, dsaEncoding: 'der' },
            Buffer.from(signature, 'base64'),
        );
        if (!verified) return { ok: false, reason: 'Invalid SendGrid event webhook signature' };

        const replay = await registerWebhookReplayAttempt({
            namespace: 'communications:sendgrid:event',
            payload: readRawBody(req.payload),
            signature,
            timestamp,
            ttlSeconds: 60 * 10,
        });
        if (replay.duplicate) return { ok: false, reason: 'Duplicate webhook payload rejected' };
        return { ok: true };
    } catch (error) {
        logger.error({ event: 'comms.sendgrid_event.auth_failed', err: error }, 'comms.sendgrid_event.auth_failed');
        return { ok: false, reason: 'Failed to verify SendGrid event webhook signature' };
    }
}

const InboundEmailWebhookBodySchema = z.object({
    from: z.string().optional(),
    From: z.string().optional(),
    'body-plain': z.string().optional(),
    text: z.string().optional(),
    html: z.string().optional(),
    subject: z.string().optional(),
    Subject: z.string().optional(),
    'Message-Id': z.string().optional(),
    'Message-ID': z.string().optional(),
    'In-Reply-To': z.string().optional(),
    'in-reply-to': z.string().optional(),
    References: z.string().optional(),
    references: z.string().optional(),
});

const TwilioInboundWebhookBodySchema = z.object({
    MessageSid: z.string().optional(),
    SmsSid: z.string().optional(),
    SmsStatus: z.string().optional(),
    MessageStatus: z.string().optional(),
    Body: z.string().optional(),
    From: z.string().optional(),
    To: z.string().optional(),
    ChannelPrefix: z.string().optional(),
    ProfileName: z.string().optional(),
    WaId: z.string().optional(),
});

// Handle Mailgun/SendGrid inbound webhooks 
router.post('/email/inbound', async (req, res) => {
    try {
        const signatureCheck = await verifyInboundWebhook(req);
        if (!signatureCheck.ok) {
            const reason = signatureCheck.reason || 'Unauthorized';
            if (reason.toLowerCase().includes('duplicate')) {
                return res.status(409).send(reason);
            }
            return res.status(401).send(reason);
        }
        const parsed = InboundEmailWebhookBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).send('Invalid inbound payload');
        }
        const bodyPayload = parsed.data;
        // Simple extraction for MVP depending on the provider payload
        const fromRaw = bodyPayload.from || bodyPayload['From'];
        const from = typeof fromRaw === 'string' ? fromRaw.trim().toLowerCase() : '';
        const body = bodyPayload['body-plain'] || bodyPayload.text || bodyPayload.html || '';
        const subject = bodyPayload.subject || bodyPayload['Subject'] || '';
        const messageId = bodyPayload['Message-Id'] || bodyPayload['Message-ID'] || '';

        if (!from) {
            return res.status(400).send('Missing from address');
        }

        // 3-tier thread correlation:
        //   a. In-Reply-To / References → match externalRefs.messageId on existing messages
        //   b. Subject-line thread tag → [THREAD:uuid]
        //   c. Fallback → recipient array_contains (original strategy)

        const inReplyTo = bodyPayload['In-Reply-To'] || bodyPayload['in-reply-to'] || '';
        const references = bodyPayload['References'] || bodyPayload['references'] || '';
        const replyIds = [inReplyTo, ...references.split(/\s+/)].map(s => s.trim()).filter(Boolean);

        let threadId: string | undefined;

        // Strategy A: Match In-Reply-To against stored externalRefs.messageId
        if (replyIds.length > 0 && !threadId) {
            for (const refId of replyIds) {
                const matchedMsg = await prisma.communicationMessage.findFirst({
                    where: {
                        externalRefs: {
                            path: ['messageId'],
                            equals: refId,
                        },
                    },
                    select: { threadId: true },
                });
                if (matchedMsg?.threadId) {
                    threadId = matchedMsg.threadId;
                    logger.info({ event: 'comms.inbound.correlated_in_reply_to', threadId, refId }, 'comms.inbound.correlated_in_reply_to');
                    break;
                }
            }
        }

        // Strategy B: Subject-line thread tag [THREAD:uuid]
        if (!threadId && subject) {
            const threadTagMatch = subject.match(/\[THREAD:([a-f0-9-]+)\]/i);
            if (threadTagMatch?.[1]) {
                const taggedThread = await prisma.communicationThread.findUnique({
                    where: { id: threadTagMatch[1] },
                });
                if (taggedThread) {
                    threadId = taggedThread.id;
                    logger.info({ event: 'comms.inbound.correlated_subject_tag', threadId }, 'comms.inbound.correlated_subject_tag');
                }
            }
        }

        // Strategy C: Fallback — recipient array_contains (original)
        if (!threadId) {
            const recentThread = await prisma.communicationThread.findFirst({
                where: {
                    messages: {
                        some: {
                            toRecipients: {
                                array_contains: [from]
                            }
                        }
                    }
                },
                orderBy: { lastActivityAt: 'desc' },
            });
            threadId = recentThread?.id;
        }

        if (!threadId) {
            // Create an orphaned thread (entityId: UNKNOWN)
            const newThread = await prisma.communicationThread.create({
                data: {
                    entityType: 'PARTY',
                    entityId: 'UNKNOWN',
                }
            });
            threadId = newThread.id;
        }

        await tenantScopedPrisma.$transaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
            await createCommunicationMessage(tx, {
                threadId: threadId as string,
                direction: 'INBOUND',
                channel: 'EMAIL',
                provider: 'SYSTEM',
                fromActor: from,
                toRecipients: ['SUPPORT-INBOX'],
                body,
                subject,
                status: 'RECEIVED',
                receivedAt: new Date(),
                externalRefs: { messageId }
            });

            await tx.communicationThread.update({
                where: { id: threadId },
                data: { lastActivityAt: new Date() }
            });
        });

        logger.info({ event: 'comms.inbound.email_received', from, threadId, messageId }, 'comms.inbound.email_received');

        return res.status(200).send('OK');

    } catch (error) {
        logger.error({ event: 'comms.inbound.email_failed', err: error }, 'comms.inbound.email_failed');
        return res.status(500).send('Internal Server Error');
    }
});

async function correlateInboundThreadByAddress(from: string): Promise<string | null> {
    const recentThread = await prisma.communicationThread.findFirst({
        where: {
            messages: {
                some: {
                    toRecipients: {
                        array_contains: [from],
                    },
                },
            },
        },
        orderBy: { lastActivityAt: 'desc' },
        select: { id: true },
    });
    return recentThread?.id || null;
}

async function createInboundChannelMessage(args: {
    threadId: string;
    channel: 'SMS' | 'WHATSAPP';
    provider: 'TWILIO' | 'META_WHATSAPP';
    from: string;
    to: string;
    body: string;
    externalId?: string;
}) {
    await tenantScopedPrisma.$transaction(async (_tx) => {
      const tx = _tx as unknown as Prisma.TransactionClient;
        await createCommunicationMessage(tx, {
            threadId: args.threadId,
            direction: 'INBOUND',
            channel: args.channel,
            provider: args.provider,
            fromActor: args.from,
            toRecipients: [args.to],
            body: args.body,
            status: 'RECEIVED',
            receivedAt: new Date(),
            externalRefs: args.externalId ? { providerMessageId: args.externalId } : undefined,
        });
        await tx.communicationThread.update({
            where: { id: args.threadId },
            data: { lastActivityAt: new Date() },
        });
    });
}

router.post('/sms/inbound', async (req, res) => {
    try {
        const verification = await verifyTwilioWebhook(req);
        if (!verification.ok) return res.status(401).send(verification.reason || 'Unauthorized');
        const parsed = TwilioInboundWebhookBodySchema.safeParse(req.body || {});
        if (!parsed.success) return res.status(400).send('Invalid inbound SMS payload');
        const from = normalizePhoneAddress(String(parsed.data.From || '').trim());
        const to = normalizePhoneAddress(String(parsed.data.To || '').trim());
        const body = String(parsed.data.Body || '').trim();
        if (!from || !body) return res.status(400).send('Missing SMS sender or body');
        let threadId = await correlateInboundThreadByAddress(from);
        if (!threadId) {
            const newThread = await prisma.communicationThread.create({
                data: { entityType: 'PARTY', entityId: 'UNKNOWN' },
            });
            threadId = newThread.id;
        }
        await createInboundChannelMessage({
            threadId,
            channel: 'SMS',
            provider: 'TWILIO',
            from,
            to,
            body,
            externalId: String(parsed.data.MessageSid || parsed.data.SmsSid || ''),
        });
        logger.info({ event: 'comms.inbound.sms_received', from, threadId }, 'comms.inbound.sms_received');
        return res.status(200).send('OK');
    } catch (error) {
        logger.error({ event: 'comms.inbound.sms_failed', err: error }, 'comms.inbound.sms_failed');
        return res.status(500).send('Internal Server Error');
    }
});

router.post('/whatsapp/inbound', async (req, res) => {
    try {
        const verification = await verifyTwilioWebhook(req);
        if (!verification.ok) return res.status(401).send(verification.reason || 'Unauthorized');
        const parsed = TwilioInboundWebhookBodySchema.safeParse(req.body || {});
        if (!parsed.success) return res.status(400).send('Invalid inbound WhatsApp payload');
        const from = normalizePhoneAddress(String(parsed.data.From || '').trim());
        const to = normalizePhoneAddress(String(parsed.data.To || '').trim());
        const body = String(parsed.data.Body || '').trim();
        if (!from || !body) return res.status(400).send('Missing WhatsApp sender or body');
        let threadId = await correlateInboundThreadByAddress(from);
        if (!threadId) {
            const newThread = await prisma.communicationThread.create({
                data: { entityType: 'PARTY', entityId: 'UNKNOWN' },
            });
            threadId = newThread.id;
        }
        await createInboundChannelMessage({
            threadId,
            channel: 'WHATSAPP',
            provider: 'TWILIO',
            from,
            to,
            body,
            externalId: String(parsed.data.MessageSid || parsed.data.SmsSid || ''),
        });
        logger.info({ event: 'comms.inbound.whatsapp_received', from, threadId }, 'comms.inbound.whatsapp_received');
        return res.status(200).send('OK');
    } catch (error) {
        logger.error({ event: 'comms.inbound.whatsapp_failed', err: error }, 'comms.inbound.whatsapp_failed');
        return res.status(500).send('Internal Server Error');
    }
});

router.post('/twilio/status', async (req, res) => {
    try {
        const verification = await verifyTwilioWebhook(req);
        if (!verification.ok) return res.status(401).send(verification.reason || 'Unauthorized');
        const parsed = TwilioInboundWebhookBodySchema.safeParse(req.body || {});
        if (!parsed.success) return res.status(400).send('Invalid Twilio status payload');
        const messageSid = String(parsed.data.MessageSid || parsed.data.SmsSid || '').trim();
        const statusRaw = String(parsed.data.MessageStatus || parsed.data.SmsStatus || '').trim().toLowerCase();
        if (!messageSid || !statusRaw) return res.status(400).send('Missing message sid or status');

        const attempt = await prisma.communicationDeliveryAttempt.findFirst({
            where: { externalId: messageSid },
            include: { message: true },
            orderBy: { attemptedAt: 'desc' },
        });
        if (!attempt) return res.status(404).send('Unknown message sid');

        const mappedStatus =
            statusRaw === 'delivered'
                ? 'DELIVERED'
                : statusRaw === 'failed' || statusRaw === 'undelivered'
                    ? 'FAILED'
                    : statusRaw === 'sent' || statusRaw === 'queued' || statusRaw === 'accepted'
                        ? 'SENT'
                        : 'SENDING';

        const messageData: Record<string, unknown> = { status: mappedStatus };
        if (mappedStatus === 'DELIVERED') messageData.deliveredAt = new Date();
        if (mappedStatus === 'SENT') messageData.sentAt = new Date();

        await tenantScopedPrisma.$transaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
            await tx.communicationDeliveryAttempt.update({
                where: { id: attempt.id },
                data: {
                    status: mappedStatus,
                    errorCode: mappedStatus === 'FAILED' ? 'TWILIO_DELIVERY_FAILED' : null,
                    errorDetail: mappedStatus === 'FAILED' ? statusRaw : null,
                    resolvedAt: new Date(),
                },
            });
            await tx.communicationMessage.update({
                where: { id: attempt.messageId },
                data: messageData,
            });
            await tx.communicationThread.update({
                where: { id: attempt.message.threadId },
                data: { lastActivityAt: new Date() },
            });
        });
        logger.info({ event: 'comms.twilio.status_received', messageSid, mappedStatus, messageId: attempt.messageId }, 'comms.twilio.status_received');
        return res.status(200).send('OK');
    } catch (error) {
        logger.error({ event: 'comms.twilio.status_failed', err: error }, 'comms.twilio.status_failed');
        return res.status(500).send('Internal Server Error');
    }
});

router.post('/sendgrid/events', async (req, res) => {
    try {
        const parsed = z.array(SendgridEventSchema).safeParse(req.body || []);
        if (!parsed.success) return res.status(400).send('Invalid SendGrid event payload');

        const verification = await verifySendgridEventWebhook({
            headers: req.headers as Record<string, unknown>,
            payload: parsed.data,
            rawBody: (req as { rawBody?: Buffer }).rawBody,
        });
        if (!verification.ok) {
            const reason = verification.reason || 'Unauthorized';
            if (reason.toLowerCase().includes('duplicate')) {
                return res.status(409).send(reason);
            }
            return res.status(401).send(reason);
        }

        for (const event of parsed.data) {
            const attemptStatus = mapSendgridEventToAttemptStatus(event.event);
            if (!attemptStatus) continue;

            const attempt = await resolveSendgridAttempt(event);
            if (!attempt) {
                logger.warn({
                    event: 'comms.sendgrid_event.unmatched',
                    sendgridEvent: event.event,
                    email: event.email,
                    reason: event.reason || event.response || event.status,
                    sgEventId: event.sg_event_id,
                    sgMessageId: event.sg_message_id,
                }, 'comms.sendgrid_event.unmatched');
                continue;
            }

            const nextMessageStatus = mapAttemptStatusToMessageStatus(attemptStatus);
            const currentMessageStatus = String(attempt.message.status || '').toUpperCase();
            const finalMessageStatus = statusPriority(nextMessageStatus) >= statusPriority(currentMessageStatus)
                ? nextMessageStatus
                : (currentMessageStatus as 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED');

            const resolvedAt = event.timestamp ? new Date(Number(event.timestamp) * 1000) : new Date();
            const errorDetail = String(event.reason || event.response || event.status || event.event || '').trim() || null;

            await tenantScopedPrisma.$transaction(async (_tx) => {
              const tx = _tx as unknown as Prisma.TransactionClient;
                await tx.communicationDeliveryAttempt.update({
                    where: { id: attempt.id },
                    data: {
                        status: attemptStatus,
                        errorCode: attemptStatus === 'BOUNCED'
                            ? 'SENDGRID_BOUNCED'
                            : attemptStatus === 'FAILED'
                                ? 'SENDGRID_DELIVERY_FAILED'
                                : null,
                        errorDetail: attemptStatus === 'BOUNCED' || attemptStatus === 'FAILED' ? errorDetail : null,
                        resolvedAt,
                    },
                });

                const messageData: Record<string, unknown> = { status: finalMessageStatus };
                if ((attemptStatus === 'SENT' || attemptStatus === 'SENDING') && !attempt.message.sentAt) {
                    messageData.sentAt = resolvedAt;
                }
                if (attemptStatus === 'DELIVERED') {
                    messageData.deliveredAt = resolvedAt;
                    if (!attempt.message.sentAt) messageData.sentAt = resolvedAt;
                }

                await tx.communicationMessage.update({
                    where: { id: attempt.messageId },
                    data: messageData,
                });
                await tx.communicationThread.update({
                    where: { id: attempt.message.threadId },
                    data: { lastActivityAt: resolvedAt },
                });
            });

            logger.info({
                event: 'comms.sendgrid_event.received',
                messageId: attempt.messageId,
                attemptId: attempt.id,
                sendgridEvent: event.event,
                mappedStatus: attemptStatus,
            }, 'comms.sendgrid_event.received');
        }

        return res.status(200).send('OK');
    } catch (error) {
        logger.error({ event: 'comms.sendgrid_event.failed', err: error }, 'comms.sendgrid_event.failed');
        return res.status(500).send('Internal Server Error');
    }
});

export default router;
