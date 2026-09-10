
export interface DocumentSetFiles {
    schedule: DocumentFileMetadata;
    endorsements?: DocumentFileMetadata;
    certificate?: DocumentFileMetadata;
    greenCard?: DocumentFileMetadata;
    // Others...
}

export interface DocumentFileMetadata {
    name: string;
    storageKey: string;
    sha256: string;
    pages: number;
    sizeBytes: number;
    contentType: string;
    createdAt: string;
}

export interface ScheduleData {
    policyNumber: string;
    transactionId: string;
    // ... many fields
    policyHolder: Record<string, unknown>;
    coverages: kCoverage[];
    endorsements: kEndorsement[];
    conditions: kCondition[];
    premium: kPremiumSummary;
    sectionsInForce: string[];
}

export interface kCoverage {
    code: string;
    name: string;
    limit: string | number;
    deductible: string | number;
    section: string;
    targetId?: string;
}

export interface kEndorsement {
    code: string;
    title: string;
    status: string;
    params: Record<string, unknown>;
    documentRef?: string; // e.g. "endorsements.pdf#p3"
    legalText?: string;
}

export interface kCondition {
    code: string;
    title: string;
    text: string;
    source: string;
    breachImpact?: string;
}

export interface kPremiumSummary {
    total: number;
    currency: string;
    payment_breakdown: Array<{ item: string; amount: number; basis?: string }>;
}
