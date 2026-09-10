import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { configPing } from './ping.js';

const InputSchema = z.object({}).strict();

const OutputSchema = z.object({
    ok: z.boolean(),
    app: z.string(),
    environment: z.string(),
    tenant_slug: z.string(),
    permissions: z.array(z.string()),
    server_time: z.string(),
});

export const configPingTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'config.system.ping',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.read',
    description:
        'Connectivity smoke-test. Returns app name, tenant slug, the key’s permission set, and server time. Use this when first wiring up Claude / ChatGPT / Cursor to confirm the connection is live.',
    auditClass: 'read',
    run: async (input, ctx) => configPing(input, ctx),
};
