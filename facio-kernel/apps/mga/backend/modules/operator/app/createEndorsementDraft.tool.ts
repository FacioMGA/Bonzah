import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { operatorCreateEndorsementDraft } from './createEndorsementDraft.js';

const InputSchema = z
    .object({
        policyId: z.string().trim().min(1),
        reason: z.string().trim().min(1).max(500),
        reasonCode: z.enum(['ADDRESS_CHANGE', 'NAMED_DRIVER_CHANGE']),
        effectiveDate: z
            .string()
            .trim()
            .min(8)
            .regex(/^\d{4}-\d{2}-\d{2}/, 'effectiveDate must be ISO YYYY-MM-DD or full ISO string'),
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

export const createEndorsementDraftTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.create_endorsement_draft',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.mutate',
    description:
        'Create a DRAFT endorsement RiskTransaction (address change or named-driver change). Wraps the canonical executeCreateEndorsementDraft service; dedupe-aware. V2 does NOT bind — submission for UW review is a separate tool.',
    auditClass: 'mutate-staging',
    run: async (input, ctx) => operatorCreateEndorsementDraft(input, ctx),
};
