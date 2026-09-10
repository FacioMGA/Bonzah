import { z } from 'zod';
import {
    ApprovalRuleEntrySchema,
    JurisdictionOverridesSchema,
    ProgramBillingTermsSchema,
    QuestionnaireOverridesSchema,
} from './programMetadataExtensions.js';

/**
 * Typed delta accumulated by Config MCP write tools (ADR-0037).
 *
 * Mirrors the V1 tool catalog one-to-one. The publish step translates
 * each delta family into writes against canonical rows:
 *
 *   - uwOverrides              → Program.metadata.abbeygateMotorUwConfig
 *   - mbeOverrides             → Program.metadata.mbeProductConfig
 *   - questionnaireOverrides   → Program.metadata.questionnaireOverrides   (ADR-0038)
 *   - approvalRules            → Program.metadata.approvalRules            (ADR-0038)
 *   - jurisdictionOverrides    → Program.metadata.jurisdictionOverrides    (ADR-0038)
 *   - billing                  → BinderFinancials.commissionRate + Tenant.adminFee + Program.metadata.billing
 *   - binderAuthorityOverrides → BinderProductAuthority on publish
 *
 * This is the ONLY write path from MCP tools to canonical configuration.
 */

// --- MotorUwConfig partial (subset writable from MCP V1) ---------------
// We keep this as an open record-of-numbers + arrays here because the
// canonical shape lives in backend/products/motor/underwriting/motorUwAutomation.ts
// and we deliberately do not re-declare it (avoids drift). The reference
// check in validateDraft proves every key is a real MotorUwConfig field.
export const MotorUwOverridesSchema = z
    .object({
        allowedRiskCountries: z.array(z.string().min(1)).optional(),
        allowedVehicleUses: z.array(z.string().min(1)).optional(),
        referralFlags: z.record(z.string(), z.boolean()).optional(),
        thresholds: z.record(z.string(), z.number().finite()).optional(),
    })
    .strict();
export type MotorUwOverrides = z.infer<typeof MotorUwOverridesSchema>;

// --- MBE coverage selection delta -------------------------------------
export const MbeOverridesSchema = z
    .object({
        baseEnabled: z.array(z.string().min(1)).optional(),
        baseDisabled: z.array(z.string().min(1)).optional(),
        optionsEnabledByDefault: z.array(z.string().min(1)).optional(),
        optionsDisabledByDefault: z.array(z.string().min(1)).optional(),
    })
    .strict();
export type MbeOverrides = z.infer<typeof MbeOverridesSchema>;

// --- Billing delta ----------------------------------------------------
// Numeric fields land on BinderFinancials / Tenant at publish time; the
// non-numeric subset (paymentTerms / cancellationRefundBasis / fees) is
// the ProgramBillingTerms shape from ADR-0038.
export const BillingDeltaSchema = ProgramBillingTermsSchema.extend({
    currency: z.string().length(3).optional(),
    commissionPercent: z.number().min(0).max(100).optional(),
    adminFee: z.number().min(0).optional(),
}).strict();
export type BillingDelta = z.infer<typeof BillingDeltaSchema>;

// --- BinderProductAuthority delta -------------------------------------
export const BinderAuthorityOverrideDeltaSchema = z
    .object({
        territorialScope: z.array(z.string().length(2)).optional(),
        maxPremiumAnnual: z.number().min(0).nullable().optional(),
        maxPolicyPeriodDays: z.number().int().min(1).nullable().optional(),
        maxAdvanceInceptionDays: z.number().int().min(0).nullable().optional(),
        authorityClasses: z.array(z.string().min(1)).optional(),
    })
    .strict();
export type BinderAuthorityOverrideDelta = z.infer<typeof BinderAuthorityOverrideDeltaSchema>;

// --- Composed DraftDelta ----------------------------------------------
export const DraftDeltaSchema = z
    .object({
        uwOverrides: MotorUwOverridesSchema.optional(),
        mbeOverrides: MbeOverridesSchema.optional(),
        questionnaireOverrides: QuestionnaireOverridesSchema.optional(),
        approvalRules: z.array(ApprovalRuleEntrySchema).optional(),
        jurisdictionOverrides: JurisdictionOverridesSchema.optional(),
        billing: BillingDeltaSchema.optional(),
        binderAuthorityOverrides: BinderAuthorityOverrideDeltaSchema.optional(),
    })
    .strict();

