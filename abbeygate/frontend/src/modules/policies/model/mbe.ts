
/**
 * Endorsement scope values:
 * - POLICY: applies to the whole policy
 * - RISK_OBJECT: applies to a specific insured object (generic: vehicle, property, traveler)
 * - VEHICLE: legacy motor alias of RISK_OBJECT
 * - DRIVER / COVER: legacy motor sub-scopes retained for backward compatibility
 */
export type EndorsementScope = "POLICY" | "RISK_OBJECT" | "VEHICLE" | "DRIVER" | "COVER";

export type FormFieldType =
    | "string"
    | "currency"
    | "date"
    | "boolean"
    | "select"
    | "multiselect"
    | "text"
    | "textarea"
    // Risk-object picker: generic name. `vehicle_select` is the legacy motor alias.
    | "risk_object_select"
    | "vehicle_select";

export interface FormField {
    name: string;
    label: string;
    type: FormFieldType;
    options?: string[];
    required?: boolean;
}

export interface EndorsementTemplate {
    id: string;
    program_code: string;
    code: string; // e.g., "CV 4"
    title: string;
    type: string; // 'EXCESS' | 'COVERAGE' | ...
    scope: EndorsementScope;
    jurisdiction: string[];
    legal_text: string;
    summary?: string;
    document_template?: string;
    parameters_schema: Record<string, unknown>; // JSON Schema
    default_params: Record<string, unknown>;
    ui: {
        group: string;
        help_text: string;
        form_fields: FormField[];
    };
    requires_underwriter_approval: boolean;
    allowed_with: string[];
    disallowed_with: string[];
}

export interface EndorsementInstance {
    id: string;
    policyId: string;
    transactionId: string;
    templateId: string;
    code: string;
    title: string;
    scope: EndorsementScope;
    targetId?: string | null;
    params: Record<string, unknown>;
    effectiveFrom: string;
    effectiveTo?: string | null;
    status: "APPLIED" | "PENDING" | "REJECTED" | "SUPERSEDED";
    premiumDelta: number;
    createdAt: string;
    createdBy?: string;
    approvedBy?: string;
    approvedAt?: string;
}

export interface ValidationMessage {
    status: "VALID" | "WARN" | "ERROR";
    messages: string[];
}

export interface PreviewResponse {
    success: boolean;
    validation: ValidationMessage;
    premiumDelta: number;
    newPremium: number;
    newExcess: number;
    docPreview?: string;
    schedule_diff_html?: string;
}

export interface ApplyResponse {
    success: boolean;
    data: EndorsementInstance;
    error?: string;
}
