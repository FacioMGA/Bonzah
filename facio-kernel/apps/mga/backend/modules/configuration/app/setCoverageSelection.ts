import { McpToolError } from '../../mcp/domain/toolError.js';
import { isEditable } from '../domain/productLaunchDraft.js';
import { findDraft, patchDelta } from '../infra/repositories/productLaunchDraftRepo.js';

export interface SetCoverageSelectionInput {
    draftId: string;
    baseEnabled?: string[];
    baseDisabled?: string[];
    optionsEnabledByDefault?: string[];
    optionsDisabledByDefault?: string[];
}

export interface SetCoverageSelectionOutput {
    summary: string;
}

export async function setCoverageSelection(
    input: SetCoverageSelectionInput,
): Promise<SetCoverageSelectionOutput> {
    const draft = await findDraft(input.draftId);
    if (!draft) {
        throw new McpToolError({ code: 'DRAFT_NOT_FOUND', message: `No draft "${input.draftId}".` });
    }
    if (!isEditable(draft.status)) {
        throw new McpToolError({
            code: 'PUBLISH_BLOCKED',
            message: `Draft "${input.draftId}" is in terminal status "${draft.status}".`,
        });
    }
    if (
        !input.baseEnabled?.length &&
        !input.baseDisabled?.length &&
        !input.optionsEnabledByDefault?.length &&
        !input.optionsDisabledByDefault?.length
    ) {
        throw new McpToolError({
            code: 'VALIDATION_ERROR',
            message: 'setCoverageSelection requires at least one of base/options enabled/disabled arrays to be non-empty.',
        });
    }

    await patchDelta(input.draftId, {
        mbeOverrides: {
            baseEnabled: input.baseEnabled,
            baseDisabled: input.baseDisabled,
            optionsEnabledByDefault: input.optionsEnabledByDefault,
            optionsDisabledByDefault: input.optionsDisabledByDefault,
        },
    });

    const counts = [
        input.baseEnabled?.length ? `base+${input.baseEnabled.length}` : null,
        input.baseDisabled?.length ? `base-${input.baseDisabled.length}` : null,
        input.optionsEnabledByDefault?.length ? `optDefault+${input.optionsEnabledByDefault.length}` : null,
        input.optionsDisabledByDefault?.length ? `optDefault-${input.optionsDisabledByDefault.length}` : null,
    ].filter(Boolean);

    return { summary: `MBE coverage selection updated (${counts.join(', ')}).` };
}
