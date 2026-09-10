export type SegmentKey = string;
export type BundleId = string;

// Model Artifact Format (JSON storage)
export interface FrequencyTable {
    [segmentKey: string]: {
        total: number;
        counts: Record<BundleId, number>; // bundleId -> count
        // Raw MLE probabilities: counts / total (no rounding)
        probs: Record<BundleId, number>;
        /**
         * Smoothed posterior mean probabilities (Dirichlet, global prior).\n+         * Present for schemaVersion >= 2.\n+         */
        smoothed_probs?: Record<BundleId, number>;
        /**
         * Smoothing metadata to support audit/confidence.\n+         */
        smoothing?: {
            method: 'dirichlet';
            tau: number;
            concentration: number; // C
        };
    };
}

export interface ModelArtifact {
    metadata: {
        schemaVersion?: number; // v2 adds smoothing + removes rounding
        version: string;
        generatedAt: string;
        rowCount: number;
        sourceHash: string;
    };
    tables: {
        S0: FrequencyTable;
        S1: FrequencyTable;
        S2: FrequencyTable;
        S3: FrequencyTable;
        S4: FrequencyTable; // Global fallback
    };
}

// Normalized input features for inference
export interface InferenceFeatures {
    ageBand: string;
    coverType: string;
    valueBand: string;
    ncbBand: string;
    driversClass: string;
    useClass: string;
}

// Inference Output Contract (used by `InferenceService`; engine/provider has its own richer surface)
export interface RecommendationResult {
    artifactVersion?: string;
    segmentUsed: {
        schemaLevel: string; // S0...S4
        key: string;
    };
    segmentSampleSize: number;
    recommendations: Array<{
        bundleId: BundleId;
        probability: number;
        confidence?: number;
        reason?: string;
    }>;
}
