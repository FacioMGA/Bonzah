export type ProgramStatus = 'DRAFT' | 'ACTIVE' | 'PUBLISHED' | 'ARCHIVED';
export type PricingModel = 'Fixed premium' | 'Hybrid';
export type Cadence = 'Monthly' | 'Annual (paid upfront)';
export type Currency = 'EUR' | 'USD' | 'GBP';

export type ProgramVersion = {
    version: string;
    status: ProgramStatus;
    effectiveFrom: string;
    effectiveTo?: string;
    changeReason: string;
    updatedAt: string;
};

// --- Rating Config ---
export type RatingMatrix = {
    source?: string;
    sheet?: string;
    baseMatrix: {
        xKey?: string;
        yKey?: string;
        x?: number[];
        y?: string[];
        vehicleValueBands?: number[];
        engineSizeBands?: string[];
        basePolicyExcessEngineSizeBands?: string[];
        basePolicyExcessByEngineBand?: number[];
        values: number[][];
        note?: string;
    };
    factors: Record<string, Array<{ label: string; factor: number }>>;
    lloyds?: {
        standardsRef: 'CRS_V5_2';
        sourceDocUrl?: string;
        mappings: Array<{
            crCode: string;
            title: string;
            pvrKey: string;
            transform?: string;
            notes?: string;
            required?: boolean;
        }>;
    };
};

export type PricingStage = {
    id: string;
    /** Product-owned executable operator; the server validates the complete sequence on publish. */
    operator: string;
    /** Presentation metadata is optional because executable stages persist only their stable operator IDs. */
    name?: string;
    kind?: 'table_lookup' | 'factor' | 'fee' | 'custom';
    tableKey?: string;
    notes?: string;
};

export type PersistedRatingModel = {
    id: string;
    programId: string;
    version: number;
    status: string;
    source?: string | null;
    name?: string | null;
    notes?: string | null;
    stages: PricingStage[];
    tables: RatingMatrix;
    createdAt: string;
    updatedAt: string;
};

// --- Main Program Type ---
export type Program = {
    id: string;
    name: string;
    binder: string;
    status: ProgramStatus;
    productType?: string;

    pricingModel: PricingModel;
    cadence: Cadence;
    currency: Currency;
    activeAccounts: number;
    lastInvoiceRun: string;
    versions: ProgramVersion[];

    pricing: {
        rate: number;
        notes: string;
    };

    validation: {
        exceptionQueue: 'Auto-create exceptions' | 'Block until fixed';
    };

    endorsements: {
        requireReason: boolean;
        requireEffectiveDate: boolean;
        types: string[];
    };

    metadata?: Record<string, unknown>;
};
