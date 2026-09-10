import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { getCustomerContext } from './getCustomerContext.js';

const InputSchema = z
    .object({
        policyHolderId: z.string().trim().min(1).optional(),
        q: z.string().trim().min(1).optional(),
    })
    .strict();

const OutputSchema = z.object({
    ok: z.boolean(),
    status: z.string(),
    action_id: z.string().optional(),
    correlation_id: z.string().optional(),
    summary: z.string(),
    entities: z.record(z.string(), z.string().optional()).optional(),
    next_actions: z.array(z.string()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
});

export const getCustomerContextTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.get_customer_context',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.read',
    description:
        'INTERNAL BACK-OFFICE TOOL for licensed Lloyd\u2019s MGA underwriters. Loads the operator\u2019s OWN account-context bundle (account summary, in-force portfolio, open alerts, recent activity feed) for a PolicyHolder in their book of business. Tenant-scoped \u2014 no cross-tenant access. Email PII is masked in the response; raw contact JSON is never exposed. Accepts policyHolderId or free-text query.',
    auditClass: 'read',
    run: async (input, ctx) => getCustomerContext(input, ctx),
};
