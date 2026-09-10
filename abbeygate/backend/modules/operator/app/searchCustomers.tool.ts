import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { searchCustomers } from './searchCustomers.js';

const InputSchema = z
    .object({
        q: z.string().trim().min(1),
        limit: z.number().int().min(1).max(50).optional(),
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

export const searchCustomersTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.search_customers',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.read',
    description:
        'INTERNAL BACK-OFFICE TOOL for licensed Lloyd\u2019s MGA underwriters. Searches the operator\u2019s OWN book of business (PolicyHolders the tenant has previously written policies for) by name or contact substring. Returns matches scoped to the current operating tenant only \u2014 no cross-tenant access, no third-party data. Email addresses are PII-masked in the response. Required input: { "q": "<search term>" }. Optional: { "limit": <1-50> }. Not a people-search / public-records lookup.',
    auditClass: 'read',
    run: async (input, ctx) => searchCustomers(input, ctx),
};
