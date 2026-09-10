import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import {
    CANCELLATION_REFUND_BASES,
    PAYMENT_TERMS,
} from '../domain/programMetadataExtensions.js';
import { setBillingTerms } from './setBillingTerms.js';

const InputSchema = z
    .object({
        draftId: z.string().min(1),
        currency: z.string().length(3),
        paymentTerms: z.enum(PAYMENT_TERMS),
        commissionPercent: z.number().min(0).max(100).optional(),
        adminFee: z.number().min(0).optional(),
        cancellationRefundBasis: z.enum(CANCELLATION_REFUND_BASES),
        nonRefundableFees: z.array(z.string().min(1)).optional(),
    })
    .strict();

const OutputSchema = z.object({
    billingRuleId: z.string(),
    summary: z.string(),
    warnings: z.array(z.string()),
});

export const setBillingTermsTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'config.billing.setCommercialTerms',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.draft',
    description:
        'Set commercial terms for the draft (currency, payment terms, commission %, admin fee, cancellation refund basis).',
    auditClass: 'draft',
    run: async (input) => setBillingTerms(input),
};
