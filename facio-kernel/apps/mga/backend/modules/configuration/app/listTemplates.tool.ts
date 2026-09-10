import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { listTemplates } from './listTemplates.js';

const InputSchema = z.object({}).strict();
const TemplateSummarySchema = z.object({
    templateId: z.string(),
    name: z.string(),
    vertical: z.string(),
    description: z.string(),
    supportedCapabilities: z.array(z.string()),
});
const OutputSchema = z.object({
    templates: z.array(TemplateSummarySchema),
});

export const listTemplatesTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'config.products.listTemplates',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.read',
    description: 'List available product launch templates that can be cloned to start a new configuration draft.',
    auditClass: 'read',
    run: async () => listTemplates(),
};
