import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { operatorRateQuote } from './rateQuote.js';

const InputSchema = z.object({ policyId: z.string().trim().min(1) }).strict();

const OutputSchema = z.object({
    ok: z.boolean(),
    status: z.string(),
    summary: z.string(),
    action_id: z.string().optional(),
    correlation_id: z.string().optional(),
    entities: z.record(z.string(), z.string().optional()).optional(),
    next_actions: z.array(z.string()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
    error: z
        .object({
            code: z.string(),
            message: z.string(),
            suggested_fix: z.string().optional(),
        })
        .optional(),
});

export const rateQuoteTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.rate_quote',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.mutate',
    description:
        'Run the canonical rate pipeline. Persists fresh quoteResponse + pricing snapshot. Always re-rates — no cache.',
    auditClass: 'mutate-staging',
    run: async (input, ctx) => operatorRateQuote(input, ctx),
};
