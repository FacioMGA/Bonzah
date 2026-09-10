import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { McpToolError } from '../../mcp/domain/toolError.js';
import { findDraft } from '../infra/repositories/productLaunchDraftRepo.js';

const InputSchema = z.object({ draftId: z.string().min(1) }).strict();
const OutputSchema = z.object({
    allowedRiskCountries: z.array(z.string()).optional(),
    allowedVehicleUses: z.array(z.string()).optional(),
    referralFlags: z.record(z.string(), z.boolean()),
    thresholds: z.record(z.string(), z.number()),
});

export const listReferralRulesTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'config.underwriting.listReferralRules',
    family: 'config',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'configuration.read',
    description: 'List the referral / decline overrides currently staged on a draft (UW threshold map).',
    auditClass: 'read',
    run: async (input) => {
        const draft = await findDraft(input.draftId);
        if (!draft) {
            throw new McpToolError({ code: 'DRAFT_NOT_FOUND', message: `No draft "${input.draftId}".` });
        }
        const uw = draft.delta.uwOverrides;
        return {
            allowedRiskCountries: uw?.allowedRiskCountries,
            allowedVehicleUses: uw?.allowedVehicleUses,
            referralFlags: uw?.referralFlags ?? {},
            thresholds: uw?.thresholds ?? {},
        };
    },
};
