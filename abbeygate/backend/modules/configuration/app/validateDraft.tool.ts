import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { validateDraft } from './validateDraft.js';

const InputSchema = z.object({ draftId: z.string().min(1) }).strict();
const IssueSchema = z.object({
    code: z.string(),
    severity: z.enum(['info', 'warning', 'error']),
    message: z.string(),
    path: z.string().optional(),
    suggestedFix: z.string().optional(),
});
const OutputSchema = z.object({
    status: z.enum(['passed', 'failed']),
    issues: z.array(IssueSchema),
    draftId: z.string(),
    nextStatus: z.enum([
        'draft',
        'validation_failed',
        'validated',
        'simulated',
        'sandbox_published',
        'archived',
    ]),
    summary: z.string(),
});

export const validateDraftTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'config.validation.validateDraft',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.validate',
    description:
        'Validate the staged draft against the canonical contract — schema, reference, threshold, conflict, and publishability checks.',
    auditClass: 'validate',
    run: async (input) => validateDraft(input),
};
