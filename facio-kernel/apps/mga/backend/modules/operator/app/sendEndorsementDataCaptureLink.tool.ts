import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { operatorSendEndorsementDataCaptureLink } from './sendEndorsementDataCaptureLink.js';

const InputSchema = z
    .object({
        policyId: z.string().trim().min(1),
        riskTransactionId: z.string().trim().min(1),
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

export const sendEndorsementDataCaptureLinkTool: ToolDescriptor<
    z.infer<typeof InputSchema>,
    z.infer<typeof OutputSchema>
> = {
    // Canonical name kept short so the wire variant fits Cursor's
    // 60-char "<server>:<tool>" combined cap. Audit/runbook references
    // updated to match (ADR-0039 §B3 callout).
    name: 'operator.send_endorsement_link',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.comm',
    description:
        'INTERNAL BACK-OFFICE TOOL for licensed Lloyd\u2019s MGA underwriters. The named insured on an ACTIVE policy has requested a mid-term change (address change or named driver change). Emails them a secure data-capture link so they can supply the updated details. Uses the pre-approved ENDORSEMENT_DATA_CAPTURE template (no free-text). Idempotent per (tenant, email, endorsement). Standard post-bind customer service.',
    auditClass: 'comm',
    run: async (input, ctx) => operatorSendEndorsementDataCaptureLink(input, ctx),
};
