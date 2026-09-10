import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { cloneTemplate } from './cloneTemplate.js';

const InputSchema = z
    .object({
        templateId: z.string().min(1),
        productName: z.string().min(1).max(120),
    })
    .strict();

const OutputSchema = z.object({
    draftId: z.string(),
    status: z.literal('draft'),
    summary: z.string(),
    nextRecommendedSteps: z.array(z.string()),
});

export const cloneTemplateTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'config.products.cloneTemplate',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.draft',
    description:
        'Clone a product launch template into a new ProductLaunchDraft. The draft is editable via subsequent config.* write tools.',
    auditClass: 'draft',
    run: async (input, ctx) => cloneTemplate(input, ctx.userId),
};
