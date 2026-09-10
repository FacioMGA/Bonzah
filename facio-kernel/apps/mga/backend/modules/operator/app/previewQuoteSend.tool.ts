import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { operatorPreviewQuoteSend } from './previewQuoteSend.js';

const InputSchema = z.object({ policyId: z.string().trim().min(1) }).strict();

// Preview tool returns either an OperatorPreviewEnvelope (status='preview')
// with confirmation_token, or an error envelope. Single permissive schema
// (the discriminated union would explode the catalog payload).
const OutputSchema = z.object({
    ok: z.boolean(),
    status: z.string(),
    summary: z.string(),
    action_id: z.string().optional(),
    correlation_id: z.string().optional(),
    requires_confirmation: z.boolean().optional(),
    confirmation_token: z.string().optional(),
    expires_at: z.string().optional(),
    entities: z.record(z.string(), z.string().optional()).optional(),
    diff: z
        .array(
            z.object({
                field: z.string(),
                from: z.unknown().optional(),
                to: z.unknown().optional(),
            }),
        )
        .optional(),
    premium_change: z
        .object({
            old_premium: z.number(),
            new_premium: z.number(),
            delta: z.number(),
            currency: z.string().nullable().optional(),
        })
        .optional(),
    readiness_blockers: z
        .array(z.object({ code: z.string(), message: z.string() }))
        .optional(),
    preview_extra: z.record(z.string(), z.unknown()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
    error: z
        .object({
            code: z.string(),
            message: z.string(),
            suggested_fix: z.string().optional(),
        })
        .optional(),
});

export const previewQuoteSendTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.preview_quote_send',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.mutate',
    description:
        'Generate a preview of the revised quote send: diff vs latest archived version, premium delta, and issue-readiness blockers. Returns a single-use confirmation_token (10-min TTL) required by operator.send_revised_quote.',
    auditClass: 'mutate',
    run: async (input, ctx) => operatorPreviewQuoteSend(input, ctx),
};
