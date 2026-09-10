import type { DeliveryResult } from '../../domain/types.js';
import { logger } from '../../../../platform/utils/logger.js';

interface MessagePayload {
    id: string;
    channel: string;
    provider: string;
    fromActor: string;
    toRecipients: unknown;
    subject: string | null;
    body: string;
}

function normalizeRecipients(raw: unknown): string[] {
    const recipients = Array.isArray(raw) ? raw : [raw];
    return recipients
        .map((item) => String(item || '').trim())
        .filter((item) => item.length > 0);
}

function basicAuth(accountSid: string, authToken: string): string {
    return `Basic ${Buffer.from(`${accountSid}:${authToken}`, 'utf8').toString('base64')}`;
}

function normalizeWhatsappAddress(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.startsWith('whatsapp:') ? raw : `whatsapp:${raw}`;
}

function resolvePublicApiBase(): string {
    return String(
        process.env.PUBLIC_API_BASE_URL ||
        process.env.PUBLIC_BASE_URL ||
        process.env.APP_BASE_URL ||
        'http://localhost:3000'
    ).trim().replace(/\/$/, '');
}

async function postTwilioMessage(params: {
    accountSid: string;
    authToken: string;
    body: URLSearchParams;
}) {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
            Authorization: basicAuth(params.accountSid, params.authToken),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.body.toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const rec = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
        throw new Error(String(rec.message || `Twilio request failed (${response.status})`));
    }
    return payload as Record<string, unknown>;
}

export async function sendSms(msg: MessagePayload): Promise<DeliveryResult> {
    const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
    const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
    const from = String(process.env.TWILIO_SMS_FROM || '').trim();
    const messagingServiceSid = String(process.env.TWILIO_SMS_MESSAGING_SERVICE_SID || '').trim();
    const recipients = normalizeRecipients(msg.toRecipients);

    if (!accountSid || !authToken || (!from && !messagingServiceSid)) {
        logger.warn({ event: 'comms.sms.not_configured', messageId: msg.id }, 'comms.sms.not_configured');
        return {
            status: 'FAILED',
            errorCode: 'SMS_NOT_CONFIGURED',
            errorDetail: 'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN and SMS sender configuration are required',
        };
    }
    if (!recipients.length) {
        return {
            status: 'FAILED',
            errorCode: 'NO_RECIPIENT',
            errorDetail: 'No valid recipient phone number provided',
        };
    }

    try {
        const ids: string[] = [];
        for (const to of recipients) {
            const body = new URLSearchParams();
            body.set('To', to);
            body.set('Body', msg.body || '');
            body.set('StatusCallback', `${resolvePublicApiBase()}/api/webhooks/twilio/status`);
            if (messagingServiceSid) body.set('MessagingServiceSid', messagingServiceSid);
            else body.set('From', from);
            const payload = await postTwilioMessage({ accountSid, authToken, body });
            const externalId = String(payload.sid || '');
            ids.push(externalId);
            logger.info({ event: 'comms.sms.sent', messageId: msg.id, to, externalId }, 'comms.sms.sent');
        }
        return {
            status: 'SENT',
            externalId: ids[0],
            sentAt: new Date(),
        };
    } catch (err) {
        logger.error({ event: 'comms.sms.failed', messageId: msg.id, err }, 'comms.sms.failed');
        return {
            status: 'FAILED',
            errorCode: 'SMS_SEND_ERROR',
            errorDetail: err instanceof Error ? err.message : String(err),
        };
    }
}

export async function sendWhatsapp(msg: MessagePayload): Promise<DeliveryResult> {
    const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
    const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
    const from = normalizeWhatsappAddress(process.env.TWILIO_WHATSAPP_FROM || '');
    const recipients = normalizeRecipients(msg.toRecipients).map(normalizeWhatsappAddress).filter(Boolean);

    if (!accountSid || !authToken || !from) {
        logger.warn({ event: 'comms.whatsapp.not_configured', messageId: msg.id }, 'comms.whatsapp.not_configured');
        return {
            status: 'FAILED',
            errorCode: 'WHATSAPP_NOT_CONFIGURED',
            errorDetail: 'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_WHATSAPP_FROM are required',
        };
    }
    if (!recipients.length) {
        return {
            status: 'FAILED',
            errorCode: 'NO_RECIPIENT',
            errorDetail: 'No valid WhatsApp recipient provided',
        };
    }

    try {
        const ids: string[] = [];
        for (const to of recipients) {
            const body = new URLSearchParams();
            body.set('To', to);
            body.set('From', from);
            body.set('Body', msg.subject ? `${msg.subject}\n\n${msg.body || ''}` : (msg.body || ''));
            body.set('StatusCallback', `${resolvePublicApiBase()}/api/webhooks/twilio/status`);
            const payload = await postTwilioMessage({ accountSid, authToken, body });
            const externalId = String(payload.sid || '');
            ids.push(externalId);
            logger.info({ event: 'comms.whatsapp.sent', messageId: msg.id, to, externalId }, 'comms.whatsapp.sent');
        }
        return {
            status: 'SENT',
            externalId: ids[0],
            sentAt: new Date(),
        };
    } catch (err) {
        logger.error({ event: 'comms.whatsapp.failed', messageId: msg.id, err }, 'comms.whatsapp.failed');
        return {
            status: 'FAILED',
            errorCode: 'WHATSAPP_SEND_ERROR',
            errorDetail: err instanceof Error ? err.message : String(err),
        };
    }
}
