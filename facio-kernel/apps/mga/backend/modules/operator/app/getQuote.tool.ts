import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { getQuote } from './getQuote.js';

const InputSchema = z.object({ policyId: z.string().trim().min(1) }).strict();
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

export const getQuoteTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.get_quote',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.read',
    description: 'Load a single quote (pre-bind policy row) by id from the canonical policyListIndex projection.',
    auditClass: 'read',
    run: async (input, ctx) => getQuote(input, ctx),
};
