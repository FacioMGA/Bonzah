import crypto from 'node:crypto';
import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import { logger } from '../../../platform/utils/logger.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { dispatchCustomerEmailTrigger } from '../../communications/app/customerEmailTriggerService.js';
import { getPolicyById } from '../infra/adapters/policyListAdapter.js';

const REMINDER_ELIGIBLE_STATUSES = new Set([
    'QUOTED',
    'REFERRAL',
    'INFO_REQUIRED',
    'PRICED',
    'PAYMENT_PENDING',
]);

export interface SendQuoteReminderInput {
    policyId: string;
}

export type SendQuoteReminderOutput = OperatorEnvelope<{
    policy_id: string;
    policy_number: string;
    reminder_url: string;
    email_to: string;
}>;

/**
 * A2 flow (spec §3.A.2): re-send the customer their wizard / payment
 * link for an existing pre-bind quote. We do NOT regenerate the quote
 * PDF; we just send the same approved reminder template pointing at
 * the live `publicSessionToken`.
 *
 * Eligibility: quote status must be in REMINDER_ELIGIBLE_STATUSES.
 * Expired / declined / cancelled / bound quotes return a structured
 * "not eligible" error so the agent can explain to the operator
 * instead of silently failing.
 */
export async function sendQuoteReminder(
    input: SendQuoteReminderInput,
    ctx: McpContext,
): Promise<SendQuoteReminderOutput> {
    const action = buildOperatorActionContext(ctx);
    const row = await getPolicyById(input.policyId);
    if (!row) {
        return {
            ok: false,
            status: 'error',
            summary: `No quote with id "${input.policyId}".`,
            error: { code: 'NOT_FOUND', message: 'Quote not found in this tenant.' },
        };
    }
    if (!REMINDER_ELIGIBLE_STATUSES.has(row.status)) {
        return {
            ok: false,
            status: 'error',
            summary: `Quote ${row.policyNumber} is in status "${row.status}" and not eligible for a reminder.`,
            error: {
                code: 'NOT_ELIGIBLE',
                message: `Reminders are only sent for: ${[...REMINDER_ELIGIBLE_STATUSES].join(', ')}.`,
            },
        };
    }
    if (!row.policyholderEmail) {
        return {
            ok: false,
            status: 'missing_required_fields',
            summary: 'Quote has no registered customer email.',
            required_fields: ['policyholder.email'],
        };
    }

    // Pull the publicSessionToken from the canonical Policy row.
    const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: input.policyId },
        select: { publicSessionToken: true, productType: true },
    });
    if (!policy?.publicSessionToken) {
        return {
            ok: false,
            status: 'error',
            summary: 'Quote has no public session token to link to.',
            error: { code: 'NO_PUBLIC_SESSION_TOKEN', message: 'Cannot construct a reminder URL.' },
        };
    }

    const tenant = getTenantConfig();
    const productSlug = String(policy.productType || row.productType || 'motor').toLowerCase();
    const reminderUrl = `${tenant.publicBaseUrl.replace(/\/$/, '')}/quote/${policy.publicSessionToken}?product=${productSlug}&step=your-quote`;
    const idempotencySeed = crypto
        .createHash('sha256')
        .update(`quote_reminder:${tenant.id}:${row.policyholderEmail.toLowerCase()}:${input.policyId}`)
        .digest('hex');

    try {
        await dispatchCustomerEmailTrigger({
            trigger: 'QUOTE_FOLLOW_UP',
            entityType: 'POLICY',
            entityId: input.policyId,
            toEmail: row.policyholderEmail,
            fromActor: ctx.userId,
            variables: {
                customer: { firstName: row.insuredName.split(' ')[0] || row.insuredName },
                quote: { url: reminderUrl, resumeUrl: reminderUrl, policyNumber: row.policyNumber },
                policy: { number: row.policyNumber },
            },
            productCode: policy.productType ?? undefined,
            idempotencySeed,
        });
    } catch (err) {
        logger.warn({ err, policyId: input.policyId }, 'operator.send_quote_reminder.email_failed');
        return {
            ok: false,
            status: 'error',
            summary: 'Reminder email failed to send.',
            error: {
                code: 'EMAIL_SEND_FAILED',
                message: err instanceof Error ? err.message : 'Email dispatch error.',
            },
        };
    }

    const envelope: OperatorSuccessEnvelope<{
        policy_id: string;
        policy_number: string;
        reminder_url: string;
        email_to: string;
    }> = {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary: `Sent ${row.insuredName} a reminder to finalise quote ${row.policyNumber}.`,
        entities: { policyId: input.policyId, quoteId: input.policyId },
        next_actions: ['operator.get_action_status'],
        extra: {
            policy_id: input.policyId,
            policy_number: row.policyNumber,
            reminder_url: reminderUrl,
            email_to: row.policyholderEmail,
        },
    };
    return envelope;
}
