import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { operatorSubmitEndorsementForReview } from './submitEndorsementForReview.js';

const InputSchema = z
    .object({
        policyId: z.string().trim().min(1),
        riskTransactionId: z.string().trim().min(1),
        confirmation_token: z
            .string()
            .trim()
            .regex(/^tok_[a-f0-9]{32}$/, 'confirmation_token must be a tok_<32hex> value')
            .optional(),
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
    confirmation_token: z.string().optional(),
    expires_at: z.string().optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
    error: z
        .object({
            code: z.string(),
            message: z.string(),
            suggested_fix: z.string().optional(),
        })
        .optional(),
});

export const submitEndorsementForReviewTool: ToolDescriptor<
    z.infer<typeof InputSchema>,
    z.infer<typeof OutputSchema>
> = {
    name: 'operator.submit_endorsement_for_review',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.mutate',
    description:
        'Transition a DRAFT endorsement to REFERRED for UW review. Call without confirmation_token to get a preview + token; call again with the token within 10 min to commit. V2 does NOT bind — that stays with the BO endorsement flow.',
    auditClass: 'mutate',
    run: async (input, ctx) => operatorSubmitEndorsementForReview(input, ctx),
};
