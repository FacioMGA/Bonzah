import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { searchQuotes } from './searchQuotes.js';

const InputSchema = z
    .object({
        q: z.string().trim().min(1).optional(),
        policyHolderId: z.string().trim().min(1).optional(),
        productType: z.string().trim().min(1).optional(),
        statusIn: z.array(z.string().trim().min(1)).optional(),
        limit: z.number().int().min(1).max(100).optional(),
    })
    .strict();

const OutputSchema = z.object({
    ok: z.boolean(),
    status: z.string(),
    action_id: z.string().optional(),
    correlation_id: z.string().optional(),
    summary: z.string(),
    entities: z.record(z.string(), z.string().optional()).optional(),
    next_actions: z.array(z.string()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
});

export const searchQuotesTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.search_quotes',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.read',
    description:
        'Search quotes (pre-bind policies in DRAFT/QUOTED/REFERRAL/INFO_REQUIRED/PRICED/PAYMENT_PENDING). Filter by policyHolderId, productType, free text, or explicit statusIn.',
    auditClass: 'read',
    run: async (input, ctx) => searchQuotes(input, ctx),
};
