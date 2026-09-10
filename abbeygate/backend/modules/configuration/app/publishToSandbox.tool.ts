import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { publishToSandbox } from './publishToSandbox.js';

const InputSchema = z
    .object({
        draftId: z.string().min(1),
        sandboxTenantSlug: z.string().min(1),
        confirmationText: z.string().min(1),
    })
    .strict();

const OutputSchema = z.object({
    sandboxConfigVersionId: z.string(),
    publishedProgramId: z.string(),
    publishedBinderId: z.string(),
    status: z.literal('sandbox_published'),
    summary: z.string(),
});

export const publishToSandboxTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'config.publish.publishToSandbox',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.publish_sandbox',
    description:
        'Publish a validated, simulated draft into a SYNTHETIC sandbox tenant. Writes a Program + Binder + BinderProductAuthority in one transaction.',
    auditClass: 'publish',
    run: async (input, ctx) => publishToSandbox(input, ctx.permissions),
};
