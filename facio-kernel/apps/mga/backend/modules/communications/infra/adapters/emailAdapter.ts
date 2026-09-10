import type { CommunicationAttachmentRef, DeliveryResult } from '../../domain/types.js';
import { smtpSendMail } from '../../../../platform/events/smtpClient.js';
import { emailPortService } from '../../app/services/emailPortService.js';
import { logger } from '../../../../platform/utils/logger.js';
import sgMail from '@sendgrid/mail';
import type { MailDataRequired } from '@sendgrid/helpers/classes/mail.js';
import { getTenantTermsAttachment } from './tenantTermsAttachment.js';
import { assertSyntheticRecipientsAllowed } from '../syntheticRecipientAllowlist.js';
import { getTenantConfig, getTenantRuntimeSettings } from '../../../../platform/tenant/tenantConfig.js';

interface MessagePayload {
    id: string;
    channel: string;
    provider: string;
    fromActor: string;
    toRecipients: unknown;
    subject: string | null;
    body: string;
    attachments?: unknown;
    externalRefs?: unknown; // May contain catalog template metadata and provider transport hints.
}

interface DeliveryAttachmentPayload {
    filename: string;
    content: string;
    type: string;
}

interface AttachmentRecordView {
    filename?: unknown;
    size?: unknown;
    mimetype?: unknown;
    url?: unknown;
    storageUri?: unknown;
    contentBase64?: unknown;
}

interface ExternalRefsView {
    providerTemplateId?: unknown;
    renderedHtml?: unknown;
    template?: unknown;
    tenantCountryCode?: unknown;
    synthetic?: unknown;
}

interface TemplateMetaView {
    variables?: unknown;
    templateId?: unknown;
    templateName?: unknown;
}

function normalizeRecipients(raw: unknown): string[] {
    const recipients = Array.isArray(raw) ? raw : [raw];
    return recipients
        .map((item) => String(item || '').trim())
        .filter((item) => item.length > 0);
}

function asAttachmentRecord(value: unknown): AttachmentRecordView {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as AttachmentRecordView
        : {};
}

function asExternalRefs(value: unknown): ExternalRefsView {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as ExternalRefsView
        : {};
}

/** Sender and reply identity belong to the exact current operating tenant. */
function assertMessageCountry(refs: ExternalRefsView): void {
    const country = String(refs.tenantCountryCode || '').trim().toUpperCase();
    if (country && country !== getTenantConfig().countryCode)
        throw new Error('TENANT_CONFIGURATION_INCOMPLETE: message country differs from operating tenant');
}
function resolveFromDisplayName(refs: ExternalRefsView): string {
    assertMessageCountry(refs);
    return getTenantRuntimeSettings().branding.displayName;
}

/** Compose an RFC 5322 `From` value, adding the display name when present. */
function formatFrom(email: string, displayName: string): string {
    const trimmed = displayName.trim();
    return trimmed ? `${trimmed} <${email}>` : email;
}

function resolveReplyTo(refs: ExternalRefsView): string {
    assertMessageCountry(refs);
    return getTenantRuntimeSettings().contact.email;
}

function asTemplateMeta(value: unknown): TemplateMetaView {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as TemplateMetaView
        : {};
}

function normalizeAttachments(raw: unknown): CommunicationAttachmentRef[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((item) => asAttachmentRecord(item))
        .map((item) => ({
            filename: String(item.filename || ''),
            size: typeof item.size === 'number' ? item.size : undefined,
            mimetype: item.mimetype ? String(item.mimetype) : undefined,
            url: item.url ? String(item.url) : undefined,
            storageUri: item.storageUri ? String(item.storageUri) : undefined,
            contentBase64: item.contentBase64 ? String(item.contentBase64) : undefined,
        }))
        .filter((item) => item.filename);
}

function appendTenantTermsAttachment(msg: MessagePayload): MessagePayload {
    const attachments = normalizeAttachments(msg.attachments);
    const refs = asExternalRefs(msg.externalRefs);
    const countryCode = String(refs.tenantCountryCode || '').trim();
    const termsAttachment = getTenantTermsAttachment(countryCode);
    if (!termsAttachment) {
        return { ...msg, attachments };
    }
    const alreadyAttached = attachments.some(
        (attachment) => attachment.filename.toLowerCase() === termsAttachment.filename.toLowerCase(),
    );
    return {
        ...msg,
        attachments: alreadyAttached ? attachments : [...attachments, termsAttachment],
    };
}

function toDeliveryAttachmentPayloads(raw: unknown): DeliveryAttachmentPayload[] {
    return normalizeAttachments(raw)
        .map((item) => ({
            filename: item.filename,
            content: String(item.contentBase64 || ''),
            type: String(item.mimetype || 'application/octet-stream'),
        }))
        .filter((item) => item.filename && item.content);
}

