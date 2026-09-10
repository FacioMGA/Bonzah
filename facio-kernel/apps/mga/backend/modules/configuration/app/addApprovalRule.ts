import { McpToolError } from '../../mcp/domain/toolError.js';
import type { ApprovalRuleEntry } from '../domain/programMetadataExtensions.js';
import { isEditable } from '../domain/productLaunchDraft.js';
import { findDraft, patchDelta } from '../infra/repositories/productLaunchDraftRepo.js';

export type AddApprovalRuleInput = ApprovalRuleEntry & { draftId: string };

export interface AddApprovalRuleOutput {
    approvalRuleId: string;
    summary: string;
}

export async function addApprovalRule(input: AddApprovalRuleInput): Promise<AddApprovalRuleOutput> {
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
    if (input.workflow !== 'quote_referral') {
        throw new McpToolError({
            code: 'REQUIRES_ENGINEERING',
            message: `Workflow "${input.workflow}" is not wired in V1 — only "quote_referral" reads Program.metadata.approvalRules today.`,
            suggestedFix:
                'Wire the workflow consumer (e.g. endorsement / cancellation / claim_payment) before exposing the rule in Config MCP.',
            ticket: {
                kind: 'other',
                summary: `Wire approvalRules reader for workflow "${input.workflow}".`,
                canonicalOwner: 'backend/modules/policy/app',
            },
        });
    }

    const newRule: ApprovalRuleEntry = {
        workflow: input.workflow,
        ruleKey: input.ruleKey,
        name: input.name,
        condition: input.condition,
        requiredRole: input.requiredRole,
    };

    await patchDelta(input.draftId, { approvalRules: [newRule] });

    return {
        approvalRuleId: `approval#${input.workflow}#${input.ruleKey}`,
        summary: `Approval rule "${input.name}" added: workflow=${input.workflow}, requires role "${input.requiredRole}".`,
    };
}
