import { ZodError } from 'zod';
import { McpToolError } from '../../mcp/domain/toolError.js';
import { ValidationRegistry } from '@facio/validation/backend';
import { DraftDeltaSchema, type DraftDelta } from '../domain/draftDelta.js';
import {
    CONFIG_MCP_METADATA_KEYS,
    DOCUMENT_TYPES,
} from '../domain/programMetadataExtensions.js';
import type { ConfigDraftStatus, ProductLaunchDraft } from '../domain/productLaunchDraft.js';
import { KNOWN_MOTOR_UW_REFERRAL_FLAG_KEYS, KNOWN_MOTOR_UW_THRESHOLD_KEYS } from '../domain/uwThresholdKeys.js';
import {
    summarizeValidation,
    type ValidationIssue,
    type ValidationResult,
} from '../domain/validationIssue.js';
import { findDraft, updateStatus } from '../infra/repositories/productLaunchDraftRepo.js';

/**
 * Composes the staged delta against the canonical defaults and runs
 * the five validation families enumerated in the implementation plan §7.1:
 *
 *   1. Static schema   — Zod re-parse of `delta`.
 *   2. Reference checks — every threshold key / document type / question path exists.
 *   3. Threshold sanity — numeric ranges, currency length, etc.
 *   4. Conflict detection — overlay does not loosen canonical requiredness; duplicates.
 *   5. Publishability gates — sandbox tenant present + simulation passed (caller).
 *
 * Returns a ValidationResult and flips the draft's persistence state
 * to `validated` / `validation_failed`. Re-validation is idempotent.
 */
export interface ValidateDraftInput {
    draftId: string;
}

export type ValidateDraftOutput = ValidationResult & {
    draftId: string;
    nextStatus: ConfigDraftStatus;
    summary: string;
};

export async function validateDraft(input: ValidateDraftInput): Promise<ValidateDraftOutput> {
    const draft = await findDraft(input.draftId);
    if (!draft) {
        throw new McpToolError({ code: 'DRAFT_NOT_FOUND', message: `No draft "${input.draftId}".` });
    }
    const issues: ValidationIssue[] = [];

    // 1. Static schema
    try {
        DraftDeltaSchema.parse(draft.delta);
    } catch (err) {
        if (err instanceof ZodError) {
            for (const issue of err.issues) {
                issues.push({
                    code: 'DELTA_SCHEMA_VIOLATION',
                    severity: 'error',
                    message: issue.message,
                    path: issue.path.join('.'),
                });
            }
        } else {
            throw err;
        }
    }

    // 2 + 3 + 4: family-specific checks
    checkUnderwritingOverrides(draft.delta, issues);
    checkQuestionnaireOverrides(draft, draft.delta, issues);
    checkDocumentOverrides(draft.delta, issues);
    checkBillingDelta(draft.delta, issues);
    checkApprovalRules(draft.delta, issues);
    checkOverlayKeysAllowlist(draft.delta, issues);

    // 5. Publishability gates (capacity provider / template availability) ─
    //    advisory warnings for the demo. Production gate is enforced at
    //    definition publication time.
    if (!draft.delta.binderAuthorityOverrides) {
        issues.push({
            code: 'NO_BINDER_AUTHORITY_OVERRIDE',
            severity: 'warning',
            message: 'No binder authority caps configured — publish will use the template default binder authority unchanged.',
        });
    }
    if (
        (draft.delta.jurisdictionOverrides?.documentConfig || []).some(
            (d) => d.documentType === 'green_card' && d.issuanceTrigger === 'on_request',
        )
    ) {
        issues.push({
            code: 'GREEN_CARD_TEMPLATE_NOT_MAPPED',
            severity: 'warning',
            message:
                'Green Card is on-request — no Handlebars template variables are mapped yet. Engineering ticket required before production publish.',
            suggestedFix:
                'See JURISDICTION_DOCUMENT_PRESETS in backend/modules/jurisdiction/domain/productConfiguration.ts.',
        });
    }

    const hasErrors = issues.some((i) => i.severity === 'error');
    const result: ValidationResult = { status: hasErrors ? 'failed' : 'passed', issues };
    const nextStatus: ConfigDraftStatus = hasErrors ? 'validation_failed' : 'validated';
    await updateStatus(draft.id, nextStatus);

    return {
        ...result,
        draftId: draft.id,
        nextStatus,
        summary: summarizeValidation(result),
    };
}

