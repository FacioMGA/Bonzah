import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { setRequiredness } from './setRequiredness.js';

const InputSchema = z
    .object({
        draftId: z.string().min(1),
        questionKey: z.string().min(1),
        requiredAt: z.array(z.enum(['quote', 'bind', 'endorsement', 'claim_fnol'])).min(1),
    })
    .strict();

const OutputSchema = z.object({
    summary: z.string(),
    warnings: z.array(z.string()),
});

export const setRequirednessTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'config.questions.setRequiredness',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.draft',
    description:
        'Tighten the requiredness of an existing canonical questionnaire field at one or more lifecycle stages. Loosening is rejected.',
    auditClass: 'draft',
    run: async (input) => setRequiredness(input),
};