/**
 * EmailAdapter — delivers email via either:
 * 1. SMTP (raw text/html messages from the timeline composer)
 * 2. SendGrid dynamic template (via the EmailPort when templateId is provided)
 *
 * Produces a DeliveryResult for tracking.
 */
export async function sendEmail(msg: MessagePayload): Promise<DeliveryResult> {
    if (process.env.KERNEL_PLATFORM_MODE === 'true' && process.env.KERNEL_EXTERNAL_DELIVERY_ENABLED !== 'true') {
        return { status: 'FAILED', errorCode: 'EXTERNAL_DELIVERY_NOT_CONFIGURED', errorDetail: 'External email delivery is not configured for this deployment.' };
    }
    const message = appendTenantTermsAttachment(msg);
    const recipients = normalizeRecipients(message.toRecipients);
    const to = recipients[0] || '';

    if (!to) {
        return {
            status: 'FAILED',
            errorCode: 'NO_RECIPIENT',
            errorDetail: 'No valid recipient email address provided',
        };
    }

    // Check for provider-template-based send (explicit transport hint only).
    const refs = asExternalRefs(message.externalRefs);

    // Synthetic safety guardrail: a message flagged synthetic (canary / preview
    // / test-send) may ONLY be delivered to an allowlisted test mailbox. This is
    // fail-closed and caller-agnostic — even if a future caller forgets to point
    // a synthetic run at a sink, the transport refuses to email a real customer
    // or staff address. See infra/syntheticRecipientAllowlist.ts.
    if (refs.synthetic === true) {
        const check = assertSyntheticRecipientsAllowed(recipients);
        if (!check.ok) {
            logger.warn(
                {
                    event: 'comms.email.synthetic.blocked',
                    messageId: message.id,
                    blocked: check.blocked,
                },
                'comms.email.synthetic.blocked',
            );
            return {
                status: 'FAILED',
                errorCode: 'SYNTHETIC_RECIPIENT_NOT_ALLOWLISTED',
                errorDetail: `Synthetic email refused: recipient(s) not on the test allowlist: ${check.blocked.join(', ') || '(no recipients)'}`,
            };
        }
    }
    const providerTemplateId = refs.providerTemplateId ? String(refs.providerTemplateId) : '';
    const templateMeta = asTemplateMeta(refs.template);
    const templateVars = templateMeta.variables && typeof templateMeta.variables === 'object' && !Array.isArray(templateMeta.variables)
        ? templateMeta.variables as Parameters<typeof sendViaTemplate>[3]
        : {};

    if (providerTemplateId) {
        return sendViaTemplate(message.id, recipients, providerTemplateId, templateVars, toDeliveryAttachmentPayloads(message.attachments));
    }

    const provider = String(message.provider || '').toUpperCase();
    if (provider === 'SENDGRID') {
        return sendViaSendgridRaw(message);
    }

    return sendViaSmtp(message);
}

// ── SMTP path ───────────────────────────────────────────────────────────────

async function sendViaSmtp(msg: MessagePayload): Promise<DeliveryResult> {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
    const defaultFrom = process.env.NOTIFICATIONS_EMAIL_FROM || process.env.EMAIL_FROM_ADDRESS || 'no-reply@facio.io';
    const fromActorLooksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        String(msg.fromActor || '').trim(),
    );
    const fromEmail = fromActorLooksLikeEmail
        ? String(msg.fromActor).trim()
        : defaultFrom;
    const from = formatFrom(fromEmail, resolveFromDisplayName(asExternalRefs(msg.externalRefs)));

    const recipients = normalizeRecipients(msg.toRecipients);
    const to = recipients.join(',');

    if (!host || !port) {
        logger.warn({ event: 'comms.email.smtp.not_configured', messageId: msg.id }, 'comms.email.smtp.not_configured');
        return {
            status: 'FAILED',
            errorCode: 'SMTP_NOT_CONFIGURED',
            errorDetail: 'SMTP host or port not configured',
        };
    }

    try {
        const attachmentPayloads = toDeliveryAttachmentPayloads(msg.attachments);
        const replyTo = resolveReplyTo(asExternalRefs(msg.externalRefs));
        await smtpSendMail({
            host,
            port,
            secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
            user: process.env.SMTP_USER || undefined,
            pass: process.env.SMTP_PASS || undefined,
            from,
            to,
            subject: msg.subject || 'Facio Communication',
            text: msg.body || '',
            replyTo,
            attachments: attachmentPayloads.map((item) => ({
                filename: item.filename,
                contentBase64: item.content,
                mimetype: item.type,
            })),
        });

        logger.info({ event: 'comms.email.smtp.sent', messageId: msg.id, to }, 'comms.email.smtp.sent');
        return {
            status: 'SENT',
            sentAt: new Date(),
        };
    } catch (err) {
        logger.error({ event: 'comms.email.smtp.failed', messageId: msg.id, err }, 'comms.email.smtp.failed');
        return {
            status: 'FAILED',
            errorCode: 'SMTP_SEND_ERROR',
            errorDetail: err instanceof Error ? err.message : String(err),
        };
    }
}