// --- Family checks ----------------------------------------------------

function checkUnderwritingOverrides(delta: DraftDelta, issues: ValidationIssue[]): void {
    const uw = delta.uwOverrides;
    if (!uw) return;
    if (uw.thresholds) {
        for (const [key, value] of Object.entries(uw.thresholds)) {
            if (!KNOWN_MOTOR_UW_THRESHOLD_KEYS.has(key)) {
                issues.push({
                    code: 'UNKNOWN_UW_THRESHOLD_KEY',
                    severity: 'error',
                    message: `UW threshold "${key}" does not exist on the canonical MotorUwConfig.`,
                    path: `uwOverrides.thresholds.${key}`,
                    suggestedFix:
                        'Use a threshold key from MotorUwConfig.thresholds (mirrored in backend/modules/configuration/domain/uwThresholdKeys.ts), or add the threshold via an ADR before exposing it in Config MCP.',
                });
                continue;
            }
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
                issues.push({
                    code: 'INVALID_UW_THRESHOLD_VALUE',
                    severity: 'error',
                    message: `UW threshold "${key}" must be a non-negative finite number.`,
                    path: `uwOverrides.thresholds.${key}`,
                });
            }
        }
    }
    if (uw.referralFlags) {
        for (const [key, value] of Object.entries(uw.referralFlags)) {
            if (!KNOWN_MOTOR_UW_REFERRAL_FLAG_KEYS.has(key)) {
                issues.push({
                    code: 'UNKNOWN_UW_REFERRAL_FLAG_KEY',
                    severity: 'error',
                    message: `UW referral flag "${key}" does not exist on the canonical MotorUwConfig.`,
                    path: `uwOverrides.referralFlags.${key}`,
                    suggestedFix:
                        'Use a referral flag key from MotorUwConfig.referralFlags (mirrored in backend/modules/configuration/domain/uwThresholdKeys.ts), or add the flag via an ADR before exposing it in Config MCP.',
                });
                continue;
            }
            if (typeof value !== 'boolean') {
                issues.push({
                    code: 'INVALID_UW_REFERRAL_FLAG_VALUE',
                    severity: 'error',
                    message: `UW referral flag "${key}" must be boolean.`,
                    path: `uwOverrides.referralFlags.${key}`,
                });
            }
        }
    }
    if (uw.allowedRiskCountries && uw.allowedRiskCountries.length === 0) {
        issues.push({
            code: 'EMPTY_ALLOWED_RISK_COUNTRIES',
            severity: 'error',
            message: 'allowedRiskCountries cannot be empty — no risk would ever be quotable.',
            path: 'uwOverrides.allowedRiskCountries',
        });
    }
    if (uw.allowedVehicleUses && uw.allowedVehicleUses.length === 0) {
        issues.push({
            code: 'EMPTY_ALLOWED_VEHICLE_USES',
            severity: 'error',
            message: 'allowedVehicleUses cannot be empty — no vehicle use would ever be quotable.',
            path: 'uwOverrides.allowedVehicleUses',
        });
    }
}

function checkQuestionnaireOverrides(
    draft: ProductLaunchDraft,
    delta: DraftDelta,
    issues: ValidationIssue[],
): void {
    const overrides = delta.questionnaireOverrides?.requiredAt;
    if (!overrides) return;
    const profile = ValidationRegistry.get(draft.productCode);
    const knownFields = profile ? new Set(Object.keys(profile.fields)) : null;
    for (const [questionKey, stages] of Object.entries(overrides)) {
        if (knownFields && !knownFields.has(questionKey)) {
            issues.push({
                code: 'UNKNOWN_FIELD_REFERENCE',
                severity: 'error',
                message: `Questionnaire override targets "${questionKey}" but no such field exists in the ${draft.productCode} ValidationProfile.`,
                path: `questionnaireOverrides.requiredAt.${questionKey}`,
                suggestedFix:
                    'Use a canonical field path from packages/products/src/<product>/profile.ts, or open an ADR to add the field.',
            });
        }
        if (!stages || stages.length === 0) {
            issues.push({
                code: 'EMPTY_REQUIRED_AT',
                severity: 'error',
                message: `Override for "${questionKey}" must specify at least one stage.`,
                path: `questionnaireOverrides.requiredAt.${questionKey}`,
            });
        }
    }
}

