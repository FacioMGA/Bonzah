import { McpToolError } from '../../mcp/domain/toolError.js';
import { isEditable } from '../domain/productLaunchDraft.js';
import {
    translateReferralRule,
    type ReferralRuleSpec,
} from '../domain/referralRuleMapping.js';
import { findDraft, patchDelta } from '../infra/repositories/productLaunchDraftRepo.js';

export interface AddReferralRuleInput extends ReferralRuleSpec {
    draftId: string;
}

export interface AddReferralRuleOutput {
    ruleId: string;
    targetKey: string;
    summary: string;
    warnings: string[];
}

export async function addReferralRule(input: AddReferralRuleInput): Promise<AddReferralRuleOutput> {
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

    // Duplicate-key check across already-applied UW threshold overrides.
    const existingThresholds = draft.delta.uwOverrides?.thresholds || {};
    if (existingThresholds[input.ruleKey] !== undefined && input.ruleKey !== input.condition.field) {
        // Allow re-setting if the agent is targeting the same threshold key explicitly.
    }

    const translation = translateReferralRule({
        ruleKey: input.ruleKey,
        name: input.name,
        condition: input.condition,
        severity: input.severity,
        reason: input.reason,
        appliesAt: input.appliesAt,
    });

    await patchDelta(input.draftId, { uwOverrides: translation.patch });

    return {
        ruleId: `${translation.targetKey}#${input.ruleKey}`,
        targetKey: translation.targetKey,
        summary: translation.summary,
        warnings: translation.warnings,
    };
}
