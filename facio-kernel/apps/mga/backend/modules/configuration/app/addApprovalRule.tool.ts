import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import {
    APPROVAL_WORKFLOWS,
    ApprovalRuleConditionSchema,
} from '../domain/programMetadataExtensions.js';
import { addApprovalRule } from './addApprovalRule.js';

const InputSchema = z
    .object({
        draftId: z.string().min(1),
        workflow: z.enum(APPROVAL_WORKFLOWS),
        ruleKey: z.string().min(1),
        name: z.string().min(1),
        condition: ApprovalRuleConditionSchema,
        requiredRole: z.string().min(1),
    })
    .strict();

const OutputSchema = z.object({
    approvalRuleId: z.string(),
    summary: z.string(),
});

export const addApprovalRuleTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'config.workflows.addApprovalRule',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.draft',
    description:
        'Add an approval rule for a workflow. V1 only wires quote_referral; other workflows surface REQUIRES_ENGINEERING.',
    auditClass: 'draft',
    run: async (input) => addApprovalRule(input),
};
