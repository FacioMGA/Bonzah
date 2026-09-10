import { McpToolError } from '../../mcp/domain/toolError.js';
import {
    CANCELLATION_REFUND_BASES,
    PAYMENT_TERMS,
} from '../domain/programMetadataExtensions.js';
import { isEditable } from '../domain/productLaunchDraft.js';
import { findDraft, patchDelta } from '../infra/repositories/productLaunchDraftRepo.js';

export interface SetBillingTermsInput {
    draftId: string;
    currency: string;
    paymentTerms: (typeof PAYMENT_TERMS)[number];
    commissionPercent?: number;
    adminFee?: number;
    cancellationRefundBasis: (typeof CANCELLATION_REFUND_BASES)[number];
    nonRefundableFees?: string[];
}

export interface SetBillingTermsOutput {
    billingRuleId: string;
    summary: string;
    warnings: string[];
}

/**
 * V1 billing delta. Numeric fields (commissionPercent → BinderFinancials.commissionRate,
 * adminFee → Tenant.adminFee) land on canonical rows at publish time; the
 * non-numeric posture (paymentTerms, cancellationRefundBasis,
 * nonRefundableFees) lands under Program.metadata.billing (ADR-0038).
 */
export async function setBillingTerms(input: SetBillingTermsInput): Promise<SetBillingTermsOutput> {
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

    const warnings: string[] = [];
    if (input.cancellationRefundBasis === 'short_rate') {
        warnings.push(
            'Short-rate cancellation basis is not yet implemented in the canonical cancellation service ' +
                '(backend/modules/policy/http/cancellationsRouter.ts only supports pro_rata today).',
        );
    }

    await patchDelta(input.draftId, {
        billing: {
            currency: input.currency,
            paymentTerms: input.paymentTerms,
            commissionPercent: input.commissionPercent,
            adminFee: input.adminFee,
            cancellationRefundBasis: input.cancellationRefundBasis,
            nonRefundableFees: input.nonRefundableFees,
        },
    });

    const fragments = [
        `currency=${input.currency}`,
        `paymentTerms=${input.paymentTerms}`,
        input.commissionPercent !== undefined ? `commission=${input.commissionPercent}%` : null,
        input.adminFee !== undefined ? `adminFee=${input.adminFee}` : null,
        `cancellation=${input.cancellationRefundBasis}`,
    ].filter(Boolean);

    return {
        billingRuleId: `billing#${draft.id}`,
        summary: `Billing terms set: ${fragments.join(', ')}.`,
        warnings,
    };
}
