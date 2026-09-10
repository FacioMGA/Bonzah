import type { QuoteData } from '../../../platform/types/autoInsurance.js';
import { parseEngineBand } from './factors/abbeygateFactors.js';
import type { AbbeygateAutoCyprus2022Matrix } from './data/abbeygate-auto-cyprus-2022.schema.js';
import { ClassicCarRatesSchema, type ClassicCarRates } from './data/classic-car-rates.schema.js';

type ClassicPricingModule = typeof import('./classicPricing.js');
const classicPricingModule: ClassicPricingModule = await import('./classicPricing.js');

export function requireClassicRates(matrix: AbbeygateAutoCyprus2022Matrix): ClassicCarRates {
  const candidate: unknown = matrix;
  if (!candidate || typeof candidate !== 'object' || !('classicRates' in candidate)) {
    throw new Error('Motor programme rating model requires complete classicRates configuration.');
  }
  const parsed = ClassicCarRatesSchema.safeParse(candidate.classicRates);
  if (!parsed.success) throw new Error('Motor programme rating model requires complete classicRates configuration.');
  return parsed.data;
}

export function roundUpToNearest50(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / 50) * 50;
}

/**
 * Santam base policy excess for petrol, diesel and hybrid private cars.
 *
 * The approved matrix is a versioned product-rate dataset. Every territory
 * consumes this same canonical matrix; callers must not recreate the cc
 * ladder in a quote surface, document, or underwriting overlay.
 */
export function ccBandMinimumExcess(engineCc: number, matrix: AbbeygateAutoCyprus2022Matrix): number {
  if (!Number.isFinite(engineCc) || engineCc <= 0) {
    throw new Error('Motor engine capacity is required to resolve the base policy excess.');
  }
  const bandIndex = parseEngineBand(engineCc, matrix.baseMatrix.basePolicyExcessEngineSizeBands, { unmatched: 'throw' });
  const excess = matrix.baseMatrix.basePolicyExcessByEngineBand[bandIndex];
  if (excess === undefined) {
    throw new Error(`Motor base excess configuration is incomplete for engine band index ${bandIndex}.`);
  }
  return excess;
}

function excessFromThresholds(
  value: number,
  thresholds: readonly { max: number; excess: number }[],
  label: string,
): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Motor ${label} is required to resolve policy excess.`);
  }
  const row = thresholds.find((threshold) => value <= threshold.max);
  if (!row) throw new Error(`Motor ${label} has no configured policy-excess threshold.`);
  return row.excess;
}

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
 * Peter's approved Santam schedule (2026-09-04): petrol, diesel and hybrid
 * cars use the cc-banded base excess; electric cars use €1,000. The
 * existing cabriolet/convertible roof excess remains additional to this
 * base excess elsewhere in the pipeline.
 */
export function computePrivateCarBaseExcess(
  quoteData: Pick<QuoteData, 'engineSize' | 'fuelType'>,
  matrix: AbbeygateAutoCyprus2022Matrix,
): number {
  if (String(quoteData.fuelType).trim() === 'Electric') {
    return matrix.excess.electricPrivateCarBase;
  }
  return ccBandMinimumExcess(Number(quoteData.engineSize), matrix);
}

export function computeClassicExcess(declaredValue: number, matrix: AbbeygateAutoCyprus2022Matrix): number {
  return roundUpToNearest50(Number(declaredValue || 0) * matrix.classic.excessPctOfValue);
}

export function computeMotorcaravanExcess(declaredValue: number, matrix: AbbeygateAutoCyprus2022Matrix): number {
  return excessFromThresholds(
    Number(declaredValue || 0),
    matrix.excess.motorcaravanByDeclaredValue,
    'motorcaravan declared value',
  );
}

export function computeMotorcycleExcess(engineCc: number, matrix: AbbeygateAutoCyprus2022Matrix): number {
  return excessFromThresholds(
    engineCc,
    matrix.excess.motorcycleByEngineCapacity,
    'motorcycle engine capacity',
  );
}

export function computeCalculatedPolicyExcess(quoteData: QuoteData, matrix: AbbeygateAutoCyprus2022Matrix): number {
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
    const matrixExcess = classicPricingModule.resolveClassicPricingContext({ quoteData, age, annualKms }, requireClassicRates(matrix)).policyExcess;
    const pctExcess = computeClassicExcess(declaredValue, matrix);
    return Math.max(matrixExcess, pctExcess);
  }
  if (isMotorcaravanRisk(vehicleType)) return computeMotorcaravanExcess(declaredValue, matrix);
  // ABY-325 — motorbikes carry a cc-banded comp excess from the rating
  // workbook, the same value the rater applies (autoInsuranceCalculator
  // `baseExcess`). Without this branch the displayed/default excess fell
  // through to the private-car base-excess schedule and diverged from
  // what the customer was actually rated on.
  if (isMotorbikeRisk(vehicleType)) return computeMotorcycleExcess(engineCc, matrix);
  const baseline = computePrivateCarBaseExcess(quoteData, matrix);
  // Cabriolet/convertible: scheme adds €500 additional policy excess
  // ("for the roof") on top of the auto-computed minimum.
  return isCabrioRisk(quoteData) ? baseline + matrix.excess.cabrioAdditional : baseline;
}

export function buildHigherDeductibleOptions(minimumExcess: number, matrix: AbbeygateAutoCyprus2022Matrix): number[] {
  const start = roundUpToNearest50(minimumExcess);
  const options: number[] = [];
  for (
    let value = start + matrix.excess.voluntaryOptions.increment;
    value <= matrix.excess.voluntaryOptions.maximum;
    value += matrix.excess.voluntaryOptions.increment
  ) {
    options.push(value);
  }
  return options;
}
