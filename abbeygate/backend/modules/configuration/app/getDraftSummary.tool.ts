import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { getDraftSummary } from './getDraftSummary.js';

const InputSchema = z
    .object({
        draftId: z.string().min(1),
    })
    .strict();

const DraftDeltaShape = z.record(z.string(), z.unknown());

const OutputSchema = z.object({
    draftId: z.string(),
    productName: z.string(),
    productCode: z.string(),
    baseTemplateId: z.string(),
    status: z.enum([
        'draft',
        'validation_failed',
        'validated',
        'simulated',
        'sandbox_published',
        'archived',
    ]),
    configuredCapabilities: z.array(z.string()),
    missingDecisions: z.array(z.string()),
    delta: DraftDeltaShape,
    publishedProgramId: z.string().nullable(),
    publishedBinderId: z.string().nullable(),
});

export const getDraftSummaryTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'config.products.getDraftSummary',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.read',
    description: 'Summarise a Config MCP draft: configured capabilities, missing decisions, full delta, publish status.',
    auditClass: 'read',
    run: async (input) => getDraftSummary(input),
};
