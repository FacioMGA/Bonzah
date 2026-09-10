import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { getSalesStats } from './getSalesStats.js';

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

export const getSalesStatsTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.get_sales_stats',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.analytics',
    description:
        'Return tenant-calendar sales aggregates: policies_issued, gross_written_premium, policies_referred, quotes_created. period: today|yesterday|wtd|mtd|ytd|last_7_days|last_30_days (default today). Optional productType filter (e.g. MOTOR, HOME, TRAVEL, HEALTH). All windows in tenant tz.',
    auditClass: 'read',
    run: async (input, ctx) => getSalesStats(input, ctx),
};
