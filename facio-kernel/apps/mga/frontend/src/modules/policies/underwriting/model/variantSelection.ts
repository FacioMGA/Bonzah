import type { VehicleEnrichmentResult } from '@/src/products/motor/public';
import { normalizeVehicleEnrichmentQuoteData } from '@/src/products/motor/public';
import { asRecord } from '@/src/shared/lib/record';

export function readSelectedVariantId(source: Record<string, unknown>): string {
  const rootMeta = asRecord(source.__meta);
  const vehicleMeta = asRecord(rootMeta.vehicleEnrichment);
  return String(vehicleMeta.selectedVariantId || '').trim();
}

export function persistSelectedVariantIdInQuoteData(source: Record<string, unknown>, variantId: string): Record<string, unknown> {
  const rootMeta = asRecord(source.__meta);
  const vehicleMeta = asRecord(rootMeta.vehicleEnrichment);
  const nextVehicleMeta: Record<string, unknown> = { ...vehicleMeta };
  const trimmed = String(variantId || '').trim();
  if (trimmed) nextVehicleMeta.selectedVariantId = trimmed;
  else delete nextVehicleMeta.selectedVariantId;
  return {
    ...source,
    __meta: {
      ...rootMeta,
      vehicleEnrichment: nextVehicleMeta,
    },
  };
}

export function applyVariantEnrichmentToQuoteData(args: {
  source: Record<string, unknown>;
  variantId: string;
  enrichment: VehicleEnrichmentResult;
}): Record<string, unknown> {
  const updates = normalizeVehicleEnrichmentQuoteData(args.enrichment);
  return persistSelectedVariantIdInQuoteData({ ...args.source, ...updates }, args.variantId);
}
