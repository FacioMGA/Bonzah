/**
 * Issue-Readiness: Pure Type Declarations
 *
 * All type aliases and interfaces consumed by the issue-readiness domain.
 * Extracted per CHAMPS "types" module pattern — zero runtime, pure declarations.
 */

export type IssueChannel = 'bo' | 'customer';
export type UwWorkflowState =
    | 'NOT_STARTED'
    | 'CUSTOMER_STARTED'
    | 'UW_STARTED'
    | 'QUESTIONNAIRE_SENT'
    | 'FOLLOWUPS_OPEN'
    | 'QUOTE_READY';

export type IssueBlockerCode =
    | 'DOCUMENT_FIELDS_MISSING'
    | 'CONDITIONAL_REQUIREMENTS_UNMET'
    | 'DOCUMENTS_PENDING_GENERATION'
    // ADR-0017 — terminal failed state: emitted when the doc-pack worker
    // recorded a structured `ISSUED_PACK_*` payment event AFTER the
    // latest GENERATED `ISSUED_POLICY_PACK` document (or with no docs
    // at all). Severity BLOCK so the wizard stops polling and shows
    // an explicit recovery surface instead of looping in `pending`.
    | 'DOCUMENTS_GENERATION_FAILED'
    | 'WELCOME_EMAIL_PENDING'
    | 'WELCOME_EMAIL_FAILED'
    | 'UW_INCOMPLETE'
    | 'PRICING_INVALID'
    | 'PRICING_HASH_MISMATCH'
    | 'PRICING_DRIFT'
    | 'SANCTIONS_BLOCKED'
    | 'SANCTIONS_EVIDENCE_MISSING'
    | 'SANCTIONS_PROVIDER_UNAVAILABLE'
    | 'PAYMENT_REQUIRED_NOT_RECEIVED'
    | 'POLICY_LOCKED_BY_TRANSACTION'
    | 'REFERRAL_PENDING_APPROVAL'
    | 'DECLINED'
    | 'QUOTE_DATA_INVALID'
    | 'PRODUCT_NOT_SUPPORTED'
    | 'PRODUCT_NOT_ASSIGNED'
    | 'PROGRAM_NOT_ACTIVE'
    | 'PROGRAM_OUT_OF_WINDOW'
    | 'BINDER_NOT_ACTIVE'
    | 'BINDER_OUT_OF_WINDOW'
    | 'BINDER_AUTHORITY_NOT_ACTIVE'
    | 'BINDER_AUTHORITY_OUT_OF_WINDOW'
    | 'UNKNOWN';

export type IssueBlockerGroup = 'STATUS' | 'PRICING' | 'UNDERWRITING' | 'DOCUMENTS' | 'PAYMENT' | 'LOCK' | 'OTHER';
export type IssueBlockerSeverity = 'BLOCK' | 'WARN';

export type IssueBlockerAction = {
    label: string;
    // Declarative actions so UI can map them.
    actionId?:
    | 'BO.RECALC_PREMIUM'
    | 'BO.OPEN_CUSTOMER_QUOTE'
    | 'BO.OPEN_PAYMENT'
    | 'BO.SEND_QUESTIONNAIRE'
    | 'BO.MANUAL_UW_APPROVAL'
    | 'CUSTOMER.GO_TO_STEP';
    href?: string;
    hash?: string;
};

export type IssueBlocker = {
    code: IssueBlockerCode;
    message: string;
    group?: IssueBlockerGroup;
    severity?: IssueBlockerSeverity;
    actions?: IssueBlockerAction[];
    details?: Record<string, unknown>;
};

type LifecycleStatus = import('./status.js').LifecycleStatus;

export type IssueReadinessResult = {
    channel: IssueChannel;
    policyId: string;
    status: LifecycleStatus;
    canIssue: boolean;
    canGenerateQuotePack: boolean;
    canGenerateIssuedDocs: boolean;
    // ADR-0017 — `failed` is a terminal customer-facing outcome surfaced
    // when the issued-pack worker has permanently failed (audit row
    // newer than any GENERATED `ISSUED_POLICY_PACK` document). The
    // wizard reads this to stop polling and render an operator-contact
    // surface instead of silently reverting to the payment step.
    customerOutcome?: 'issued' | 'pending' | 'failed';
    missingFields: Array<{ slug: string; label: string; customerHash?: string; boTab?: string }>;
    conditionalRequirements: Array<{
        code: 'ADDITIONAL_DRIVERS_REQUIRED' | 'ADDITIONAL_DRIVER_FIELDS_REQUIRED';
        message: string;
        severity?: IssueBlockerSeverity;
        details?: Record<string, unknown>;
    }>;
    blockers: IssueBlocker[];
    blockerGroups?: Array<{ group: IssueBlockerGroup; blockers: IssueBlocker[] }>;
    diagnostics?: {
        validation: Array<{
            productType?: string;
            field: string;
            validator: string;
            readPath: string;
            actualValuePresent?: boolean;
            blocking: boolean;
            message?: string;
        }>;
    };
    uwState: UwWorkflowState;
    uwStateMeta: {
        questionnaireSentAt?: string;
        customerStartedAt?: string;
        uwStartedAt?: string;
        followUpsSentAt?: string;
        hasOpenFollowUps: boolean;
        openFollowUpsCount: number;
        lastSavedBy?: 'customer' | 'underwriter' | 'system';
        lastSavedByName?: string;
        lastSavedAt?: string;
        isQuoteReady: boolean;
        lastModifiedBy?: string;
    };
    derived: {
        hasQuoteData: boolean;
        hasQuoteResponse: boolean;
        hasPaymentConfirmed: boolean;
        hasBoundInceptionTransaction: boolean;
        hasIssuedPackDocuments: boolean;
        hasWelcomeEmailSent: boolean;
        isLocked: boolean;
        hasUwCompleted: boolean;
        pricingHashMatches: boolean;
        missingForQuotePack: Array<{ slug: string; label: string; customerHash?: string; boTab?: string }>;
        missingForIssuedPack: Array<{ slug: string; label: string; customerHash?: string; boTab?: string }>;
        missingIssuedDocumentTypes: string[];
    };
};
