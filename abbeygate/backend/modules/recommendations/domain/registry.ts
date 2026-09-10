import type { RecommendationCatalog } from './catalog/catalog.js';
import { abbeygateAutoCatalogV1 } from './catalog/abbeygate/auto.js';
import type { ModelProvider } from './providers/modelProvider.js';
import { FrequencyArtifactProvider } from './providers/frequencyArtifactProvider.js';
import { RemoteModelProvider } from './providers/remoteModelProvider.js';

const CATALOGS_BY_PRODUCT: Record<string, RecommendationCatalog> = {
  MOTOR: abbeygateAutoCatalogV1,
};

export function getCatalog(args: { tenantId: string; productType: string }): RecommendationCatalog | null {
  const key = String(args.productType || '').toUpperCase();
  return CATALOGS_BY_PRODUCT[key] ?? null;
}

export function getModelProvider(): ModelProvider {
  const provider = String(process.env.RECS_PROVIDER || 'frequency').trim().toLowerCase();
  if (provider === 'remote') return new RemoteModelProvider();
  return new FrequencyArtifactProvider();
}
