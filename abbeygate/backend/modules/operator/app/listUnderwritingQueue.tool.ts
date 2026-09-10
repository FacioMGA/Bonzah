import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { listUnderwritingQueue } from './listUnderwritingQueue.js';

const InputSchema = z
    .object({
        productType: z.string().trim().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
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

export const listUnderwritingQueueTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.list_underwriting_queue',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.analytics',
    description:
        'List quotes / policies pending underwriter action (uwActionRequired = true on the canonical policyListIndex projection).',
    auditClass: 'read',
    run: async (input, ctx) => listUnderwritingQueue(input, ctx),
};
