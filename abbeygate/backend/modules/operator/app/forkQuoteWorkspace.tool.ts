import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { operatorForkQuoteWorkspace } from './forkQuoteWorkspace.js';

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
    error: z
        .object({
            code: z.string(),
            message: z.string(),
            suggested_fix: z.string().optional(),
        })
        .optional(),
});

export const forkQuoteWorkspaceTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.fork_quote_workspace',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.mutate',
    description:
        'Archive the current quote into history and unlock the policy for editing. Reversible via the existing restore route. Use this before patching draft terms via operator.update_quote_terms.',
    auditClass: 'mutate-staging',
    run: async (input, ctx) => operatorForkQuoteWorkspace(input, ctx),
};
