/**
 * Canned tool-call sequences used by the BO Product Architect demo.
 *
 * Each scenario is what an AI Product Architect agent WOULD emit given
 * the spec demo prompt. In V1 we stream these as a fixed sequence so
 * the demo proves the tool execution pipeline end-to-end without
 * requiring an LLM round-trip — the only thing the model would change
 * is the ordering and the literal values.
 */

import type { StreamToolCall } from '@/src/modules/configuration/api/mcpSseClient';

export function buildClassicCarDemoToolCalls(draftId: string): StreamToolCall[] {
    return [
        // Referral / decline rules.
        {
            toolName: 'config.underwriting.addReferralRule',
            input: {
                draftId,
                ruleKey: 'declineVehicleValueOver',
                name: 'Decline classic cars over €100,000 declared value',
                condition: { field: 'vehicleValue', operator: 'gt', value: 100000 },
                severity: 'high',
                reason: 'Classic car authority cap',
                appliesAt: ['quote', 'bind'],
            },
        },
        {
            toolName: 'config.underwriting.addReferralRule',
            input: {
                draftId,
                ruleKey: 'referralAddedDriverAgeMin',
                name: 'Refer additional drivers under 25',
                condition: { field: 'addedDriverAge', operator: 'lt', value: 25 },
                severity: 'medium',
                reason: 'Young driver risk on classic vehicle',
                appliesAt: ['quote'],
            },
        },
        {
            toolName: 'config.underwriting.addReferralRule',
            input: {
                draftId,
                ruleKey: 'referralClaimsCountAtLeast',
                name: 'Refer when claims count ≥ 2',
                condition: { field: 'claimsCount', operator: 'gte', value: 2 },
                severity: 'medium',
                reason: 'Multiple claims history',
                appliesAt: ['quote'],
            },
        },
        {
            toolName: 'config.underwriting.addReferralRule',
            input: {
                draftId,
                ruleKey: 'allowedVehicleUses',
                name: 'Restrict to occasional / weekend use',
                condition: { field: 'vehicleUse', operator: 'in', value: ['Occasional', 'Weekend'] },
                severity: 'medium',
                reason: 'Classic car usage restriction',
                appliesAt: ['quote', 'bind'],
            },
        },
        // Documents.
        {
            toolName: 'config.documents.setRequiredDocument',
            input: {
                draftId,
                documentType: 'certificate',
                requiredAt: ['bind'],
                issuanceTrigger: 'on_bind',
            },
        },
        {
            toolName: 'config.documents.setRequiredDocument',
            input: {
                draftId,
                documentType: 'schedule',
                requiredAt: ['bind'],
                issuanceTrigger: 'on_bind',
            },
        },
        {
            toolName: 'config.documents.setRequiredDocument',
            input: {
                draftId,
                documentType: 'green_card',
                requiredAt: [],
                issuanceTrigger: 'on_request',
            },
        },
        // Billing.
        {
            toolName: 'config.billing.setCommercialTerms',
            input: {
                draftId,
                currency: 'EUR',
                paymentTerms: 'pay_before_bind',
                commissionPercent: 12.5,
                cancellationRefundBasis: 'pro_rata',
                nonRefundableFees: ['adminFee'],
            },
        },
    ];
}
