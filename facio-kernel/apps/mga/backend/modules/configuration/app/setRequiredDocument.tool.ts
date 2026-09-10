import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import {
    DOCUMENT_STAGES,
    DOCUMENT_TYPES,
    ISSUANCE_TRIGGERS,
} from '../domain/programMetadataExtensions.js';
import { setRequiredDocument } from './setRequiredDocument.js';

const InputSchema = z
    .object({
        draftId: z.string().min(1),
        documentType: z.enum(DOCUMENT_TYPES),
        requiredAt: z.array(z.enum(DOCUMENT_STAGES)).min(1),
        issuanceTrigger: z.enum(ISSUANCE_TRIGGERS),
    })
    .strict();

const OutputSchema = z.object({
    documentRuleId: z.string(),
    summary: z.string(),
    missingTemplateVariables: z.array(z.string()),
});

export const setRequiredDocumentTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'config.documents.setRequiredDocument',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.draft',
    description:
        'Toggle requiredness and issuance trigger for a canonical document type at one or more lifecycle stages.',
    auditClass: 'draft',
    run: async (input) => setRequiredDocument(input),
};
