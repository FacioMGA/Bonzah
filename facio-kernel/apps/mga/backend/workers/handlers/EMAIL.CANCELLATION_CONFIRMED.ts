import { Job } from 'bullmq';
import { z } from 'zod';
import { logger } from '../../platform/utils/logger.js';
import { dispatchCustomerEmailTrigger } from '../../modules/communications/app/customerEmailTriggerService.js';
import { registerHandler, JobHandler } from '../index.js';

// Schema for the EMAIL.CANCELLATION_CONFIRMED outbox payload.
// Producer (canonical): backend/modules/policy/http/cancellationsRouter.ts
//
// `to` is required and must be the policyholder's email. Previously
// the handler treated a missing `to` as a soft-skip (warn + return),
// which let cancellation confirmations be silently dropped — a direct
// AGENTS.md non-negotiable violation ("no fallback datasets to silence
// validation errors").
const PayloadSchema = z.object({
    to: z.string().email('EMAIL.CANCELLATION_CONFIRMED requires a valid customer email in payload.to'),
    policyId: z.string().min(1),
    policyNumber: z.string().min(1),
    effectiveDate: z.string().optional().default(''),
    refundAmount: z.union([z.string(), z.number()]).optional().transform((v) => (v === undefined ? '' : String(v))),
});

export const handleEmailCancellationConfirmed: JobHandler = async (job: Job) => {
    const data = PayloadSchema.parse(job.data);
    const result = await dispatchCustomerEmailTrigger({
        trigger: 'CANCELLATION_CONFIRMED',
        entityType: 'POLICY',
        entityId: data.policyId,
        toEmail: data.to,
        variables: {
            customer: { firstName: 'there' },
            policy: {
                number: data.policyNumber,
                effectiveDate: data.effectiveDate,
                refundAmount: data.refundAmount,
            },
        },
        idempotencySeed: `${data.policyNumber}:${data.effectiveDate}:${data.refundAmount}`,
    });
    logger.info({ to: data.to, policyNumber: data.policyNumber, skipped: result.skipped }, 'email.cancellation_confirmed.dispatched');
};

registerHandler('EMAIL.CANCELLATION_CONFIRMED', handleEmailCancellationConfirmed);
