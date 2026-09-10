import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { resendPolicyDocuments } from './resendPolicyDocuments.js';

const InputSchema = z
    .object({
        policyId: z.string().trim().min(1),
        documentIds: z.array(z.string().trim().min(1)).optional(),
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
});

export const resendPolicyDocumentsTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.resend_policy_documents',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.comm',
    description:
        'INTERNAL BACK-OFFICE TOOL for licensed Lloyd\u2019s MGA underwriters. Re-sends the already-issued policy document pack (certificate, schedule, IPID) to the named insured on an ACTIVE/ISSUED/EXPIRED policy. Reuses the existing Document.storageUri \u2014 never regenerates. Uses the pre-approved DOCUMENTS_RESEND template (no free-text). Standard regulated post-bind customer-service action; full audit row written.',
    auditClass: 'comm',
    run: async (input, ctx) => resendPolicyDocuments(input, ctx),
};
