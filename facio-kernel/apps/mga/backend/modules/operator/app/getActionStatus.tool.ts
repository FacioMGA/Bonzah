import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { getActionStatus } from './getActionStatus.js';

const InputSchema = z
    .object({
        limit: z.number().int().min(1).max(100).optional(),
    })
    .strict();

const ActionEntrySchema = z.object({
    action_id: z.string(),
    occurred_at: z.string(),
    action_name: z.string(),
    entity_type: z.string(),
    entity_id: z.string(),
    summary: z.string().nullable(),
    status: z.string().nullable(),
});

const OutputSchema = z.object({
    actor_id: z.string(),
    count: z.number(),
    actions: z.array(ActionEntrySchema),
});

export const getActionStatusTool: ToolDescriptor<
    z.infer<typeof InputSchema>,
    z.infer<typeof OutputSchema>
> = {
    name: 'operator.get_action_status',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.read',
    description:
        'List recent operator MCP actions performed by the calling API key — answers "what did I do recently?".',
    auditClass: 'read',
    run: async (input, ctx) => getActionStatus(input, ctx),
};
