import { z } from 'zod';
import type { ToolDescriptor } from '../../../modules/mcp/domain/toolDescriptor.js';
import { RENTAL_DOCUMENT_PACK_CONTRACT } from './documentPackContract.js';

const InputSchema = z.object({}).strict();
const EntrySchema = z.object({
    coverageCode: z.enum(['CDW', 'RCLI', 'SLI', 'PAI_PEI']),
    documentType: z.string(),
    label: z.string(),
    sourceId: z.string(),
    sourceVersion: z.string(),
    assetVersion: z.string(),
    filename: z.string(),
    docPacks: z.array(z.string()),
}).strict();
const OutputSchema = z.object({
    schemaVersion: z.literal(1),
    productType: z.literal('RENTAL'),
    selectionPath: z.literal('documents.issuedPack.requiredTypes'),
    sourcePath: z.literal('documents.sources'),
    entries: z.array(EntrySchema).length(4),
}).strict();

export const rentalDocumentCatalogueTool: ToolDescriptor<
    z.infer<typeof InputSchema>,
    z.infer<typeof OutputSchema>
> = {
    name: 'config.rental.documentCatalogue',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.read',
    auditClass: 'read',
    description: 'Return the registered RENTAL CDW, RCLI, SLI, and PAI/PEI certificate types plus their immutable source and asset versions for programme selection.',
    run: async () => ({
        schemaVersion: 1,
        productType: 'RENTAL',
        selectionPath: 'documents.issuedPack.requiredTypes',
        sourcePath: 'documents.sources',
        entries: RENTAL_DOCUMENT_PACK_CONTRACT.entries.map((entry) => ({
            coverageCode: String(entry.mode === 'template' ? entry.viewModelOverrides?.coverageCode : '') as 'CDW' | 'RCLI' | 'SLI' | 'PAI_PEI',
            documentType: entry.docType,
            label: entry.label,
            sourceId: entry.sourceId,
            sourceVersion: entry.sourceVersion,
            assetVersion: entry.assetVersion,
            filename: entry.filename,
            docPacks: [...entry.scope.docPacks],
        })),
    }),
};
