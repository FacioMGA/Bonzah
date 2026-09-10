/**
 * Dashboard Contract Types — CHAMPS Contract Layer
 *
 * Strict boundary between raw API payloads (DTO) and
 * normalized view models (VM) consumed by controller + views.
 *
 * Rules:
 *   - DTO types mirror the API shape (nullable, loose)
 *   - VM types are fully normalized (required, typed, safe defaults)
 *   - Only the mapper bridges DTO → VM
 */

// ─── DTO types (raw API payloads) ───

/** Raw policy record from /api/policies list endpoint */
export type PolicyDTO = {
    id?: string;
    policyId?: string;
    startDate?: string;
    effectiveDate?: string;
    periodStart?: string;
    status?: string;
    bo_status?: string | null;
    paymentStatus?: string | null;
    outstandingBalance?: number;
    productType?: string;
    currency?: string;
    start?: string;
    end?: string;
    inceptionDate?: string;
    endDate?: string;
    expiryDate?: string;
    createdAt?: string;
    updatedAt?: string;
    quoteData?: Record<string, unknown>;
    vehicleInfo?: Record<string, unknown>;
    quoteResponse?: Record<string, unknown>;
    stateSnapshot?: Record<string, unknown>;
    totalPremium?: number;
    premium?: number;
    issuedAt?: string;
    policyNumber?: string;
    policyHolder?: Record<string, unknown>;
    policyHolderId?: Record<string, unknown>;
    insuredName?: string;
    name?: string;
    cancelledAt?: string;
    canceledAt?: string;
    cancellationDate?: string;
};

/** Raw claim record from /api/claims list endpoint */
export type ClaimDTO = {
    id?: string;
    status?: string;
    reportedDate?: string;
    createdAt?: string;
    claimNumber?: string;
    claimType?: string;
    policyId?: string;
    infoRequests?: Array<{ id?: string; status?: string }>;
    data?: Record<string, unknown>;
};

/** Raw document from /api/policies/:id/documents endpoint */
export type DocumentDTO = {
    id?: string;
    type?: string;
    filename?: string;
    publicUrl?: string;
    storageUri?: string;
    createdAt?: string;
};

/** Raw feed event from /api/policies/:id/feed endpoint */
export type FeedEventDTO = {
    id?: string;
    actionName?: string;
    occurredAt?: string;
    actorName?: string | null;
    diff?: Record<string, unknown> | null;
};

/** Raw bootstrap response combining policies + claims */
export type DashboardBootstrapDTO = {
    policies: PolicyDTO[];
    claims: ClaimDTO[];
};

// ─── VM types (normalized, safe) ───

export type StatusTone = 'issued' | 'active' | 'expired' | 'canceled';

export type PolicyStatusVM = {
    title: string;
    detail: string;
    canAddDriver: boolean;
    tone: StatusTone;
};

export type DriverVM = {
    fullName: string;
    dob: string;
    licenseYears: string;
    isPrimary: boolean;
};

export type ExcessVM = {
    total: number;
    compulsory: number;
    voluntary: number;
};

export type PremiumRowVM = {
    label: string;
    amount: number;
};

export type CoverageExcessRowVM = {
    coverage: string;
    amount: number;
};

export type DocumentVM = {
    id: string;
    type: string;
    typeLabel: string;
    filename: string;
    href: string;
    createdAt: string;
};

export type ActivityItemVM = {
    id: string;
    title: string;
    detail: string;
    occurredAt: string;
};

export type ClaimVM = {
    id: string;
    status: string;
    claimNumber: string;
    policyId: string;
    reportedDate: string;
    hasClaimForm: boolean;
};

/** Fully normalized policy view model for the dashboard */
export type DashboardPolicyVM = {
    key: string;
    productType: string;
    productLabel: string;
    vehicleTitle: string;
    registration: string;
    policyNumber: string;
    coverType: string;
    coverageItems: string[];
    endorsementItems: string[];
    statusMeta: PolicyStatusVM;
    startDate: string;
    endDate: string;
    isPast: boolean;
    currency: CurrencyCode;
    drivers: DriverVM[];
    excess: ExcessVM;
    coverageExcessRows: CoverageExcessRowVM[];
    additionalExcessRows: PremiumRowVM[];
    ncb: { years: number; isProtected: boolean };
    premium: number;
    premiumRows: PremiumRowVM[];
    declaredValue: number;
    mileage: string;
    vehicleUse: string;
    parking: string;
    country: string;
    licenseType: string;
    licenseYears: number;
    paymentMethodLabel: string;
    paymentStatus: string;
    outstandingBalance: number;
};

export type DashboardVM = {
    policies: DashboardPolicyVM[];
    claims: ClaimVM[];
};

/** Re-export for convenience */
export type CurrencyCode = 'EUR' | 'USD' | 'GBP';
