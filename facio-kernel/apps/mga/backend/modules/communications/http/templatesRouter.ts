import { Router } from 'express';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { logger } from '../../../platform/utils/logger.js';
import { z } from 'zod';
import { renderTemplate, extractVariables, validateVariables } from '../app/templateRenderService.js';

const router = Router();

// GET /api/templates
router.get('/', async (req, res) => {
    try {
        const { channel, customerOnly } = req.query;

        const where: { enabled: boolean; channel?: string } = { enabled: true };
        if (channel) where.channel = String(channel);

        const templates = await tenantScopedPrisma.communicationTemplate.findMany({
            where,
            orderBy: { name: 'asc' },
        });

        const customerOnlyFlag = String(customerOnly || '').toLowerCase() === 'true';
        const data = templates
            .map((tpl) => {
                const tags = Array.isArray(tpl.tags) ? tpl.tags.map((x) => String(x)) : [];
                const systemOnly = tags.map((x) => x.toLowerCase()).includes('system-only');
                return {
                    ...tpl,
                    templateKey: tpl.name,
                    systemOnly,
                };
            })
            .filter((tpl) => !customerOnlyFlag || String(tpl.channel || '').toUpperCase() === 'EMAIL');

        return res.json({ success: true, data });
    } catch (error) {
        logger.error({ err: error }, 'Failed to fetch communication templates');
        return res.status(500).json({ success: false, error: { message: 'Failed to fetch templates' } });
    }
});

// GET /api/templates/:id/variables — extract required variables for a template
router.get('/:id/variables', async (req, res) => {
    try {
        const template = await tenantScopedPrisma.communicationTemplate.findUnique({
            where: { id: req.params.id },
        });
        if (!template) {
            return res.status(404).json({ success: false, error: { message: 'Template not found' } });
        }

        const bodyVars = extractVariables(template.bodyTemplate);
        const subjectVars = template.subjectTemplate
            ? extractVariables(template.subjectTemplate)
            : [];
        const allVars = [...new Set([...bodyVars, ...subjectVars])];

        return res.json({
            success: true,
            data: {
                templateId: template.id,
                templateName: template.name,
                variables: allVars,
                variablesSchema: template.variablesSchema,
            },
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to extract template variables');
        return res.status(500).json({ success: false, error: { message: 'Failed to extract variables' } });
    }
});

// POST /api/templates/render — render a template with variables
const RenderTemplateSchema = z.object({
    templateId: z.string(),
    variables: z.record(z.string(), z.unknown()),
});

router.post('/render', async (req, res) => {
    try {
        const input = RenderTemplateSchema.parse(req.body);

        const template = await tenantScopedPrisma.communicationTemplate.findUnique({
            where: { id: input.templateId },
        });
        if (!template) {
            return res.status(404).json({ success: false, error: { message: 'Template not found' } });
        }

        // Validate required variables
        const schema = (template.variablesSchema && typeof template.variablesSchema === 'object')
            ? template.variablesSchema as Record<string, unknown>
            : {};
        const validation = validateVariables(schema, input.variables);

        // Render body
        const bodyResult = renderTemplate(template.bodyTemplate, input.variables);

        // Render subject if present
        const subjectResult = template.subjectTemplate
            ? renderTemplate(template.subjectTemplate, input.variables)
            : null;

        return res.json({
            success: true,
            data: {
                renderedBody: bodyResult.rendered,
                renderedSubject: subjectResult?.rendered ?? null,
                missingVariables: [
                    ...new Set([
                        ...bodyResult.missingVariables,
                        ...(subjectResult?.missingVariables ?? []),
                    ]),
                ],
                usedVariables: [
                    ...new Set([
                        ...bodyResult.usedVariables,
                        ...(subjectResult?.usedVariables ?? []),
                    ]),
                ],
                schemaValidation: validation,
            },
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, error: { message: error.issues[0]?.message || 'Invalid input' } });
        }
        logger.error({ err: error }, 'Failed to render template');
        return res.status(500).json({ success: false, error: { message: 'Failed to render template' } });
    }
});

export default router;
