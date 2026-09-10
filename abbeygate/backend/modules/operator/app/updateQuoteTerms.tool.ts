import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { operatorUpdateQuoteTerms } from './updateQuoteTerms.js';

const InputSchema = z
    .object({
        policyId: z.string().trim().min(1),
        patch: z.record(z.string(), z.unknown()),
    })
    .strict();

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

export const updateQuoteTermsTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.update_quote_terms',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.mutate',
    description:
        'Apply a free-form quote-data patch (any wizard field). Runs validateForContext underwriter-strict before persist; returns either the changed-field diff or validation errors with no writes.',
    auditClass: 'mutate-staging',
    run: async (input, ctx) => operatorUpdateQuoteTerms(input, ctx),
};
