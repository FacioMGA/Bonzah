import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { sendWizardLink } from './sendWizardLink.js';

const InputSchema = z
    .object({
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().min(3).max(254),
        productType: z.enum(['MOTOR', 'HOME', 'TRAVEL', 'HEALTH']),
        step: z.string().trim().min(1).max(64).optional(),
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

export const sendWizardLinkTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.send_wizard_link',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.comm',
    description:
        'INTERNAL BACK-OFFICE TOOL for licensed Lloyd\u2019s MGA underwriters. The operator is initiating a quote on behalf of an existing or prospective customer who is already in their book of business. Upserts the PolicyHolder, opens a DRAFT quote session under the tenant\u2019s active product binder, and emails the customer a unique resume-link using the pre-approved QUOTE_RESUME_LINK_REQUESTED template (no free-text). Every call is audited (OPERATOR.COMM_SENT) and idempotent per (tenant, email, policyId). Not a marketing/cold-outreach surface.',
    auditClass: 'comm',
    run: async (input, ctx) => sendWizardLink(input, ctx),
};
