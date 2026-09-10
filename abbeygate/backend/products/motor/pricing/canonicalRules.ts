import type { QuoteData } from '../../../platform/types/autoInsurance.js';
import { motorcycleCompExcessFromWorkbook } from './factors/abbeygateFactors.js';

type ClassicPricingModule = typeof import('./classicPricing.js');
const classicPricingModule: ClassicPricingModule = await import('./classicPricing.js');

export function roundUpToNearest50(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / 50) * 50;
}

/**
 * Floor for the auto-computed private-car minimum policy excess.
 *
 * Per the Abbeygate motor rating sheet (Peter Sheppard, 2026-05-15) the
 * scheme uses a flat €200 floor regardless of engine size. The old
 * cc-band table (€250 / €300 / €400 / €500) is no longer part of the
 * scheme but kept exported for any caller that needs the historical
 * lookup; new callers should not reach for it.
 */
export function ccBandMinimumExcess(_engineCc: number): number {
  return 200;
}

/** Flat floor for the auto-computed private-car minimum policy excess (scheme). */
export const PRIVATE_CAR_EXCESS_FLOOR_EUR = 200;
/** Cabriolet/Convertible additional policy excess for roof claims (scheme). */
export const CABRIO_ADDITIONAL_EXCESS_EUR = 500;

export function isThirdPartyOnly(coverRequired: unknown): boolean {
  return String(coverRequired || '').trim().toLowerCase() === 'third party liability';
}

export function isMotorcaravanRisk(vehicleType: unknown): boolean {
  const normalized = String(vehicleType || '').toLowerCase();
  return normalized.includes('motorcaravan') || normalized.includes('motorhome') || normalized.includes('caravan');
}

export function isClassicRisk(vehicleType: unknown): boolean {
  return String(vehicleType || '').toLowerCase().includes('classic');
}

export function isMotorbikeRisk(vehicleType: unknown): boolean {
  const normalized = String(vehicleType || '').toLowerCase();
  return normalized.includes('motorbike') || normalized.includes('motorcycle');
}

/**
 * True when the risk is a cabriolet/convertible per `cabrio` flag.
 * Accepts the canonical `'Yes' | 'No'` string and boolean variants.
 * Per the Abbeygate motor rating sheet, cabriolet risks are rated one
 * engine band higher in the comp base matrix and carry an additional
 * €500 policy excess for roof claims.
 */
export function isCabrioRisk(quoteData: { cabrio?: unknown }): boolean {
  const raw = quoteData?.cabrio;
  if (typeof raw === 'boolean') return raw;
  const normalized = String(raw ?? '').trim().toLowerCase();
  return normalized === 'yes' || normalized === 'true' || normalized === '1';
}

/**
 * Auto-computed minimum policy excess for private cars (Comp).
 *
 * Per the Abbeygate motor rating sheet (Peter Sheppard, 2026-05-15):
 * `max(1.5% × declared value, €200)`, rounded UP to the next €50.
 *
 * The `engineCc` parameter is retained for callers passing it in but is
 * no longer used — the scheme uses a flat €200 floor across all engine
 * sizes. Cabriolet/convertible risks add a further €500 elsewhere in the
 * pipeline (see `CABRIO_ADDITIONAL_EXCESS_EUR`).
 */
export function computeDeclaredValueBasedExcess(declaredValue: number, _engineCc: number): number {
  const valuePct = Number(declaredValue) * 0.015;
  return roundUpToNearest50(Math.max(valuePct, PRIVATE_CAR_EXCESS_FLOOR_EUR));
}

export function computeClassicExcess(declaredValue: number): number {
  return roundUpToNearest50(Number(declaredValue || 0) * 0.015);
}

export function computeMotorcaravanExcess(declaredValue: number): number {
  const value = Number(declaredValue || 0);
  if (!Number.isFinite(value) || value <= 0) return 400;
  if (value <= 30_000) return 400;
  if (value <= 80_000) return 1_000;
  return 1_000;
}

export function computeCalculatedPolicyExcess(quoteData: QuoteData): number {
  const declaredValue = Number(quoteData.vehicleValue || 0);
  const engineCc = Number(quoteData.engineSize || 0);
  const vehicleType = String(quoteData.vehicleType || '');
  if (isThirdPartyOnly(quoteData.coverRequired)) return 0;
  if (isClassicRisk(vehicleType)) {
    const age = (() => {
      const dob = new Date(String(quoteData.proposer?.dateOfBirth || ''));
      if (Number.isNaN(dob.getTime())) return 30;
      const now = new Date();
      let years = now.getFullYear() - dob.getFullYear();
      const monthDelta = now.getMonth() - dob.getMonth();
      if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) years -= 1;
      return years;
    })();
    const annualKms = Number(String(quoteData.kmsPerYear || '0').replace(/[^0-9]/g, '')) || 0;
    const matrixExcess = classicPricingModule.resolveClassicPricingContext({ quoteData, age, annualKms }).policyExcess;
    const pctExcess = computeClassicExcess(declaredValue);
    return Math.max(matrixExcess, pctExcess);
  }
  if (isMotorcaravanRisk(vehicleType)) return computeMotorcaravanExcess(declaredValue);
  // ABY-325 — motorbikes carry a cc-banded comp excess from the rating
  // workbook, the same value the rater applies (autoInsuranceCalculator
  // `baseExcess`). Without this branch the displayed/default excess fell
  // through to the private-car declared-value formula and diverged from
  // what the customer was actually rated on.
  if (isMotorbikeRisk(vehicleType)) return motorcycleCompExcessFromWorkbook(engineCc);
  const baseline = computeDeclaredValueBasedExcess(declaredValue, engineCc);
  // Cabriolet/convertible: scheme adds €500 additional policy excess
  // ("for the roof") on top of the auto-computed minimum.
  return isCabrioRisk(quoteData) ? baseline + CABRIO_ADDITIONAL_EXCESS_EUR : baseline;
}

export function buildHigherDeductibleOptions(minimumExcess: number, maxOption = 1000): number[] {
  const start = roundUpToNearest50(minimumExcess);
  const options: number[] = [];
  for (let value = start + 50; value <= maxOption; value += 50) {
    options.push(value);
  }
  return options;
}