async function sendViaSendgridRaw(msg: MessagePayload): Promise<DeliveryResult> {
    const apiKey = String(process.env.SENDGRID_API_KEY || '').trim();
    if (!apiKey) {
        return {
            status: 'FAILED',
            errorCode: 'SENDGRID_NOT_CONFIGURED',
            errorDetail: 'SENDGRID_API_KEY not configured',
        };
    }

    const refs = asExternalRefs(msg.externalRefs);
    const renderedHtml = typeof refs.renderedHtml === 'string' ? refs.renderedHtml : '';
    const templateMeta = asTemplateMeta(refs.template);
    const fromEmail = process.env.EMAIL_FROM_ADDRESS || process.env.NOTIFICATIONS_EMAIL_FROM || 'no-reply@facio.io';
    const fromDisplayName = resolveFromDisplayName(refs);
    const from = fromDisplayName ? { email: fromEmail, name: fromDisplayName } : fromEmail;
    const recipients = normalizeRecipients(msg.toRecipients);
    if (!recipients.length) {
        return {
            status: 'FAILED',
            errorCode: 'NO_RECIPIENT',
            errorDetail: 'No recipients for SendGrid raw send',
        };
    }

    const attachmentPayloads = toDeliveryAttachmentPayloads(msg.attachments);

    const replyTo = resolveReplyTo(refs);
    const payload: MailDataRequired = {
        to: recipients,
        from,
        ...(replyTo ? { replyTo } : {}),
        subject: msg.subject || 'Facio Communication',
        text: msg.body || '',
        html: renderedHtml || (msg.body || '').replace(/\n/g, '<br/>'),
        customArgs: {
            communicationMessageId: String(msg.id || ''),
            templateId: String(templateMeta.templateId || ''),
            templateName: String(templateMeta.templateName || ''),
        },
        headers: {
            'X-Idempotency-Key': String(msg.id || ''),
        },
        attachments: attachmentPayloads.map((item) => ({
            filename: item.filename,
            content: item.content,
            type: item.type,
            disposition: 'attachment',
        })) as MailDataRequired['attachments'],
    };

    try {
        sgMail.setApiKey(apiKey);
        const [response] = await sgMail.send(payload);
        const headers = response?.headers || {};
        const externalId = String(headers['x-message-id'] || '').trim() || undefined;
        logger.info({ event: 'comms.email.sendgrid_raw.sent', messageId: msg.id, recipients }, 'comms.email.sendgrid_raw.sent');
        return {
            status: 'SENT',
            externalId,
            sentAt: new Date(),
        };
    } catch (err) {
        logger.error({ event: 'comms.email.sendgrid_raw.failed', messageId: msg.id, err }, 'comms.email.sendgrid_raw.failed');
        return {
            status: 'FAILED',
            errorCode: 'SENDGRID_RAW_ERROR',
            errorDetail: err instanceof Error ? err.message : String(err),
        };
    }
}

// ── SendGrid template path ──────────────────────────────────────────────────

async function sendViaTemplate(
    messageId: string,
    recipients: string[],
    templateId: string,
    variables: Record<string, unknown>,
    attachments: DeliveryAttachmentPayload[],
): Promise<DeliveryResult> {
    try {
        const emailPort = emailPortService.getEmailPort();
        const ids: string[] = [];
        for (const to of recipients) {
            const externalId = await emailPort.send(to, templateId, variables, {
                customArgs: {
                    communicationMessageId: messageId,
                },
                attachments: attachments.map((item) => ({
                    filename: item.filename,
                    contentBase64: item.content,
                    mimetype: item.type,
                })),
            });
            ids.push(externalId);
            logger.info({ event: 'comms.email.template.sent', messageId, to, externalId }, 'comms.email.template.sent');
        }

        return {
            status: 'SENT',
            externalId: ids[0],
            sentAt: new Date(),
        };
    } catch (err) {
        logger.error({ event: 'comms.email.template.failed', messageId, err }, 'comms.email.template.failed');
        return {
            status: 'FAILED',
            errorCode: 'TEMPLATE_SEND_ERROR',
            errorDetail: err instanceof Error ? err.message : String(err),
        };
    }
}
