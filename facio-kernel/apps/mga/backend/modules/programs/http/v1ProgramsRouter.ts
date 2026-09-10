import { Router } from 'express';
import { z } from 'zod';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { openApiRegistry, ErrorResponseSchema } from '../../../platform/openapi/openapi.js';

const router = Router();

const ProgramStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'DRAFT', 'ARCHIVED']);

// Zod schema for response documentation and validation 
const ProgramSchema = openApiRegistry.register('ProgramResponse', z.object({
    id: z.string().uuid(),
    name: z.string(),
    status: ProgramStatusEnum,
    metadata: z.any().optional(),
}));

openApiRegistry.registerPath({
    method: 'get',
    path: '/v1/programs',
    operationId: 'listPrograms',
    summary: 'Discover Insurance Products',
    description: 'Retrieves the current catalog of insurance products your facility is contractually authorized to distribute and quote.',
    tags: ['3. Quote & Bind'],
    responses: {
        200: {
            description: 'Successful retrieval of programs',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), data: z.array(ProgramSchema) }),
                },
            },
        },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    },
});

import { quoteDataInputSchema } from '../../policy/app/quoteDataSchema.js';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';

const generatorRegistry = new OpenAPIRegistry();
generatorRegistry.register('QuoteData', quoteDataInputSchema);
const standaloneGenerator = new OpenApiGeneratorV3(generatorRegistry.definitions);
const standaloneDocument = standaloneGenerator.generateDocument({
    openapi: '3.0.0',
    info: { version: '1.0.0', title: 'Dynamic API Schema' }
});

const GeneratedProgramsQuestionSchema = standaloneDocument.components?.schemas?.QuoteData || {};

openApiRegistry.registerPath({
    method: 'get',
    path: '/v1/programs/{programId}/questions',
    operationId: 'getProgramQuestions',
    summary: 'Retrieve Program Questions Schema',
    description: 'Fetches the exact dynamic pricing schema required by the Risk Engine to generate a valid, firm quote for this specific product. Returns a standard JSON Schema draft-07 detailing the data types, constraints, and descriptions.',
    tags: ['3. Quote & Bind'],
    request: {
        params: z.object({ programId: z.string().uuid() }),
    },
    responses: {
        200: {
            description: 'Successful retrieval of the questioning schema',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        data: z.any().openapi({
                            description: 'A JSON Schema defining the explicit data types (string, boolean, numeric restrictions) required when submitting a quote.',
                            example: GeneratedProgramsQuestionSchema
                        })
                    })
                },
            },
        },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Program not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    }
});

router.get('/', async (_req, res) => {
    try {
        // Simplistic example: return ACTIVE programs
        // Further complex tenant-based filtering would rely on RLS automatically or manual Prisma criteria
        const programs = await tenantScopedPrisma.program.findMany({
            where: {
                status: 'ACTIVE',
            },
            select: {
                id: true,
                name: true,
                status: true,
                metadata: true,
            }
        });

        return res.json({
            success: true,
            data: programs,
        });
    } catch (_error) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve programs array' }
        });
    }
});

router.get('/:programId/questions', async (req, res) => {
    try {
        const programId = req.params.programId;

        // Ensure program exists and is accessible
        const program = await tenantScopedPrisma.program.findFirst({
            where: { id: programId, status: 'ACTIVE' }
        });

        if (!program) {
            return res.status(404).json({ success: false, error: { message: 'Program not found or inactive' } });
        }

        // Return the canonical JSON Schema representing the underwriting questions required by the Core Engine
        return res.json({
            success: true,
            data: GeneratedProgramsQuestionSchema
        });
    } catch (_error) {
        return res.status(500).json({ success: false, error: { message: 'Failed to retrieve underwriting questions' } });
    }
});

export default router;
