import type { InferenceFeatures } from './types.js';
import { Normalizer } from './normalization.js';

export type RecsFeatureV1 = InferenceFeatures & {
  // Minimal extra context (non-PII) for logging/debug.
  vehicleValue?: number | null;
  ncbYears?: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function safeNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function extractAutoRecsFeatures(quoteData: unknown): RecsFeatureV1 {
  const qd = asRecord(quoteData);
  const proposer = asRecord(qd.proposer);
  const dobRaw = proposer.dateOfBirth;
  const inceptionRaw = qd.renewalDate || qd.startDate || new Date();

  // Age in years at inception-ish (same spirit as training).
  let age: number | null = null;
  try {
    const dob = dobRaw ? new Date(String(dobRaw)) : null;
    const inc = inceptionRaw ? new Date(String(inceptionRaw)) : new Date();
    if (dob && !Number.isNaN(dob.getTime()) && inc && !Number.isNaN(inc.getTime())) {
      age = Math.floor((inc.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000));
    }
  } catch {
    age = null;
  }

  const vehicleValue = safeNum(qd.vehicleValue);
  const ncbYears = safeNum(qd.ncb);

  const coverType = Normalizer.normalizeCoverType(String(qd.coverRequired || ''));
  const driversClass = qd.hasAdditionalDrivers ? 'multi' : 'single';
  const useClass = String(qd.vehicleUse || 'unknown').trim() || 'unknown';

  return {
    ageBand: Normalizer.getAgeBand(age),
    coverType,
    valueBand: Normalizer.getValueBand(vehicleValue),
    ncbBand: Normalizer.getNcbBand(ncbYears),
    driversClass,
    useClass,
    vehicleValue,
    ncbYears,
  };
}

