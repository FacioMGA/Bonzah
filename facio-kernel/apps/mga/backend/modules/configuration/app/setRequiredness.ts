import { McpToolError } from '../../mcp/domain/toolError.js';
import { isEditable } from '../domain/productLaunchDraft.js';
import { findDraft, patchDelta } from '../infra/repositories/productLaunchDraftRepo.js';

export interface SetRequirednessInput {
    draftId: string;
    questionKey: string;
    requiredAt: Array<'quote' | 'bind' | 'endorsement' | 'claim_fnol'>;
}

export interface SetRequirednessOutput {
    summary: string;
    warnings: string[];
}

/**
 * V1 questionnaire overlay (ADR-0038). Only tightens canonical
 * requiredness — never loosens, never adds new fields. New questions
 * surface as REQUIRES_ENGINEERING via validateDraft when it confirms
 * the questionKey exists in the product's canonical ValidationProfile.
 *
 * The overlay is consumed at validation time by
 * `applyQuestionnaireOverridesForProgram` (Phase 2 overlay helper).
 */
export async function setRequiredness(input: SetRequirednessInput): Promise<SetRequirednessOutput> {
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
        questionnaireOverrides: {
            requiredAt: { [input.questionKey]: input.requiredAt },
        },
    });

    return {
        summary: `Question "${input.questionKey}" tightened to required at [${input.requiredAt.join(', ')}].`,
        warnings: [],
    };
}
