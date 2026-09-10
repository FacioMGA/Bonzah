export type ProgramStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
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

// --- MBE Config ---
export type ProgramMbeProductConfig = {
    schemaVersion: 1;
    programCode: string;
    base: Array<{ code: string; enabled: boolean; params?: Record<string, unknown> }>;
    options: Array<{ code: string; enabledByDefault: boolean; params?: Record<string, unknown> }>;
};

// --- UW Config ---
/**
 * Generic program UW config. The shape is product-specific and validated against
 * the product manifest's `uwConfigSchema`. The shared editor reads the schema
 * from the manifest and renders a form dynamically.
 *
 * New BO code should use this type. Motor-shaped legacy code can keep using
 * `MotorUwConfig` until it's migrated to the schema-driven form.
 */
export type ProgramUwConfig = Record<string, unknown>;

// --- Rating Config ---
export type RatingMatrix = {
    source: string;
    sheet: string;
    baseMatrix: { xKey: string; yKey: string; x: number[]; y: string[]; values: number[][]; note: string };
    factors: {
        driverBasis: Array<{ label: string; factor: number }>;
        proposerAge: Array<{ label: string; factor: number }>;
        vehicleAge: Array<{ label: string; factor: number }>;
        licencePeriod: Array<{ label: string; factor: number }>;
        addedDriversUnder25: Array<{ label: string; factor: number }>;
    };
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
    name: string;
    kind: 'table_lookup' | 'factor' | 'fee' | 'custom';
    tableKey?: keyof RatingMatrix['factors'] | 'baseMatrix';
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
