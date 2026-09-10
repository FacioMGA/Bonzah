import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { addReferralRule } from './addReferralRule.js';

const ConditionSchema = z
    .object({
        field: z.string().min(1),
        operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'in', 'contains']),
        value: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.array(z.string()),
            z.array(z.number()),
        ]),
    })
    .strict();

const InputSchema = z
    .object({
        draftId: z.string().min(1),
        ruleKey: z.string().min(1),
        name: z.string().min(1),
        condition: ConditionSchema,
        severity: z.enum(['low', 'medium', 'high']),
        reason: z.string().min(1),
        appliesAt: z.array(z.enum(['quote', 'bind', 'endorsement'])).min(1),
    })
    .strict();

const OutputSchema = z.object({
    ruleId: z.string(),
    targetKey: z.string(),
    summary: z.string(),
    warnings: z.array(z.string()),
});

export const addReferralRuleTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'config.underwriting.addReferralRule',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.draft',
    description:
        'Add a referral or decline threshold to a draft. The rule is translated onto an existing MotorUwConfig threshold key — rules referencing unknown fields surface as REQUIRES_ENGINEERING.',
    auditClass: 'draft',
    run: async (input) => addReferralRule(input),
};
