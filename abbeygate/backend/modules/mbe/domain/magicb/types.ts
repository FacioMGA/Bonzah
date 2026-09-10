
// backend/core/magicb/types.ts

/**
 * MagicB Context: The "Situation" in which validation occurs.
 * This is passed at runtime to the engine.
 */
export interface MagicBContext {
    tenantId: string;
    binderId?: string;
    binderSectionId?: string;
    workflowStep: 'QUOTE' | 'BIND' | 'CLAIM_FNOL' | 'CLAIM_PAYMENT' | 'REPORT_RUN';
    region?: string; // US, UK, etc.
    effectiveDate?: Date;
    streamType?: 'LLOYDS_RISK' | 'LLOYDS_CLAIMS';
}

/**
 * A Canonical Slug Definition (from DB)
 */
export interface SlugDef {
    slug: string; // e.g., "insured.legal_name"
    dataType: 'string' | 'number' | 'money' | 'date' | 'boolean' | 'enum' | 'object';
    title: string;
    binding?: {
        type: 'column' | 'json_path';
        value: string; // e.g. "insured.legal_name" or "$.parties[?(@.role=='insured')].name"
    };
    /**
     * Pre-parsed dot-path segments for json_path bindings.
     * Avoids repeated string splitting in hot loops.
     */
    bindingPathParts?: string[];
}

/**
 * Rule Logic DSL
 * Stored in JSONB. This interface types the runtime object.
 */
export type RuleOp =
    | { op: 'required'; if?: Condition }
    | { op: 'gt'; value: number }
    | { op: 'lt'; value: number }
    | { op: 'one_of'; values: string[] }
    | { op: 'regex'; pattern: string }
    | { op: 'min_length'; value: number }
    | { op: 'date_parse' };

export interface Condition {
    slug?: string;       // Check another slug's value
    contextAxis?: string; // Check context (e.g. country == 'US')
    op: 'eq' | 'neq' | 'in' | 'gt';
    value: unknown;
}

/**
 * The Validation Result
 */
export interface ValidationResult {
    slug: string;
    status: 'PASS' | 'FAIL' | 'WARN';
    message?: string;
    ruleId?: string;
}

/**
 * The Complete "Compliance Matrix"
 * Returned by MagicB.validate()
 */
export interface ComplianceMatrix {
    valid: boolean;
    blockingErrors: ValidationResult[];
    warnings: ValidationResult[];
    missingSlugs: string[]; // Required but not found in inputs
}
