import { Job } from 'bullmq';
import { z } from 'zod';
import { logger } from '../../platform/utils/logger.js';
import { dispatchCustomerEmailTrigger } from '../../modules/communications/app/customerEmailTriggerService.js';
import { registerHandler, JobHandler } from '../index.js';

// Schema for the EMAIL.CANCELLATION_REQUESTED outbox payload.
// Producer (canonical): backend/modules/policy/http/cancellationsRouter.ts
//
// `to` is required: this is a customer-facing acknowledgment of a
// cancellation request. The previous handler routed missing `to` values
// through `process.env.UW_REFERRAL_EMAIL_TO`, which silently sent
// customer emails to the underwriting team (latent bug — no defensive
// fallbacks per AGENTS.md non-negotiable).
const PayloadSchema = z.object({
    to: z.string().email('EMAIL.CANCELLATION_REQUESTED requires a valid customer email in payload.to'),
    policyId: z.string().min(1),
    policyNumber: z.string().min(1),
    reason: z.string().optional().default(''),
    requestedEffectiveDate: z.string().optional().default(''),
});

export const handleEmailCancellationRequested: JobHandler = async (job: Job) => {
    const data = PayloadSchema.parse(job.data);
    const result = await dispatchCustomerEmailTrigger({
        trigger: 'UW_INFO_REQUESTED',
        entityType: 'POLICY',
        entityId: data.policyId,
        toEmail: data.to,
        variables: {
            customer: { firstName: 'there' },
            policy: { number: data.policyNumber },
            uw: {
                message:
                    `Cancellation request received.\n` +
                    (data.requestedEffectiveDate ? `Requested effective date: ${data.requestedEffectiveDate}\n` : '') +
                    (data.reason ? `Reason: ${data.reason}\n` : ''),
                url: '',
            },
        },
        idempotencySeed: `${data.policyNumber}:${data.requestedEffectiveDate}:${data.reason}`,
        forceSystemOnly: true,
    });
    logger.info({ to: data.to, policyNumber: data.policyNumber, skipped: result.skipped }, 'email.cancellation_requested.dispatched');
};

registerHandler('EMAIL.CANCELLATION_REQUESTED', handleEmailCancellationRequested);
