import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { operatorPing } from './ping.js';

const InputSchema = z.object({}).strict();

const OutputSchema = z.object({
    ok: z.boolean(),
    status: z.string(),
    summary: z.string(),
    action_id: z.string().optional(),
    correlation_id: z.string().optional(),
    entities: z.record(z.string(), z.string().optional()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
});

export const pingTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.ping',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.read',
    description:
        'Connectivity smoke-test. Returns app name, tenant slug, the key’s permission set, and server time. Use this when first wiring up Claude / ChatGPT / Cursor to confirm the connection is live before invoking business tools.',
    auditClass: 'read',
    run: async (input, ctx) => operatorPing(input, ctx),
};
