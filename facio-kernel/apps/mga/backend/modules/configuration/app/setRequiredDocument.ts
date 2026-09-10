import { McpToolError } from '../../mcp/domain/toolError.js';
import {
    DOCUMENT_STAGES,
    DOCUMENT_TYPES,
    ISSUANCE_TRIGGERS,
} from '../domain/programMetadataExtensions.js';
import { isEditable } from '../domain/productLaunchDraft.js';
import { findDraft, patchDelta } from '../infra/repositories/productLaunchDraftRepo.js';

export interface SetRequiredDocumentInput {
    draftId: string;
    documentType: (typeof DOCUMENT_TYPES)[number];
    requiredAt: Array<(typeof DOCUMENT_STAGES)[number]>;
    issuanceTrigger: (typeof ISSUANCE_TRIGGERS)[number];
}

export interface SetRequiredDocumentOutput {
    documentRuleId: string;
    summary: string;
    missingTemplateVariables: string[];
}

/**
 * V1 jurisdiction document overlay (ADR-0038). Toggles
 * `requiredAt` / `issuanceTrigger` on a document type already present
 * in the resolved JurisdictionProductConfig.documentConfig. Adding a
 * new document type → REQUIRES_ENGINEERING (Phase 2 validateDraft
 * confirms the type exists for the target jurisdiction).
 */
export async function setRequiredDocument(
    input: SetRequiredDocumentInput,
): Promise<SetRequiredDocumentOutput> {
    const draft = await findDraft(input.draftId);
    if (!draft) {
        throw new McpToolError({ code: 'DRAFT_NOT_FOUND', message: `No draft "${input.draftId}".` });
    }
    if (!isEditable(draft.status)) {
        throw new McpToolError({
            code: 'PUBLISH_BLOCKED',
            message: `Draft "${input.draftId}" is in terminal status "${draft.status}" and cannot accept edits.`,
        });
    }

    await patchDelta(input.draftId, {
        jurisdictionOverrides: {
            documentConfig: [
                {
                    documentType: input.documentType,
                    requiredAt: input.requiredAt,
                    issuanceTrigger: input.issuanceTrigger,
                },
            ],
        },
    });

    return {
        documentRuleId: `document#${input.documentType}`,
        summary: `Document "${input.documentType}" required at [${input.requiredAt.join(', ')}], trigger="${input.issuanceTrigger}".`,
        // Phase 2 validateDraft surfaces missing Handlebars template variables.
        missingTemplateVariables: [],
    };
}
