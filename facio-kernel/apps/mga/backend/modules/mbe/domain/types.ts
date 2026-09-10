
export interface EndorsementTemplate {
    id: string;
    program_code: string;
    code: string;
    title: string;
    summary?: string;
    type:
        | 'EXCESS'
        | 'WARRANTY'
        | 'EXCLUSION'
        | 'COVERAGE'
        | 'COVER_EXTENSION'
        | 'COVER_DELETION'
        | 'CONDITION'
        | 'ASSISTANCE'
        | 'SECURITY'
        | 'PROTECTION'
        | 'EXTENSION_SPECIAL';
    scope: 'POLICY' | 'RISK_OBJECT' | 'VEHICLE' | 'DRIVER' | 'COVER';
    section_id?: string;
    jurisdiction: string[];
    legal_text: string;
    parameters_schema: unknown; // JSON Schema
    default_params: unknown;
    rules: EndorsementRules;
    /**
     * Optional program/UI defaults used when building an initial Program MBE config.
     * This avoids hardcoding template codes into the engine.
     */
    option_defaults?: {
        enabledByDefault?: boolean;
        selectedWhen?: Array<{
            path: string;
            equals?: unknown;
        }>;
    };
    /**
     * Optional param computations applied at quote-time (before pricing).
     * Used for simple derived params like term pro-rating.
     */
    computed_params?: Array<
        | {
            type: 'PRO_RATE_BY_POLICY_TERM_MONTHS';
            /** Param name to compute (e.g. premium_eur) */
            param: string;
            /** Default value if param missing or non-numeric */
            defaultValue?: number;
            /** Rounding precision (default 2) */
            precision?: number;
        }
    >;
    ui: {
        group: string;
        help_text: string;
        form_fields: Array<{
            name: string;
            label: string;
            type: string;
            required: boolean;
            options?: string[];
        }>;
    };
    document_template: string;
    requires_underwriter_approval: boolean;
    allowed_with: string[];
    disallowed_with: string[];
}

export interface EndorsementRules {
    prerequisites: PrerequisiteRule[];
    exclusions: string[];
    effects: EndorsementEffect[];
    approval: {
        requires_underwriter: boolean;
    };
}

export interface PrerequisiteRule {
    type: string;
    key?: string;
    in?: unknown[];
    value?: unknown;
    message: string;
}

export type EndorsementEffect =
    | AddExcessEffect
    | AddWarrantyEffect
    | AddCoverEffect
    | AddPremiumRowEffect
    | AddPremiumPctOfNetEffect
    | DeleteCoverEffect
    | SetFlagEffect
    | AddRestrictionEffect
    | AssistanceAttachEffect
    | AlterNcbBehaviourEffect
    | ConditionalEffect;

export interface BaseEffect {
    type: string;
}

export interface AddExcessEffect extends BaseEffect {
    type: 'ADD_EXCESS';
    target: string;
    amount_param: string;
    stacking: 'add' | 'replace' | 'max';
}

export interface AddWarrantyEffect extends BaseEffect {
    type: 'ADD_WARRANTY';
    text: string;
}

export interface AddCoverEffect extends BaseEffect {
    type: 'ADD_COVER';
    target: string;
    section?: string;
    limit_eur?: number;
    params_map?: Record<string, string>;
}

export interface AddPremiumRowEffect extends BaseEffect {
    type: 'ADD_PREMIUM_ROW';
    params_map: {
        item_name: string;
        basis: string;
        value: string;
        amount: string;
    };
}

/**
 * Percentage-of-net-premium loading. Unlike `ADD_PREMIUM_ROW` (which adds a
 * flat amount AFTER tax), this effect is applied BEFORE tax: the percentage
 * is computed against `subtotalNetPremium` (after NCD, after UW adjustments).
 *
 * Introduced for CV 172 Protected NCD per ADR-0023.
 * Optional `min_ncd_pct` gates the effect on the customer's NCD-discount
 * percentage (e.g. 0.60 = 4 years). When the prerequisite is not met the
 * effect contributes €0 (the endorsement remains "selected" but free).
 */
export interface AddPremiumPctOfNetEffect extends BaseEffect {
    type: 'ADD_PREMIUM_PCT_OF_NET';
    /** Decimal fraction. 0.10 = 10%. */
    percentage: number;
    /** Display name for the schedule / breakdown line. */
    item_name: string;
    /** Optional minimum NCD-discount percentage required to charge the loading. */
    min_ncd_pct?: number;
}

export interface DeleteCoverEffect extends BaseEffect {
    type: 'DELETE_COVER';
    target: string;
    description?: string;
}

export interface SetFlagEffect extends BaseEffect {
    type: 'SET_FLAG';
    flag: string;
    value_param?: string;
    description?: string;
}

export interface AddRestrictionEffect extends BaseEffect {
    type: 'ADD_RESTRICTION';
    text: string;
}

export interface AssistanceAttachEffect extends BaseEffect {
    type: 'ASSISTANCE_ATTACH';
    params_map?: Record<string, string>;
}

export interface AlterNcbBehaviourEffect extends BaseEffect {
    type: 'ALTER_NCB_BEHAVIOUR';
    description: string;
}

export interface ConditionalEffect extends BaseEffect {
    type: 'CONDITIONAL_EFFECT';
    condition: unknown;
    effect: EndorsementEffect;
}

export interface ValidationResult {
    valid: boolean;
    messages: string[];
    blocking: boolean;
}

export interface ValidationRequest {
    policySnapshot: Record<string, unknown>;
    endorsementCode: string;
    params: Record<string, unknown>;
    targetId?: string;
    /**
     * Optional context: endorsement codes that are considered "present" while validating prerequisites.
     * Used by prerequisite rules like `endorsement_present`.
     */
    existingEndorsements?: string[];
}
