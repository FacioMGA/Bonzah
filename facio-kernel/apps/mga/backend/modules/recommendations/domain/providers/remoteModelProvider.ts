import type { BundleId, InferenceFeatures } from '../types.js';
import type { ModelProvider } from './modelProvider.js';

type RemoteScore = { bundleId?: string; probability?: number };
type RemoteInferResponse = {
  artifactVersion?: string;
  segmentUsed?: { schemaLevel?: string; key?: string };
  segmentSampleSize?: number;
  scores?: RemoteScore[];
};

export class RemoteModelProvider implements ModelProvider {
  public key = 'remote:v1';

  async infer(args: {
    features: InferenceFeatures;
    candidateBundleIds: BundleId[];
    context: { tenantId: string; productType: string; modelKey: string };
  }) {
    const baseUrl = String(process.env.RECS_REMOTE_URL || '').trim();
    if (!baseUrl) {
      return {
        artifactVersion: 'remote:not_configured',
        segmentUsed: { schemaLevel: 'S4', key: 'remote' },
        segmentSampleSize: 0,
        scores: (args.candidateBundleIds || []).map((b) => ({ bundleId: b, probability: 0 })),
      };
    }

    // Contract: remote model returns probability per bundleId for the provided candidates.
    const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/infer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        features: args.features,
        candidates: args.candidateBundleIds,
        context: args.context,
      }),
    });
    if (!resp.ok) {
      return {
        artifactVersion: `remote:error:${resp.status}`,
        segmentUsed: { schemaLevel: 'S4', key: 'remote' },
        segmentSampleSize: 0,
        scores: (args.candidateBundleIds || []).map((b) => ({ bundleId: b, probability: 0 })),
      };
    }
    const json = (await resp.json()) as RemoteInferResponse;
    const scoresRaw = Array.isArray(json?.scores) ? json.scores : [];
    const byId = new Map<string, RemoteScore>(scoresRaw.map((s) => [String(s?.bundleId || ''), s]));

    return {
      artifactVersion: String(json?.artifactVersion || 'remote'),
      segmentUsed: {
        schemaLevel: String(json?.segmentUsed?.schemaLevel || 'S4'),
        key: String(json?.segmentUsed?.key || 'remote'),
      },
      segmentSampleSize: Number(json?.segmentSampleSize || 0) || 0,
      scores: (args.candidateBundleIds || []).map((b) => {
        const s = byId.get(String(b));
        return { bundleId: b, probability: Number(s?.probability ?? 0) || 0 };
      }),
    };
  }
}

