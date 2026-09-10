import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { setCoverageSelection } from './setCoverageSelection.js';

const InputSchema = z
    .object({
        draftId: z.string().min(1),
        baseEnabled: z.array(z.string().min(1)).optional(),
        baseDisabled: z.array(z.string().min(1)).optional(),
        optionsEnabledByDefault: z.array(z.string().min(1)).optional(),
        optionsDisabledByDefault: z.array(z.string().min(1)).optional(),
    })
    .strict();

const OutputSchema = z.object({
    summary: z.string(),
});

export const setCoverageSelectionTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'config.coverage.setSelection',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.draft',
    description:
        'Set MBE coverage selection on the draft: which base coverages are enabled and which options are on by default.',
    auditClass: 'draft',
    run: async (input) => setCoverageSelection(input),
};