function checkDocumentOverrides(delta: DraftDelta, issues: ValidationIssue[]): void {
    const overrides = delta.jurisdictionOverrides?.documentConfig;
    if (!overrides) return;
    const seen = new Set<string>();
    const allowedDocs = new Set<string>(DOCUMENT_TYPES);
    for (const entry of overrides) {
        if (!allowedDocs.has(entry.documentType)) {
            issues.push({
                code: 'UNKNOWN_DOCUMENT_TYPE',
                severity: 'error',
                message: `Document type "${entry.documentType}" is not in the canonical document type set.`,
                path: `jurisdictionOverrides.documentConfig.${entry.documentType}`,
            });
        }
        if (seen.has(entry.documentType)) {
            issues.push({
                code: 'DUPLICATE_KEY',
                severity: 'error',
                message: `Document type "${entry.documentType}" is set twice.`,
                path: `jurisdictionOverrides.documentConfig.${entry.documentType}`,
            });
        }
        seen.add(entry.documentType);
    }
}

function checkBillingDelta(delta: DraftDelta, issues: ValidationIssue[]): void {
    const billing = delta.billing;
    if (!billing) return;
    if (billing.commissionPercent !== undefined && (billing.commissionPercent < 0 || billing.commissionPercent > 100)) {
        issues.push({
            code: 'INVALID_COMMISSION_PERCENT',
            severity: 'error',
            message: `Commission percent must be in [0, 100], got ${billing.commissionPercent}.`,
            path: 'billing.commissionPercent',
        });
    }
    if (billing.currency && billing.currency.length !== 3) {
        issues.push({
            code: 'INVALID_CURRENCY',
            severity: 'error',
            message: `Currency must be a 3-letter ISO code, got "${billing.currency}".`,
            path: 'billing.currency',
        });
    }
}

function checkApprovalRules(delta: DraftDelta, issues: ValidationIssue[]): void {
    const rules = delta.approvalRules || [];
    const seen = new Set<string>();
    for (const rule of rules) {
        const key = `${rule.workflow}#${rule.ruleKey}`;
        if (seen.has(key)) {
            issues.push({
                code: 'DUPLICATE_KEY',
                severity: 'error',
                message: `Duplicate approval rule "${rule.ruleKey}" for workflow "${rule.workflow}".`,
                path: `approvalRules.${rule.ruleKey}`,
            });
        }
        seen.add(key);
    }
}

function checkOverlayKeysAllowlist(delta: DraftDelta, issues: ValidationIssue[]): void {
    // Historical V1 draft slots are retained only for read/validation of
    // evidence. ADR-0101 retires their Program.metadata publication path.
    const allowed = new Set<string>(CONFIG_MCP_METADATA_KEYS);
    const slotToMetadataKey: Record<string, string> = {
        uwOverrides: 'abbeygateMotorUwConfig',
        mbeOverrides: 'mbeProductConfig',
        questionnaireOverrides: 'questionnaireOverrides',
        approvalRules: 'approvalRules',
        jurisdictionOverrides: 'jurisdictionOverrides',
        billing: 'billing',
    };
    for (const [slot, metadataKey] of Object.entries(slotToMetadataKey)) {
        const value = (delta as unknown as Record<string, unknown>)[slot];
        if (value === undefined) continue;
        if (!allowed.has(metadataKey)) {
            issues.push({
                code: 'OVERLAY_KEY_NOT_ALLOWLISTED',
                severity: 'error',
                message: `Delta slot "${slot}" would write to Program.metadata.${metadataKey} which is not in the Config MCP allowlist.`,
                path: slot,
                suggestedFix:
                    'Add the metadata key to CONFIG_MCP_METADATA_KEYS via an ADR amendment to ADR-0038.',
            });
        }
    }
}
