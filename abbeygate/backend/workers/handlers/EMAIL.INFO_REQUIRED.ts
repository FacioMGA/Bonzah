import { Job } from 'bullmq';
import { z } from 'zod';
import { logger } from '../../platform/utils/logger.js';
import { dispatchCustomerEmailTrigger } from '../../modules/communications/app/customerEmailTriggerService.js';
import { registerHandler, JobHandler } from '../index.js';

// Schema for the EMAIL.INFO_REQUIRED outbox payload.
// Producer (canonical): backend/modules/policy/http/uwDecisionRouter.ts
//
// `to` is required (policyholder email). The previous handler logged
// `email.info_required.missing_target` and returned silently — the
// customer never saw the request for additional information, but the
// underwriter's HTTP response succeeded. Surfacing this via a parse
// error makes the producer/consumer drift visible.
const PayloadSchema = z.object({
    to: z.string().email('EMAIL.INFO_REQUIRED requires a valid customer email in payload.to'),
    policyId: z.string().min(1),
    policyNumber: z.string().min(1),
    message: z.string().optional().default(''),
    customerLink: z.string().optional().default(''),
    // requestedStep is sent by the producer for audit but not consumed here.
    requestedStep: z.string().optional(),
});

export const handleEmailInfoRequired: JobHandler = async (job: Job) => {
    const data = PayloadSchema.parse(job.data);
    const result = await dispatchCustomerEmailTrigger({
        trigger: 'UW_INFO_REQUESTED',
        entityType: 'POLICY',
        entityId: data.policyId,
        toEmail: data.to,
        variables: {
            customer: { firstName: 'there' },
            policy: { number: data.policyNumber },
            uw: { message: data.message, url: data.customerLink },
        },
        idempotencySeed: `${data.policyNumber}:${data.message}:${data.customerLink}`,
    });
    logger.info({ to: data.to, policyNumber: data.policyNumber, skipped: result.skipped }, 'email.info_required.dispatched');
};

registerHandler('EMAIL.INFO_REQUIRED', handleEmailInfoRequired);