export type DraftDelta = z.infer<typeof DraftDeltaSchema>;

export const EMPTY_DRAFT_DELTA: DraftDelta = {};

export function mergeDraftDelta(current: DraftDelta, patch: DraftDelta): DraftDelta {
    return {
        uwOverrides: mergeUwOverrides(current.uwOverrides, patch.uwOverrides),
        mbeOverrides: mergeMbeOverrides(current.mbeOverrides, patch.mbeOverrides),
        questionnaireOverrides: mergeQuestionnaireOverrides(
            current.questionnaireOverrides,
            patch.questionnaireOverrides,
        ),
        approvalRules: mergeApprovalRules(current.approvalRules, patch.approvalRules),
        jurisdictionOverrides: mergeJurisdictionOverrides(
            current.jurisdictionOverrides,
            patch.jurisdictionOverrides,
        ),
        billing: mergeBilling(current.billing, patch.billing),
        binderAuthorityOverrides: mergeBinderAuthority(
            current.binderAuthorityOverrides,
            patch.binderAuthorityOverrides,
        ),
    };
}

function mergeUwOverrides(a?: MotorUwOverrides, b?: MotorUwOverrides): MotorUwOverrides | undefined {
    if (!a && !b) return undefined;
    const aT = a?.thresholds || {};
    const bT = b?.thresholds || {};
    const aF = a?.referralFlags || {};
    const bF = b?.referralFlags || {};
    return {
        allowedRiskCountries: b?.allowedRiskCountries ?? a?.allowedRiskCountries,
        allowedVehicleUses: b?.allowedVehicleUses ?? a?.allowedVehicleUses,
        referralFlags: Object.keys(aF).length || Object.keys(bF).length ? { ...aF, ...bF } : undefined,
        thresholds: Object.keys(aT).length || Object.keys(bT).length ? { ...aT, ...bT } : undefined,
    };
}

function mergeMbeOverrides(a?: MbeOverrides, b?: MbeOverrides): MbeOverrides | undefined {
    if (!a && !b) return undefined;
    return {
        baseEnabled: b?.baseEnabled ?? a?.baseEnabled,
        baseDisabled: b?.baseDisabled ?? a?.baseDisabled,
        optionsEnabledByDefault: b?.optionsEnabledByDefault ?? a?.optionsEnabledByDefault,
        optionsDisabledByDefault: b?.optionsDisabledByDefault ?? a?.optionsDisabledByDefault,
    };
}

function mergeQuestionnaireOverrides(
    a?: z.infer<typeof QuestionnaireOverridesSchema>,
    b?: z.infer<typeof QuestionnaireOverridesSchema>,
) {
    if (!a && !b) return undefined;
    return {
        requiredAt: { ...(a?.requiredAt || {}), ...(b?.requiredAt || {}) },
    };
}

function mergeApprovalRules(
    a?: z.infer<typeof ApprovalRuleEntrySchema>[],
    b?: z.infer<typeof ApprovalRuleEntrySchema>[],
) {
    if (!a && !b) return undefined;
    const byKey = new Map<string, z.infer<typeof ApprovalRuleEntrySchema>>();
    for (const rule of a || []) byKey.set(rule.ruleKey, rule);
    for (const rule of b || []) byKey.set(rule.ruleKey, rule);
    return Array.from(byKey.values());
}

function mergeJurisdictionOverrides(
    a?: z.infer<typeof JurisdictionOverridesSchema>,
    b?: z.infer<typeof JurisdictionOverridesSchema>,
) {
    if (!a && !b) return undefined;
    const aDocs = a?.documentConfig || [];
    const bDocs = b?.documentConfig || [];
    const byType = new Map<string, (typeof aDocs)[number]>();
    for (const d of aDocs) byType.set(d.documentType, d);
    for (const d of bDocs) byType.set(d.documentType, { ...byType.get(d.documentType), ...d });
    return { documentConfig: Array.from(byType.values()) };
}

function mergeBilling(a?: BillingDelta, b?: BillingDelta): BillingDelta | undefined {
    if (!a && !b) return undefined;
    return { ...(a || {}), ...(b || {}) };
}

function mergeBinderAuthority(
    a?: BinderAuthorityOverrideDelta,
    b?: BinderAuthorityOverrideDelta,
): BinderAuthorityOverrideDelta | undefined {
    if (!a && !b) return undefined;
    return { ...(a || {}), ...(b || {}) };
}
