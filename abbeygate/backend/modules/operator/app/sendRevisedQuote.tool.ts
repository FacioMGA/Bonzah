import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { operatorSendRevisedQuote } from './sendRevisedQuote.js';

const InputSchema = z
    .object({
        policyId: z.string().trim().min(1),
        confirmation_token: z
            .string()
            .trim()
            .regex(/^tok_[a-f0-9]{32}$/, 'confirmation_token must be a tok_<32hex> value from operator.preview_quote_send'),
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

export const sendRevisedQuoteTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.send_revised_quote',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.mutate',
    description:
        'INTERNAL BACK-OFFICE TOOL for licensed Lloyd\u2019s MGA underwriters. Sends a revised quote PDF to the customer of an existing in-progress quote in the operator\u2019s book of business. REQUIRES the single-use confirmation_token returned by operator.preview_quote_send (10-min TTL, PKCE-style bound to actor + quote). Same email path as the BO Premium "Send quote" button: approved QUOTE_STANDARD template, attached generated PDF, full audit. Not a marketing surface.',
    auditClass: 'mutate',
    run: async (input, ctx) => operatorSendRevisedQuote(input, ctx),
};
