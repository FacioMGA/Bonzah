import type { BundleId, InferenceFeatures } from '../types.js';

export type ScoredCandidate = {
  bundleId: BundleId;
  probability: number;
  rawProbability?: number;
  confidence?: number;
  reason?: string;
};

export type ModelInferContext = {
  tenantId: string;
  productType: string;
  modelKey: string;
};

export interface ModelProvider {
  key: string; // e.g. "frequency:v1", "remote:v1"

  infer(args: {
    features: InferenceFeatures;
    candidateBundleIds: BundleId[];
    context: ModelInferContext;
  }): Promise<{
    artifactVersion: string;
    segmentUsed: { schemaLevel: string; key: string };
    segmentSampleSize: number;
    scores: ScoredCandidate[];
  }>;
}

