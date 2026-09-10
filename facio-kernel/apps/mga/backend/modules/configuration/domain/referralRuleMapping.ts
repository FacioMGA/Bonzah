import { McpToolError } from '../../mcp/domain/toolError.js';
import type { MotorUwOverrides } from './draftDelta.js';

/**
 * Maps the spec-shaped referral rule ({ condition: { field, operator, value }, severity }) onto
 * the canonical MotorUwConfig keys exposed by
 * `backend/products/motor/underwriting/motorUwAutomation.ts`. Any rule
 * that does not map to an existing threshold key surfaces as
 * REQUIRES_ENGINEERING — V1 does not add new pricing/UW factors.
 */

export type RuleOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'in' | 'neq' | 'contains';
export type RuleSeverity = 'low' | 'medium' | 'high';

export interface ReferralRuleCondition {
    field: string;
    operator: RuleOperator;
    value: string | number | boolean | string[] | number[];
}

export interface ReferralRuleSpec {
    ruleKey: string;
    name: string;
    condition: ReferralRuleCondition;
    severity: RuleSeverity;
    reason: string;
    appliesAt: Array<'quote' | 'bind' | 'endorsement'>;
}

/**
 * Result of translating a spec-shaped rule into an overlay patch.
 * `targetKey` names the canonical MotorUwConfig hop the patch lands on
 * (validators in §validateDraft assert that the key really exists).
 */
export interface ReferralRuleTranslation {
    targetKey: string;
    patch: MotorUwOverrides;
    summary: string;
    warnings: string[];
}

const NUMERIC_FIELD_MAP: Record<string, { decline: string; refer: string }> = {
    vehicleValue: { decline: 'declineVehicleValueOver', refer: 'referralVehicleValueOver' },
    garageTotalValue: { decline: 'declineGarageTotalValueOver', refer: 'declineGarageTotalValueOver' },
    faultClaimAmount: { decline: 'declineFaultClaimOver', refer: 'referralFaultClaimOver' },
    licenceYears: { decline: 'declineLicenceYearsUnder', refer: 'declineLicenceYearsUnder' },
    addedDriverAge: { decline: 'declineAddedDriverAgeUnder', refer: 'referralAddedDriverAgeMin' },
    motorcaravanValue: { decline: 'referralMotorcaravanValueOver', refer: 'referralMotorcaravanValueOver' },
};

const COUNT_FIELD_MAP: Record<string, { decline: string; refer: string }> = {
    claimsCount: { decline: 'declineClaimsCountOver5Years', refer: 'referralClaimsCountAtLeast' },
};

const LIST_FIELD_MAP: Record<string, keyof Pick<MotorUwOverrides, 'allowedRiskCountries' | 'allowedVehicleUses'>> = {
    riskCountry: 'allowedRiskCountries',
    vehicleUse: 'allowedVehicleUses',
};

function referralFlagForCondition(condition: ReferralRuleCondition): string | null {
    const field = condition.field.trim();
    const value = String(condition.value || '').trim().toLowerCase();
    if (field === 'fuelType' && value === 'electric') return 'referElectricVehicles';
    if (field === 'fuelType' && value === 'hybrid') return 'referHybridVehicles';
    if (field === 'vehicleType' && (value === 'motorbike' || value === 'motorcycle')) return 'referMotorcycle';
    if (field === 'vehicleType' && (value === 'motorcaravan' || value === 'motorhome')) return 'referMotorcaravan';
    if (field === 'electricVehicle') return 'referElectricVehicles';
    if (field === 'hybridVehicle') return 'referHybridVehicles';
    if (field === 'motorcycle') return 'referMotorcycle';
    if (field === 'motorcaravan' || field === 'motorhome') return 'referMotorcaravan';
    return null;
}

export function translateReferralRule(rule: ReferralRuleSpec): ReferralRuleTranslation {
    const warnings: string[] = [];

    const referralFlag = referralFlagForCondition(rule.condition);
    if (referralFlag) {
        if (rule.condition.operator !== 'eq' && rule.condition.operator !== 'contains') {
            throw new McpToolError({
                code: 'VALIDATION_ERROR',
                message: `Referral flag rule "${rule.ruleKey}" requires operator "eq" or "contains".`,
            });
        }
        return {
            targetKey: `referralFlags.${referralFlag}`,
            patch: { referralFlags: { [referralFlag]: true } },
            summary: `Enable MotorUwConfig.referralFlags.${referralFlag} (reason="${rule.reason}").`,
            warnings,
        };
    }

    // List-membership rules → allowed* fields
    if ((rule.condition.operator === 'in' || rule.condition.operator === 'contains') && LIST_FIELD_MAP[rule.condition.field]) {
        const key = LIST_FIELD_MAP[rule.condition.field];
        const raw = rule.condition.value;
        if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
            throw new McpToolError({
                code: 'VALIDATION_ERROR',
                message: `Referral rule "${rule.ruleKey}" with operator "in" requires value to be string[].`,
            });
        }
        const patch: MotorUwOverrides = key === 'allowedRiskCountries'
            ? { allowedRiskCountries: raw as string[] }
            : { allowedVehicleUses: raw as string[] };
        return {
            targetKey: key,
            patch,
            summary: `Set ${key} to [${(raw as string[]).join(', ')}].`,
            warnings,
        };
    }

    // Numeric thresholds
    if (typeof rule.condition.value === 'number') {
        const numericMap = NUMERIC_FIELD_MAP[rule.condition.field] || COUNT_FIELD_MAP[rule.condition.field];
        if (!numericMap) {
            throw new McpToolError({
                code: 'REQUIRES_ENGINEERING',
                message: `No canonical MotorUwConfig threshold maps to field "${rule.condition.field}".`,
                suggestedFix:
                    'Add the field to the MotorUwConfig thresholds (motorUwAutomation.ts) via an ADR before exposing it in Config MCP.',
                ticket: {
                    kind: 'new_factor',
                    summary: `Add MotorUwConfig threshold for "${rule.condition.field}".`,
                    canonicalOwner: 'backend/products/motor/underwriting/motorUwAutomation.ts',
                },
            });
        }
        const isDecline = rule.severity === 'high';
        const targetKey = isDecline ? numericMap.decline : numericMap.refer;
        const patch: MotorUwOverrides = {
            thresholds: { [targetKey]: rule.condition.value },
        };
        return {
            targetKey,
            patch,
            summary: `Set thresholds.${targetKey} = ${rule.condition.value} (severity=${rule.severity}, reason="${rule.reason}").`,
            warnings,
        };
    }

    throw new McpToolError({
        code: 'REQUIRES_ENGINEERING',
        message: `Referral rule shape not supported by Config MCP V1: field="${rule.condition.field}", operator="${rule.condition.operator}".`,
        suggestedFix:
            'Use a numeric threshold rule (operator gt/gte/lt/lte, numeric value) or a list rule (operator in, string[] value).',
        ticket: {
            kind: 'new_factor',
            summary: `Extend referralRuleMapping for field "${rule.condition.field}".`,
            canonicalOwner: 'backend/modules/configuration/domain/referralRuleMapping.ts',
        },
    });
}
