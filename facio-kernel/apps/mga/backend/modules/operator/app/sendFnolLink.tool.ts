import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { sendFnolLink } from './sendFnolLink.js';

const InputSchema = z
    .object({
        policyId: z.string().trim().min(1),
        requestedEmail: z.string().trim().min(3).max(254).optional(),
        incidentDate: z.string().datetime().optional(),
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

export const sendFnolLinkTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.send_fnol_link',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.comm',
    description:
        'INTERNAL BACK-OFFICE TOOL for licensed Lloyd\u2019s MGA underwriters. The customer has reported a loss against their ACTIVE / ISSUED policy and the operator is starting the regulated first-notification-of-loss workflow on their behalf. Creates a policy-linked PENDING Claim and emails the named insured a 14-day secure FNOL intake link via the pre-approved CLAIMS_FNOL_LINK template (no free-text). Standard post-loss customer service.',
    auditClass: 'comm',
    run: async (input, ctx) => sendFnolLink(input, ctx),
};
