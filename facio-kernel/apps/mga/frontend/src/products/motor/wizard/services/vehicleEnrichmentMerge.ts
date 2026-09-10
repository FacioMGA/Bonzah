import type {
  VehicleEnrichmentFieldKey,
  VehicleEnrichmentResult,
} from '@facio/products';
import { enrichmentToQuoteDataUpdates, normalizeEnrichmentTargetValue } from '@facio/products';
import type { QuoteData } from '../types';

type QuoteFieldMeta = {
  source?: 'user' | 'cardog' | 'vin' | 'system';
  confidence?: number;
  wasUserEdited?: boolean;
  enrichedAt?: string;
};

type VehicleEnrichmentMeta = Record<string, QuoteFieldMeta>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isBlank(value: unknown): boolean {
  if (value === null || typeof value === 'undefined') return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

export function normalizeVehicleEnrichmentQuoteData(
  enrichment: VehicleEnrichmentResult,
): Partial<QuoteData> {
  return enrichmentToQuoteDataUpdates(enrichment) as Partial<QuoteData>;
}

function getFieldValue(quoteData: QuoteData, field: VehicleEnrichmentFieldKey): unknown {
  switch (field) {
    case 'registrationNumber': return quoteData.registrationNumber;
    case 'make': return quoteData.make;
    case 'model': return quoteData.model;
    case 'year': return quoteData.year;
    case 'fuelType': return quoteData.fuelType;
    case 'engineSize': return quoteData.engineSize;
    case 'numberOfSeats': return quoteData.numberOfSeats;
    case 'vehicleType': return quoteData.vehicleType;
    case 'countryOfRegistration': return quoteData.countryOfRegistration;
    case 'vehicleValue': return quoteData.vehicleValue;
    case 'cabrio': return quoteData.cabrio;
  }
}

function setFieldValue(quoteData: QuoteData, field: VehicleEnrichmentFieldKey, value: QuoteData[keyof QuoteData]): QuoteData {
  switch (field) {
    case 'registrationNumber': return { ...quoteData, registrationNumber: String(value || '') };
    case 'make': return { ...quoteData, make: String(value || '') };
    case 'model': return { ...quoteData, model: String(value || '') };
    case 'year': return { ...quoteData, year: Number(value || 0) };
    case 'fuelType': return { ...quoteData, fuelType: String(value || '') };
    case 'engineSize': return { ...quoteData, engineSize: Number(value || 0) };
    case 'numberOfSeats': return { ...quoteData, numberOfSeats: Number(value || 0) };
    case 'vehicleType': return { ...quoteData, vehicleType: String(value || '') };
    case 'countryOfRegistration': return { ...quoteData, countryOfRegistration: String(value || '') };
    case 'vehicleValue': return { ...quoteData, vehicleValue: Number(value || 0) };
    case 'cabrio': return { ...quoteData, cabrio: String(value || '') };
  }
}

function getVehicleEnrichmentMeta(quoteData: QuoteData): VehicleEnrichmentMeta {
  const rootMeta = asRecord(quoteData.__meta);
  const vehicleMeta = asRecord(rootMeta.vehicleEnrichment);
  return vehicleMeta as VehicleEnrichmentMeta;
}

export function markVehicleFieldAsUserEdited(quoteData: QuoteData, field: VehicleEnrichmentFieldKey): QuoteData {
  const rootMeta = asRecord(quoteData.__meta);
  const vehicleMeta = getVehicleEnrichmentMeta(quoteData);
  const previous = asRecord(vehicleMeta[field]);
  const nextVehicleMeta: VehicleEnrichmentMeta = {
    ...vehicleMeta,
    [field]: {
      ...previous,
      source: 'user',
      confidence: 1,
      wasUserEdited: true,
      enrichedAt: previous.enrichedAt ? String(previous.enrichedAt) : undefined,
    },
  };

  return {
    ...quoteData,
    __meta: {
      ...rootMeta,
      vehicleEnrichment: nextVehicleMeta,
    },
  };
}

export function applyVehicleEnrichment(args: {
  quoteData: QuoteData;
  enrichment: VehicleEnrichmentResult;
  source?: 'cardog' | 'vin';
  onConflict: (fields: VehicleEnrichmentFieldKey[]) => 'use_suggested' | 'keep_mine';
}): { nextQuoteData: QuoteData; appliedFields: VehicleEnrichmentFieldKey[]; conflictFields: VehicleEnrichmentFieldKey[] } {
  const { quoteData, enrichment, onConflict, source = 'cardog' } = args;
  const rootMeta = asRecord(quoteData.__meta);
  const vehicleMeta = getVehicleEnrichmentMeta(quoteData);
  const normalized = asRecord(enrichment.normalizedQuoteData);

  const applied: VehicleEnrichmentFieldKey[] = [];
  const conflicts: VehicleEnrichmentFieldKey[] = [];
  let staged: QuoteData = { ...quoteData };
  const nextVehicleMeta: VehicleEnrichmentMeta = { ...vehicleMeta };

  const fields = Object.keys(normalized) as VehicleEnrichmentFieldKey[];
  for (const field of fields) {
    const incoming = normalizeEnrichmentTargetValue(field, normalized[field]);
    if (typeof incoming === 'undefined') continue;
    const current = getFieldValue(staged, field);
    const sameValue = String(current ?? '') === String(incoming ?? '');

    // ABY-103 — for explicit trim picks (`source === 'cardog'`) the
    // user's gesture IS "refresh the spec fields from this trim", even
    // when the new values happen to equal what was already there.
    // Treating sameValue as a no-op silently suppressed the green-pulse
    // on re-pick and reset of a manually-edited fuel/cabrio/seats —
    // exactly the report ("Selecting trim should re-trigger fuel type,
    // cabrio, and no. of seats"). Re-apply unconditionally for cardog
    // and let the meta `wasUserEdited` flag clear so the next merge
    // is no longer a "conflict". For VIN background lookups
    // (`source === 'vin'`) the silent same-value skip stays — that
    // path is automatic and shouldn't pulse on every keystroke.
    if (sameValue && source !== 'cardog') continue;

    const fieldMeta = asRecord(nextVehicleMeta[field]);
    const userEdited = fieldMeta.wasUserEdited === true || fieldMeta.source === 'user';
    if (!sameValue && !isBlank(current) && userEdited) {
      conflicts.push(field);
      continue;
    }
    staged = setFieldValue(staged, field, incoming as QuoteData[keyof QuoteData]);
    applied.push(field);
    nextVehicleMeta[field] = {
      source,
      confidence: Number(enrichment.fieldConfidence?.[field] || 0),
      wasUserEdited: false,
      enrichedAt: new Date().toISOString(),
    };
  }

  if (conflicts.length > 0) {
    const resolution = onConflict(conflicts);
    if (resolution === 'use_suggested') {
      for (const field of conflicts) {
        const incoming = normalizeEnrichmentTargetValue(field, normalized[field]);
        if (typeof incoming === 'undefined') continue;
        staged = setFieldValue(staged, field, incoming as QuoteData[keyof QuoteData]);
        applied.push(field);
        nextVehicleMeta[field] = {
          source,
          confidence: Number(enrichment.fieldConfidence?.[field] || 0),
          wasUserEdited: false,
          enrichedAt: new Date().toISOString(),
        };
      }
    }
  }

  const nextQuoteData: QuoteData = {
    ...staged,
    __meta: {
      ...rootMeta,
      vehicleEnrichment: nextVehicleMeta,
    },
  };

  return {
    nextQuoteData,
    appliedFields: Array.from(new Set(applied)),
    conflictFields: conflicts,
  };
}
