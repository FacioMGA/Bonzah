import fs from 'fs';
import type { BundleId, ModelArtifact, InferenceFeatures } from '../types.js';
import type { ModelProvider } from './modelProvider.js';

const MIN_SEGMENT_SIZE = 10;

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function loadArtifactFromEnv(): ModelArtifact | null {
  const p = String(process.env.RECS_ARTIFACT_PATH || '').trim();
  if (!p) return null;
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8');
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  return parsed as ModelArtifact;
}

function pickMatch(artifact: ModelArtifact, features: InferenceFeatures) {
  const { ageBand, coverType, valueBand, ncbBand, driversClass, useClass } = features;

  const k0 = JSON.stringify([ageBand, coverType, valueBand, ncbBand, driversClass, useClass]);
  let match = artifact.tables.S0[k0];
  let level = 'S0';
  let usedKey = k0;

  if (!match || match.total < MIN_SEGMENT_SIZE) {
    const k1 = JSON.stringify([ageBand, coverType, valueBand, ncbBand, useClass]);
    match = artifact.tables.S1[k1];
    level = 'S1';
    usedKey = k1;
  }
  if (!match || match.total < MIN_SEGMENT_SIZE) {
    const k2 = JSON.stringify([ageBand, coverType, valueBand, ncbBand]);
    match = artifact.tables.S2[k2];
    level = 'S2';
    usedKey = k2;
  }
  if (!match || match.total < MIN_SEGMENT_SIZE) {
    const k3 = JSON.stringify([ageBand, coverType, ncbBand]);
    match = artifact.tables.S3[k3];
    level = 'S3';
    usedKey = k3;
  }
  if (!match || match.total < MIN_SEGMENT_SIZE) {
    match = artifact.tables.S4['global'];
    level = 'S4';
    usedKey = 'global';
  }

  return { match, level, usedKey };
}

export class FrequencyArtifactProvider implements ModelProvider {
  public key = 'frequency:v1';
  private artifact: ModelArtifact | null;

  constructor(artifact?: ModelArtifact | null) {
    this.artifact = artifact ?? loadArtifactFromEnv();
  }

  async infer(args: {
    features: InferenceFeatures;
    candidateBundleIds: BundleId[];
    context: { tenantId: string; productType: string; modelKey: string };
  }) {
    const artifact = this.artifact;
    if (!artifact) {
      return {
        artifactVersion: 'missing',
        segmentUsed: { schemaLevel: 'S4', key: 'global' },
        segmentSampleSize: 0,
        scores: (args.candidateBundleIds || []).map((b) => ({ bundleId: b, probability: 0 })),
      };
    }

    const picked = pickMatch(artifact, args.features);
    const probs = (picked.match && picked.match.smoothed_probs) ? picked.match.smoothed_probs : picked.match.probs;
    const sampleSize = picked.match?.total || 0;
    const counts = picked.match?.counts || {};
    const total = Number(picked.match?.total || 0) || 0;
    const C = Number(picked.match?.smoothing?.concentration ?? 0) || 0;
    const denom = total + C;

    const global = artifact.tables.S4['global'];
    const globalProbs = (global && global.smoothed_probs) ? global.smoothed_probs : global?.probs || {};

    const confidenceFor = (bundleId: string) => {
      if (denom <= 0) return 0;
      const prior = Number(globalProbs?.[bundleId] ?? 0) || 0;
      const count = Number(counts?.[bundleId] ?? 0) || 0;
      const alpha_i = count + prior * C;
      const alpha_sum = denom;
      const varP = (alpha_i * (alpha_sum - alpha_i)) / (alpha_sum * alpha_sum * (alpha_sum + 1));
      const std = Math.sqrt(Math.max(0, varP));
      const conf = 1 - Math.min(1, std * 8);
      return Math.max(0, Math.min(1, conf));
    };

    const reasonFor = (bundleId: string) => {
      const p = Number(probs?.[bundleId] ?? 0) || 0;
      const g = Number(globalProbs?.[bundleId] ?? 0) || 0;
      const lift = g > 1e-9 ? p / g : 0;
      if (!Number.isFinite(lift) || lift <= 0) return '';
      const liftText = `${Math.round(lift * 10) / 10}×`;
      return `Lift ${liftText} vs global`;
    };

    const scores = (args.candidateBundleIds || []).map((b) => ({
      bundleId: b,
      probability: Number(probs?.[b] ?? 0) || 0,
      confidence: confidenceFor(String(b)),
      reason: reasonFor(String(b)),
    }));

    return {
      artifactVersion: String(artifact?.metadata?.version || 'unknown'),
      segmentUsed: { schemaLevel: picked.level, key: picked.usedKey },
      segmentSampleSize: sampleSize,
      scores,
    };
  }
}

