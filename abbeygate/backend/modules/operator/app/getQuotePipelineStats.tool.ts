import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { getQuotePipelineStats } from './getQuotePipelineStats.js';

const InputSchema = z
    .object({
        productType: z.string().trim().min(1).optional(),
        period: z
            .enum(['today', 'yesterday', 'wtd', 'mtd', 'ytd', 'last_7_days', 'last_30_days'])
            .optional(),
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

export const getQuotePipelineStatsTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.get_quote_pipeline_stats',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.analytics',
    description:
        'Return quote pipeline counters (quotes_created → quotes_sent → quotes_accepted → policies_bound → policies_issued) from the AuditAction log for a tenant-calendar period.',
    auditClass: 'read',
    run: async (input, ctx) => getQuotePipelineStats(input, ctx),
};
