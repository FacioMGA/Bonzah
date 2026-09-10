import { McpToolError } from '../../mcp/domain/toolError.js';
import { createDraft } from '../infra/repositories/productLaunchDraftRepo.js';
import { getTemplate } from '../infra/templates/index.js';

export interface CloneTemplateInput {
    templateId: string;
    productName: string;
}

export interface CloneTemplateOutput {
    draftId: string;
    status: 'draft';
    summary: string;
    nextRecommendedSteps: string[];
}

export async function cloneTemplate(
    input: CloneTemplateInput,
    userId: string,
): Promise<CloneTemplateOutput> {
    const template = getTemplate(input.templateId);
    if (!template) {
        throw new McpToolError({
            code: 'VALIDATION_ERROR',
            message: `Unknown templateId "${input.templateId}".`,
            suggestedFix: 'Call config.products.listTemplates to see available templates.',
        });
    }

    const draft = await createDraft({
        name: input.productName,
        baseTemplateId: template.templateId,
        productCode: template.productCode,
        delta: template.seedDelta,
        createdByUserId: userId,
    });

    return {
        draftId: draft.id,
        status: 'draft',
        summary: `Created "${draft.name}" draft from ${template.name} template.`,
        nextRecommendedSteps: template.nextRecommendedSteps,
    };
}
