// Auto Insurance Pricing Calculator
// Implements pricing logic for Abbeygate Auto Insurance
// Based on ABBEYGATE AIG SCHEME COMP COVER Calculator 2022 Cyprus.xlsx
//
// CHAMPS: Decomposed — factor functions live in factors/abbeygateFactors.ts
//         Premium modules live in premiumModules/{tplModule,compModule,endorsementEffects}.ts

import type { QuoteData, QuoteResponse, QuoteOption, PremiumBreakdown, BreakdownCost } from '../../../platform/types/autoInsurance.js';
import { toDecimal, fromDecimal, roundCurrency } from '../../../platform/utils/decimal.js';
import { MOTOR_CALCULATOR_VERSION, type AutoInsurancePremiumCalculation } from './autoInsurancePricingTypes.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import type { JurisdictionProductConfig } from '../../../modules/jurisdiction/domain/productConfiguration.js';
import { resolveJurisdictionProductConfig } from '../../../modules/jurisdiction/domain/productConfiguration.js';
import { calculateMotorTaxes } from './motorTaxes.js';
import type { UwAutomationDecision } from '../underwriting/motorUwAutomation.js';

// Client-specific factor functions (Abbeygate)
import {
  asRecord,
  withNormalizedCountryBeforeUw,
  getAge,
  getKms,
  getExcess,
  proposerAgeFactorFromScheme,
  vehicleAgeFactorFromMatrix,
  licencePeriodFactorFromScheme,
  addedDriversUnder25FactorWithRestriction,
  driverRestrictionMinAge,
  minAdditionalDriversLicenseYears,
  ncdDiscountPctFromScheme,
  protectedNcdPremiumFactor,
  vehicleUseFactorFromScheme,
  convictionFactorFromScheme,
  claimsFactorFromScheme,
  resolveDriverPricingBasis,
  namedDriversDiscountFactor,
  openDriverAgeBandDiscountFactor,
  maxAdditionalDriverAge,
  resolveTermFactor,
  clampAbs,
  resolveUwAdjustmentPctCap,
} from './factors/abbeygateFactors.js';

// Extracted pricing modules
import { calculateTplPremium } from './premiumModules/tplModule.js';
import { calculateCompPremium } from './premiumModules/compModule.js';
import { processEndorsementEffects } from './premiumModules/endorsementEffects.js';
import type { AbbeygateAutoCyprus2022Matrix } from './data/abbeygate-auto-cyprus-2022.schema.js';

type CanonicalRulesModule = typeof import('./canonicalRules.js');
type ClassicPricingModule = typeof import('./classicPricing.js');

const canonicalRulesModule: CanonicalRulesModule = await import('./canonicalRules.js');
const classicPricingModule: ClassicPricingModule = await import('./classicPricing.js');

const {
  buildHigherDeductibleOptions,
  computeCalculatedPolicyExcess,
  computeClassicExcess,
  computeMotorcycleExcess,
  computePrivateCarBaseExcess,
  computeMotorcaravanExcess,
  requireClassicRates,
  isClassicRisk,
  isMotorcaravanRisk,
  isThirdPartyOnly,
} = canonicalRulesModule;
const { resolveClassicPricingContext } = classicPricingModule;

type MotorPricingFieldDescriptor = { path: string; label: string; numeric?: boolean };

const MOTOR_PRICING_REQUIRED_FIELDS: MotorPricingFieldDescriptor[] = [
  { path: 'proposer.dateOfBirth', label: 'date of birth' },
  { path: 'coverRequired', label: 'cover required' },
  { path: 'licenseYears', label: 'license years', numeric: true },
  { path: 'licenseType', label: 'license type' },
  { path: 'licenseIssuedIn', label: 'license issued in' },
  { path: 'vehicleType', label: 'vehicle type' },
  { path: 'make', label: 'make' },
  { path: 'model', label: 'model' },
  { path: 'year', label: 'vehicle year', numeric: true },
  { path: 'engineSize', label: 'engine size', numeric: true },
  { path: 'vehicleValue', label: 'vehicle value', numeric: true },
  { path: 'ncb', label: 'no claims discount' },
  { path: 'vehicleUse', label: 'vehicle use' },
];

function readPath(source: unknown, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = source;
  for (const segment of segments) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function assertMotorPricingInputs(quoteData: QuoteData): void {
  const missing = MOTOR_PRICING_REQUIRED_FIELDS.filter((field) => {
    const value = readPath(quoteData, field.path);
    if (field.numeric) {
      const n = Number(value);
      return !Number.isFinite(n) || n <= 0;
    }
    return String(value ?? '').trim().length === 0;
  });
  if (missing.length > 0) {
    throw new Error(`Motor pricing requires quote-ready fields before calculation: ${missing.map((field) => field.label).join(', ')}.`);
  }
}

function parseExcessFromQuoteData(
  quoteData: QuoteData,
  overrideExcess: number | undefined,
  matrix: AbbeygateAutoCyprus2022Matrix,
): number {
  if (overrideExcess !== undefined) return overrideExcess;
  const raw = quoteData.requiredExcess;
  const n = parseInt(String(raw || '').replace(/[^0-9]/g, '') || '0', 10);
  const calculatedMin = computeCalculatedPolicyExcess(quoteData, matrix);
  if (isClassicRisk(quoteData.vehicleType)) return calculatedMin;
  if (!Number.isFinite(n) || n <= 0) return calculatedMin;
  return Math.max(n, calculatedMin);
}

/**
 * Resolve the embedded windscreen (CV 24) premium for the current
 * quote, plus a flag telling downstream surfaces whether the cover is
 * applied at all.
 *
 * ABY-265 — Peter confirmed that windscreen is part of the core
 * Comprehensive premium and must not be charged as a separate line.
 * The canonical `CV 24` endorsement template now defaults
 * `premium_eur` to `0` (`backend/modules/mbe/domain/endorsementTemplates.ts:357`).
 * This function reads the param from the applied endorsement — so a
 * future per-program override can still surface a non-zero price if
 * required — but the legacy `25 × termFactor` fallback is gone.
 * Every snapshot reaching the fallback branch resolves to `0`, never
 * the legacy charge. The returned `applied` flag is consumed by the
 * calculator (and by the wizard payment-step display via the
 * `coverage.windscreen` step) so that a Comprehensive policy still
 * shows "Windscreen Cover — Included" without re-introducing the €25.
 */
function resolveEmbeddedWindscreenPremium(args: {
  appliedEndorsements: Array<{ code: string; params?: unknown }>;
  termFactor: number;
}): { applied: boolean; amount: number } {
  const windscreen = args.appliedEndorsements.find((endorsement) => String(endorsement.code || '').trim().toUpperCase() === 'CV 24');
  if (!windscreen) return { applied: false, amount: 0 };
  const configuredAmount = Number(asRecord(windscreen.params).premium_eur);
  if (Number.isFinite(configuredAmount) && configuredAmount >= 0) {
    return { applied: true, amount: fromDecimal(roundCurrency(toDecimal(configuredAmount))) };
  }
  // ABY-265 — windscreen is included in the core premium. A snapshot
  // missing `premium_eur` resolves to 0; never the legacy €25.
  void args.termFactor;
  return { applied: true, amount: 0 };
}

function shouldApplyOnlineDiscount(quoteDataExtra: Record<string, unknown>): boolean {
  const raw = quoteDataExtra.applyOnlineDiscount ?? quoteDataExtra.onlineDiscountAccepted;
  if (typeof raw === 'boolean') return raw;
  const normalized = String(raw ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
}

function buildQuoteOptionFromCalculation(
  name: string,
  excess: number,
  calculation: AutoInsurancePremiumCalculation,
  tag?: string,
  description?: string
): QuoteOption {
  const costDetails = calculation?.calculationDetails?.costBreakdown;
  const breakdown = calculation?.calculationDetails?.premiumBreakdown;
  const annualPremium = Number(costDetails?.totalPremium ?? calculation?.premium ?? 0);
  const monthlyPremium = annualPremium ? fromDecimal(roundCurrency(toDecimal(annualPremium).div(12))) : undefined;
  const steps = calculation?.calculationDetails?.steps || [];
  const taxRows = calculation?.calculationDetails?.taxRows || costDetails?.taxRows;

  // [MBE] Use calculated total excess (Base + Endorsements)
  const finalExcess = calculation.policyExcess || excess;

  return {
    name,
    annualPremium,
    monthlyPremium,
    compulsoryExcess: 0,
    voluntaryExcess: excess,
    totalExcess: finalExcess,
    tag,
    description,
    breakdown,
    costDetails,
    calculationTrace: {
      steps,
      calculatorVersion: calculation?.calculationDetails?.calculatorVersion || 'motor@1.0.0',
      ...(taxRows ? { taxRows } : {}),
      ...(calculation?.calculationDetails?.taxProfileCode ? { taxProfileCode: calculation.calculationDetails.taxProfileCode } : {}),
    },
  };
}

/**
 * Calculate an Abbeygate Auto Insurance QuoteResponse in the same shape the frontend/BO expects.
 * This wraps the premium calculation output into primaryOption + alternatives.
 */
export function calculateAutoInsuranceQuoteResponse(
  quoteData: QuoteData,
  overrideExcess: number | undefined,
  opts: {
    reference?: string;
    currency?: string;
    uwDecision: UwAutomationDecision;
    jurisdictionConfig?: JurisdictionProductConfig;
  },
  appliedEndorsements: Array<{ code: string; params?: unknown }> = [],
  matrix?: AbbeygateAutoCyprus2022Matrix,
): QuoteResponse {
  if (!matrix) throw new Error('Motor pricing requires a mapped programme rating model.');
  if (!opts?.uwDecision) {
    throw new Error('Motor pricing requires an underwriting decision from the published programme definition.');
  }
  assertMotorPricingInputs(quoteData);
  const currency = opts?.currency || 'EUR';
  const reference = opts?.reference || `AQ-${Date.now()}`;
  const normalizedQuoteData = withNormalizedCountryBeforeUw(quoteData);

  // Underwriting is evaluated once by MotorCompiledUwEngine from the mapped,
  // published programme definition. This leaf only consumes that decision.
  const uwDecision = opts.uwDecision;

  // If the UW automation explicitly declines, return immediately with no premium.
  // Red-lane referrals are still rateable and require manual approval later.
  if (uwDecision.outcome === 'decline') {
    return {
      reference,
      currency,
      status: 'declined',
      primaryOption: {
        name: 'Declined',
        annualPremium: 0,
        totalExcess: 0,
      },
      alternatives: [],
      warnings: uwDecision.reasons,
      validUntil: new Date().toISOString(), // Invalid immediately
    };
  }

  const primaryExcess = parseExcessFromQuoteData(normalizedQuoteData, overrideExcess, matrix);
  const primaryCalc = calculateAutoInsurancePremium(normalizedQuoteData, primaryExcess, appliedEndorsements, matrix, opts?.jurisdictionConfig);
  const primaryOption = buildQuoteOptionFromCalculation(
    'Standard',
    primaryExcess,
    primaryCalc,
    'Recommended',
    `Standard cover with €${primaryExcess} excess`
  );

  const minExcess = computeCalculatedPolicyExcess(normalizedQuoteData, matrix);
  const altExcesses = buildHigherDeductibleOptions(minExcess, matrix).filter((x) => x !== primaryExcess);
  const alternatives: QuoteOption[] = altExcesses.slice(0, 2).map((ex) => {
    const calc = calculateAutoInsurancePremium(normalizedQuoteData, ex, appliedEndorsements, matrix, opts?.jurisdictionConfig);
    const opt = buildQuoteOptionFromCalculation(
      `Excess €${ex}`,
      ex,
      calc,
      ex > primaryExcess ? 'Lower premium' : 'Lower excess',
      `Quote option with €${ex} excess`
    );
    return opt;
  });

  const validUntil = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString();
  })();

  // If YELLOW (Referral), return response but with 'referral' status and warnings
  const status = uwDecision.outcome === 'referral' ? 'referral' : 'quoted';
  const warnings = [...uwDecision.reasons];

  return {
    reference,
    currency,
    primaryOption,
    alternatives,
    warnings,
    validUntil,
    status,
  };
}

/**
 * Calculate premium for auto insurance based on quote data
 * @param quoteData - The quote data from the frontend form
 * @param overrideExcess - Optional excess override (for alternative quotes)
 * @returns Premium breakdown with detailed calculation
 */
export function calculateAutoInsurancePremium(
  quoteData: QuoteData,
  overrideExcess?: number,
  appliedEndorsements: Array<{ code: string; params?: unknown }> = [],
  matrix?: AbbeygateAutoCyprus2022Matrix,
  jurisdictionConfig?: JurisdictionProductConfig
): AutoInsurancePremiumCalculation {
  if (!matrix) throw new Error('Motor pricing requires a mapped programme rating model.');
  assertMotorPricingInputs(quoteData);
  const normalizedQuoteData = withNormalizedCountryBeforeUw(quoteData);
  const quoteDataExtra = asRecord(normalizedQuoteData);

  // ─── Resolve all factors from extracted functions ───────────────
  const age = getAge(normalizedQuoteData.proposer?.dateOfBirth ?? '');
  const kms = getKms(normalizedQuoteData.kmsPerYear);
  const selectedExcess = getExcess(normalizedQuoteData.requiredExcess, overrideExcess);
  const vehicleValue = normalizedQuoteData.vehicleValue || 0;
  const proposerLicenseYears = Number(normalizedQuoteData.licenseYears) || 0;
  const additionalDriverMinLicenseYears = minAdditionalDriversLicenseYears(normalizedQuoteData);
  const effectiveLicenseYears =
    additionalDriverMinLicenseYears === null
      ? proposerLicenseYears
      : Math.min(proposerLicenseYears, additionalDriverMinLicenseYears);
  const isComprehensive = normalizedQuoteData.coverRequired !== 'Third Party Liability';
  const youngestDriverAge = Number(normalizedQuoteData.youngestDriverAge);
  const proposerAgeFactor = proposerAgeFactorFromScheme(age, matrix.factors.proposerAge);
  const vehicleAgeFactor = vehicleAgeFactorFromMatrix(Number(quoteData.year || 0), matrix.factors.vehicleAge);
  const licencePeriodFactor = licencePeriodFactorFromScheme(effectiveLicenseYears, matrix.factors.licencePeriod);
  const driverRestriction = (normalizedQuoteData as { driverRestriction?: string }).driverRestriction;
  // ABY-232: under-25 added-driver loading only applies when the
  // policy collects named drivers. The two AAD modes
  // (ANY_DRIVER_25_PLUS / ANY_DRIVER_40_PLUS) exclude under-25
  // drivers from coverage by definition, so the loading must collapse
  // to 1.0 even if a stale `hasAdditionalDrivers` flag is present.
  const additionalDriversUnder25Factor = addedDriversUnder25FactorWithRestriction(
    driverRestriction,
    Boolean(normalizedQuoteData.hasAdditionalDrivers),
    youngestDriverAge,
    matrix.factors.addedDriversUnder25,
  );
  const driverPricingBasis = resolveDriverPricingBasis(normalizedQuoteData);
  const twoNamedDriversDiscount = namedDriversDiscountFactor(driverPricingBasis, matrix.factors.driverPricing.namedDriversFactor);
  const openDriverAgeBandDiscount = openDriverAgeBandDiscountFactor(driverRestriction, matrix.factors.driverPricing.anyDriver40PlusFactor);
  const restrictionMinAge = driverRestrictionMinAge(driverRestriction);
  const useFactor = vehicleUseFactorFromScheme(String(normalizedQuoteData.vehicleUse || ''), matrix.factors.vehicleUse);
  const convictionFactor = convictionFactorFromScheme(normalizedQuoteData, matrix.factors.convictions);
  const claimsFactor = claimsFactorFromScheme(normalizedQuoteData, matrix.factors.claims);
  const maxAddDriverAge = maxAdditionalDriverAge(normalizedQuoteData, getAge);
  const additionalDriversOver80Factor = Boolean(normalizedQuoteData.hasAdditionalDrivers) && maxAddDriverAge !== null && maxAddDriverAge > matrix.factors.driverPricing.additionalDriverAgeLoading.ageOver
    ? matrix.factors.driverPricing.additionalDriverAgeLoading.factor
    : 1.0;
  const steps: AutoInsurancePremiumCalculation['calculationDetails']['steps'] = [];

  // ABY-232 / ADR-0025: surface the canonical coverage restriction
  // in the pricing trace so quote responses (and the BO underwriting
  // payload) can show *why* a particular pricing basis applied,
  // rather than just the projected NAMED/OPEN flag.
  if (driverRestriction) {
    steps.push({
      id: 'drivers.coverageRestriction',
      name: 'Driver coverage restriction',
      kind: 'subtotal',
      inputs: {
        driverRestriction,
        driverPricingBasis,
        openDriverAgeBandDiscount,
        minAuthorisedDriverAge: restrictionMinAge,
      },
      output: 0,
      notes: restrictionMinAge !== null
        ? `Open driving: minimum authorised driver age ${restrictionMinAge}. Pricing basis: ${driverPricingBasis}.`
        : `Named coverage. Pricing basis: ${driverPricingBasis}.`,
    });
  }

  const vehicleType = String(normalizedQuoteData.vehicleType || '');
  const isMotorbike = vehicleType.toLowerCase().includes('motorbike') || vehicleType.toLowerCase().includes('motorcycle');
  const isMotorcaravan = isMotorcaravanRisk(vehicleType);
  const isClassic = vehicleType.toLowerCase().includes('classic');
  const classicContext = isClassic
    ? resolveClassicPricingContext({
      quoteData: normalizedQuoteData,
      age,
      annualKms: kms,
    }, requireClassicRates(matrix))
    : null;
  const isTpo = isThirdPartyOnly(quoteData.coverRequired);

  // ABY-324 — a motorbike with named riders is rated on the YOUNGEST
  // rider, not the proposer. When additional named riders are present
  // and the captured youngest-rider age is below the proposer's, that
  // age drives the workbook rider-age factor. (The comp module only
  // consumes `age` for the motorbike rider-age factor; the car/classic
  // branches use `proposerAgeFactor`, so this override is motorbike-safe.)
  const motorbikeRatingAge =
    isMotorbike &&
    Boolean(normalizedQuoteData.hasAdditionalDrivers) &&
    Number.isFinite(age) &&
    Number.isFinite(youngestDriverAge) &&
    youngestDriverAge > 0
      ? Math.min(age, youngestDriverAge)
      : age;

  // ─── Excess Resolution ─────────────────────────────────────────
  const baseExcess =
    isTpo ? 0
      : isClassic ? Math.max(Number(classicContext?.policyExcess || 0), computeClassicExcess(Number(vehicleValue || 0), matrix))
        : isMotorbike ? computeMotorcycleExcess(Number(normalizedQuoteData.engineSize || 0), matrix)
          : isMotorcaravan ? computeMotorcaravanExcess(Number(vehicleValue || 0), matrix)
            : computePrivateCarBaseExcess(normalizedQuoteData, matrix);
  const excess = isTpo ? 0 : isClassic ? baseExcess : Math.max(baseExcess, Number(selectedExcess || 0));
  const referenceCompExcess = isTpo
    ? computeCalculatedPolicyExcess({ ...normalizedQuoteData, coverRequired: 'Comprehensive' }, matrix)
    : excess;
  const excessOrigin = isTpo ? 'TPO fixed at €0'
    : isClassic ? 'Classic matrix rule (age band × vehicle group)'
      : isMotorcaravan ? 'Motorcaravan value threshold'
        : 'Santam base excess by engine capacity (electric: €1,000)';
  steps.push({
    id: 'excess.computed', name: 'Computed policy excess', kind: 'subtotal',
    inputs: { selectedExcess, referenceCompExcess, baseExcess, rule: excessOrigin }, output: excess, notes: excessOrigin,
  });

  // Policy term
  const { termMonths, termFactor } = resolveTermFactor(quoteDataExtra, matrix.factors.policyTerm);

  // ─── 1️⃣ TPL Module ────────────────────────────────────────────
  const tplResult = calculateTplPremium({
    age, kms, claimsFactor, licencePeriodFactor, twoNamedDriversDiscount, openDriverAgeBandDiscount, useFactor, convictionFactor,
    matrix,
  });
  let tplRaw = tplResult.tplRaw;
  steps.push(...tplResult.steps);

  // ─── 2️⃣ Comp Module ──────────────────────────────────────────
  const compResult = calculateCompPremium({
    normalizedQuoteData, isComprehensive, isTpo, isMotorbike, isClassic, isMotorcaravan,
    age: motorbikeRatingAge, proposerAgeFactor, vehicleAgeFactor, claimsFactor, licencePeriodFactor,
    twoNamedDriversDiscount, openDriverAgeBandDiscount, useFactor, convictionFactor, referenceCompExcess,
    classicContext, matrix, kms,
  });
  let compRaw = compResult.compRaw;
  const { motorbikeWorkbookRated } = compResult;
  if (compResult.tplOverride !== undefined) tplRaw = compResult.tplOverride;
  steps.push(...compResult.steps);

  // ─── 3️⃣ Added Driver Loadings ─────────────────────────────────
  if (!isMotorbike && additionalDriversUnder25Factor !== 1.0) {
    steps.push({
      id: 'drivers.addedUnder25', name: 'Added drivers under 25 factor', kind: 'factor',
      inputs: { hasAdditionalDrivers: normalizedQuoteData.hasAdditionalDrivers, youngestDriverAge },
      factor: additionalDriversUnder25Factor,
    });
    tplRaw = fromDecimal(roundCurrency(toDecimal(tplRaw).mul(additionalDriversUnder25Factor)));
    if (isComprehensive || isTpo) compRaw = fromDecimal(roundCurrency(toDecimal(compRaw).mul(additionalDriversUnder25Factor)));
  }

  if (!isMotorbike && additionalDriversOver80Factor !== 1.0) {
    steps.push({
      id: 'drivers.addedOver80', name: 'Added drivers over 80 factor', kind: 'factor',
      inputs: { hasAdditionalDrivers: normalizedQuoteData.hasAdditionalDrivers, maxAdditionalDriverAge: maxAddDriverAge },
      factor: additionalDriversOver80Factor,
    });
    tplRaw = fromDecimal(roundCurrency(toDecimal(tplRaw).mul(additionalDriversOver80Factor)));
    if (isComprehensive || isTpo) compRaw = fromDecimal(roundCurrency(toDecimal(compRaw).mul(additionalDriversOver80Factor)));
  }

  // ─── 4️⃣ Term Factor ──────────────────────────────────────────
  if (termFactor !== 1.0) {
    steps.push({
      id: 'term.factor', name: 'Policy term factor', kind: 'factor',
      inputs: { termMonths }, factor: termFactor,
      notes: 'Short-term policy factor from the published programme model.',
    });
    tplRaw = fromDecimal(roundCurrency(toDecimal(tplRaw).mul(termFactor)));
    if (isComprehensive || isTpo) compRaw = fromDecimal(roundCurrency(toDecimal(compRaw).mul(termFactor)));
  }
  const windscreenResult = resolveEmbeddedWindscreenPremium({ appliedEndorsements, termFactor });
  const windscreen = windscreenResult.amount;
  const windscreenApplied = windscreenResult.applied;

  // ─── 5️⃣ Final Risk Premium ───────────────────────────────────
  if (isTpo && !motorbikeWorkbookRated) {
    const comprehensiveBaseRate = compRaw;
    tplRaw = fromDecimal(roundCurrency(toDecimal(comprehensiveBaseRate).mul(matrix.tpl.tpoFactor)));
    compRaw = 0;
    steps.push({
      id: 'tpo.sixtyPctRule', name: 'TPO = 60% of comprehensive base rate', kind: 'factor',
      inputs: { comprehensiveBaseRateBeforeAddOns: comprehensiveBaseRate },
      factor: matrix.tpl.tpoFactor, output: tplRaw, notes: 'Applied before endorsement add-ons.',
    });
  }

  // Motorcaravan special rates — must override tplRaw/compRaw BEFORE riskPremium is sealed
  // so that the km-band rate drives grossPremium, NCD, and all downstream calculations.
  if (isMotorcaravan) {
    const bands = matrix.motorcaravan.basePremiumByAnnualKms;
    const found = bands.find((b) => kms <= b.maxKms);
    const base = found ? found.premium : bands[bands.length - 1]!.premium;
    const weightKgRaw =
      Number(quoteDataExtra.grossVehicleWeightKg || 0) ||
      Number(quoteDataExtra.vehicleWeightKg || 0) ||
      Number(quoteDataExtra.weightKg || 0);
    const weightTonnesRaw = Number(quoteDataExtra.vehicleWeightTonnes || 0);
    const weightTonnes = Number.isFinite(weightTonnesRaw) && weightTonnesRaw > 0 ? weightTonnesRaw : weightKgRaw / 1000;
    const overThreeTonnesFactor = weightTonnes > matrix.motorcaravan.overWeightTonnes ? matrix.motorcaravan.overWeightFactor : 1.0;
    const regionRaw = String(quoteData.proposer?.address?.city || quoteData.vehicleLocation || '').toLowerCase();
    const locationFactor = Object.entries(matrix.motorcaravan.locationFactors)
      .find(([location]) => location !== 'default' && regionRaw.includes(location))?.[1] ?? matrix.motorcaravan.locationFactors.default;
    const loaded = fromDecimal(roundCurrency(toDecimal(base).mul(overThreeTonnesFactor).mul(locationFactor)));
    tplRaw = 0;
    compRaw = loaded;
    steps.push({ id: 'motorcaravan.base', name: 'Motorcaravan base premium (km band)', kind: 'table_lookup', inputs: { kmsPerYear: kms }, output: base });
    if (overThreeTonnesFactor !== 1.0) {
      steps.push({ id: 'motorcaravan.loading.weight', name: 'Motorcaravan >3 tonnes loading', kind: 'factor', inputs: { vehicleWeightTonnes: weightTonnes }, factor: overThreeTonnesFactor });
    }
    if (locationFactor !== 1.0) {
      steps.push({ id: 'motorcaravan.loading.location', name: 'Motorcaravan location loading', kind: 'factor', inputs: { location: regionRaw || 'unknown' }, factor: locationFactor });
    }
  }

  // riskPremium is now sealed with the correct tplRaw/compRaw for all vehicle types.
  const riskPremium = fromDecimal(roundCurrency(toDecimal(tplRaw).plus(compRaw).plus(windscreen)));
  // ABY-265 — emit a `coverage.windscreen` step whenever CV 24 is
  // applied (even when the amount is 0), so the wizard payment step,
  // BO Premium tab and PDF schedule can render a "Windscreen Cover —
  // Included" row without re-deriving CV-24 selection from the raw
  // endorsement list. `amount === 0` is the canonical signal that the
  // cover is included in the core premium at no separate charge.
  // `kind: 'fee'` is preserved so existing kind-based aggregations
  // (BDX, audit) continue to treat the row as a coverage line item;
  // consumers that care about the price use `amount > 0`.
  if (windscreenApplied) {
    steps.push({
      id: 'coverage.windscreen',
      name: 'Windscreen Cover',
      kind: 'fee',
      amount: windscreen,
      notes: windscreen > 0
        ? 'Embedded in core premium'
        : 'Included in core premium — no separate charge (ABY-265)',
    });
  }
  steps.push({
    id: 'risk.subtotal', name: 'Risk premium subtotal', kind: 'subtotal',
    inputs: { tpl: tplRaw, comp: compRaw, windscreen }, output: riskPremium,
  });

  // Classic vehicle excess (display-only metadata — no premium impact)
  if (isClassic && classicContext) {
    steps.push({
      id: 'classic.excess', name: 'Classic policy excess (age band × vehicle group)', kind: 'table_lookup',
      inputs: { age, ageBand: classicContext.ageBand, vehicleGroup: classicContext.vehicleGroup, groupMatchType: classicContext.groupMatchType, matrixExcess: classicContext.policyExcess, valuePctExcess: computeClassicExcess(Number(vehicleValue || 0), matrix) },
      factor: 1.0, notes: `Classic excess = max(matrix: €${classicContext.policyExcess}, 1.5% value)`,
    });
  }

  // ─── 6️⃣ Cost Breakdown (discounts, charges, taxes) ────────────
  // ABY-353 — the motorcaravan scheme is a FLAT km-banded rate
  // (€450/€500/€600 by annual mileage) per the Abbeygate rate sheet:
  // "<band> + tax + breakdown". Like the motorcycle scheme it carries
  // no No-Claims-Discount scale — applying NCD on top wiped up to 65%
  // off the flat rate (e.g. €600 band → €210 net), which is exactly the
  // "motorcaravan rates too low" report. NCD, protected-NCD and the
  // online discount are therefore all suppressed for these flat-scheme
  // risks, mirroring the motorbike treatment.
  const isFlatSchemeRisk = isMotorbike || isMotorcaravan;
  const ncdDiscountPct = isFlatSchemeRisk ? 0 : ncdDiscountPctFromScheme(normalizedQuoteData.ncb, matrix.factors.ncd.discounts);
  const protectedNcdFactor = isFlatSchemeRisk ? 1.0 : protectedNcdPremiumFactor(
    Boolean(normalizedQuoteData.protectNCB),
    normalizedQuoteData.ncb,
    matrix.factors.ncd.discounts,
    matrix.factors.ncd.protectedFactor,
  );
  const grossPremium = riskPremium;
  const ncdAmount = ncdDiscountPct ? fromDecimal(roundCurrency(toDecimal(grossPremium).mul(ncdDiscountPct))) : 0;
  const protectedNcdAmount = protectedNcdFactor !== 1.0
    ? fromDecimal(roundCurrency(toDecimal(grossPremium).mul(protectedNcdFactor - 1)))
    : 0;
  const technicalNet = fromDecimal(roundCurrency(toDecimal(grossPremium).minus(ncdAmount).plus(protectedNcdAmount)));

  if (ncdDiscountPct) {
    steps.push({
      id: 'discount.ncd', name: 'No Claims Discount (NCD)', kind: 'factor',
      inputs: { ncb: normalizedQuoteData.ncb }, factor: 1 - ncdDiscountPct,
      notes: `-${Math.round(ncdDiscountPct * 1000) / 10}%`,
    });
  }
  if (protectedNcdAmount) {
    steps.push({
      id: 'loading.protectedNcd', name: 'Protected NCD (+10%)', kind: 'factor',
      inputs: { protectNCB: normalizedQuoteData.protectNCB, ncb: normalizedQuoteData.ncb },
      factor: protectedNcdFactor,
      notes: '+10% of gross premium for NCD protection',
    });
  }

  const onlineDiscount = !isFlatSchemeRisk && shouldApplyOnlineDiscount(quoteDataExtra)
    ? fromDecimal(roundCurrency(toDecimal(technicalNet).mul(matrix.factors.onlineDiscount)))
    : 0;
  const subtotalNetPremiumBeforeUwAdj = fromDecimal(roundCurrency(toDecimal(technicalNet).minus(onlineDiscount)));

  // ─── 7️⃣ UW Adjustments ─────────────────────────────────────────
  let uwAdjustmentAmount = 0;
  const rawAdjustments = normalizedQuoteData.uwAdjustments;
  const legacyAdjustment = normalizedQuoteData.uwAdjustment;
  const uwAdjustmentPctCap = resolveUwAdjustmentPctCap(matrix.factors.uwAdjustmentPctCap);

  const uwAdjustments = Array.isArray(rawAdjustments)
    ? rawAdjustments
    : (legacyAdjustment && (legacyAdjustment.type || legacyAdjustment.value) ? [legacyAdjustment] : []);

  uwAdjustments.forEach((adjRaw, idx: number) => {
    const adj = asRecord(adjRaw);
    const uwAdjId = String(adj?.id || '').trim() || undefined;
    const uwAdjName = String(adj?.name || '').trim();
    const uwAdjLineType = String(adj?.lineType || 'pricing').toLowerCase();
    if (uwAdjLineType === 'schedule_note') return;
    const uwAdjType = String(adj?.type || '').toLowerCase();
    const uwAdjMode = String(adj?.mode || '').toLowerCase();
    const uwAdjValueRaw = Number(adj?.value);
    const uwAdjValue = Number.isFinite(uwAdjValueRaw) ? uwAdjValueRaw : 0;
    const uwAdjSign = uwAdjType === 'discount' ? -1 : uwAdjType === 'loading' ? 1 : 0;
    const uwAdjScopeType = String(adj?.scopeType || 'policy').toLowerCase();
    const uwAdjScopeRef = String(adj?.scopeRef || '').toUpperCase();
    const uwAdjSchedulePresentation = String(adj?.schedulePresentation || 'inherent').toLowerCase();
    const riskComponentSubtotal = fromDecimal(roundCurrency(toDecimal(tplRaw).plus(compRaw)));
    const riskBaseForAllocation = riskComponentSubtotal > 0 ? riskComponentSubtotal : subtotalNetPremiumBeforeUwAdj;
    const coverageShare =
      uwAdjScopeType === 'coverage' && uwAdjScopeRef === 'TPL'
        ? (riskBaseForAllocation > 0 ? tplRaw / riskBaseForAllocation : 0)
        : uwAdjScopeType === 'coverage' && uwAdjScopeRef === 'OWN_DAMAGE'
          ? (riskBaseForAllocation > 0 ? compRaw / riskBaseForAllocation : 0)
          : 1;
    const scopeBase = uwAdjScopeType === 'coverage'
      ? fromDecimal(roundCurrency(toDecimal(subtotalNetPremiumBeforeUwAdj).mul(coverageShare)))
      : subtotalNetPremiumBeforeUwAdj;
    const reasonText = String(adj?.reasonText || adj?.reason || '').trim();

    let thisAmount = 0;

    if (uwAdjSign !== 0 && uwAdjValue !== 0) {
      if (uwAdjMode === 'pct') {
        const pct = clampAbs(uwAdjValue, uwAdjustmentPctCap);
        thisAmount = fromDecimal(toDecimal(scopeBase).mul(pct / 100).mul(uwAdjSign));
      } else if (uwAdjMode === 'amount') {
        thisAmount = uwAdjValue * uwAdjSign;
      }
    }

    if (thisAmount !== 0) {
      uwAdjustmentAmount = fromDecimal(roundCurrency(toDecimal(uwAdjustmentAmount).plus(thisAmount)));
      steps.push({
        id: `uw.adjustment.${idx}`,
        name: uwAdjName ? `Underwriter adjustment - ${uwAdjName}` : `Underwriter adjustment (${uwAdjType})`,
        kind: 'fee',
        inputs: {
          id: uwAdjId, lineType: 'pricing', name: uwAdjName || undefined,
          type: uwAdjType, mode: uwAdjMode, value: uwAdjValueRaw,
          reason: reasonText, reasonText,
          scopeType: uwAdjScopeType === 'coverage' ? 'coverage' : 'policy',
          scopeRef: uwAdjScopeType === 'coverage' ? (uwAdjScopeRef || undefined) : undefined,
          schedulePresentation: uwAdjSchedulePresentation === 'separate_line' ? 'separate_line' : 'inherent',
          endorsementId: adj?.endorsementId ? String(adj.endorsementId) : undefined,
          scopeBase, pctCap: uwAdjustmentPctCap,
        },
        amount: thisAmount,
        notes: reasonText || uwAdjName || undefined,
      });
    }
  });

  const subtotalNetPremium = fromDecimal(toDecimal(subtotalNetPremiumBeforeUwAdj).plus(uwAdjustmentAmount));

  // ─── MBE Endorsement Effects (single pass) ─────────────────────
  // Run effects once with the just-computed subtotalNetPremium so that
  // ADD_PREMIUM_PCT_OF_NET effects (e.g. CV 172 Protected NCD) can resolve
  // their amount against the correct base (after NCD, after UW adj, before
  // tax). The three result buckets are then composed into the premium
  // ladder at different stages:
  //   - mbeAdditionalExcess     → folded into finalPolicyExcess
  //   - mbeNetLoadingPremium    → added BEFORE tax (this step)
  //   - mbeEndorsementPremium   → added AFTER tax (ULR etc., later)
  // (ADR-0023)
  const endorsementResult = processEndorsementEffects({
    appliedEndorsements,
    quoteDataExtra,
    subtotalNetPremium,
    ncb: normalizedQuoteData.ncb,
    ncdDiscounts: matrix.factors.ncd.discounts,
  });

  const netLoadingSteps = endorsementResult.steps.filter((s) =>
    String(s.id || '').startsWith('endorsement.netLoading.')
  );
  const postTaxSteps = endorsementResult.steps.filter((s) =>
    !String(s.id || '').startsWith('endorsement.netLoading.')
  );

  // Push net-loading steps (e.g. CV 172 Protected NCD) right after the
  // net-premium subtotal so the trace reads in computation order.
  steps.push(...netLoadingSteps);

  const subtotalNetPremiumWithLoadings = fromDecimal(
    roundCurrency(toDecimal(subtotalNetPremium).plus(endorsementResult.mbeNetLoadingPremium))
  );

  // Charges
  const inceptionDate = quoteDataExtra.startDate
    ? new Date(String(quoteDataExtra.startDate))
    : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days default

  const resolvedJurisdictionConfig = jurisdictionConfig || resolveJurisdictionProductConfig({
    productCode: 'MOTOR',
    tenant: getTenantConfig(),
  });
  const taxResult = calculateMotorTaxes({
    config: resolvedJurisdictionConfig,
    grossPremium: subtotalNetPremiumWithLoadings,
    netPremium: subtotalNetPremiumWithLoadings,
    entryType: String(quoteDataExtra.entryType || quoteDataExtra.entry || ''),
    termMonths,
    inceptionDate,
  });
  const mifSurcharge = taxResult.legacy.mifSurcharge;
  const stampDuty = taxResult.legacy.stampDuty;
  const policyFee = taxResult.legacy.policyFee;

  // Total premium (net + loadings + taxes, BEFORE flat post-tax endorsements).
  const totalPremium = fromDecimal(
    roundCurrency(
      toDecimal(subtotalNetPremiumWithLoadings)
        .plus(mifSurcharge)
        .plus(stampDuty)
        .plus(policyFee)
    )
  );

  taxResult.rows
    .filter((row) => row.code !== 'NET_PREMIUM' && row.amount !== 0)
    .forEach((row) => {
      const label = resolvedJurisdictionConfig.documentConfig.premiumDisplay.labels[row.code] || row.code;
      steps.push({
        id: `tax.${row.code.toLowerCase()}`,
        name: label,
        kind: row.code === 'GREEN_CARD_FEE' ? 'fee' : 'tax',
        amount: row.amount,
        inputs: { code: row.code, rate: row.rate, base: row.base, rounding: row.rounding },
      });
    });
  steps.push({
    id: 'total.premiumPayable', name: 'Total premium payable', kind: 'total',
    inputs: {
      subtotalNetPremium,
      mbeNetLoadingPremium: endorsementResult.mbeNetLoadingPremium,
      subtotalNetPremiumWithLoadings,
      mifSurcharge, stampDuty, policyFee,
      taxProfileCode: taxResult.profileCode,
    },
    output: totalPremium,
  });

  // Build Premium Breakdown
  const premiumBreakdown: PremiumBreakdown = {
    tplBase: tplResult.tplBase,
    tplClaimsFactor: tplResult.tplClaimsFactor,
    tplMileageFactor: tplResult.tplMileageFactor,
    tplLicenseFactor: tplResult.tplLicenseFactor,
    tplFinal: tplRaw,
    compBase: compResult.compBase,
    compAgeFactor: compResult.compAgeFactor,
    compClaimsFactor: compResult.compClaimsFactor,
    compExcessFactor: compResult.compExcessFactor,
    compLicenseFactor: compResult.compLicenseFactor,
    compFinal: compRaw,
    windscreen,
    youngestDriverAge: Number.isFinite(youngestDriverAge) ? youngestDriverAge : undefined,
    additionalDriversUnder25Factor,
    finalPremium: riskPremium,
  };

  // Post-tax endorsement lines (excess add-ons, ULR €86, etc.).
  steps.push(...postTaxSteps);

  const finalPolicyExcess = Math.max(0, excess + endorsementResult.mbeAdditionalExcess);
  const grandTotalPremium = fromDecimal(
    roundCurrency(toDecimal(totalPremium).plus(endorsementResult.mbeEndorsementPremium))
  );

  // Update Total Step Output for clarity
  const totalStep = steps.find(s => s.kind === 'total');
  if (totalStep) {
    totalStep.output = grandTotalPremium;
    totalStep.inputs = { ...totalStep.inputs, mbeEndorsementPremium: endorsementResult.mbeEndorsementPremium };
  }

  const costBreakdown: BreakdownCost = {
    grossPremium: fromDecimal(roundCurrency(toDecimal(grossPremium))),
    ncdAmount: fromDecimal(roundCurrency(toDecimal(ncdAmount))),
    onlineDiscount: fromDecimal(roundCurrency(toDecimal(onlineDiscount))),
    subtotalNetPremiumBeforeUwAdj: fromDecimal(roundCurrency(toDecimal(subtotalNetPremiumBeforeUwAdj))),
    uwAdjustmentAmount: fromDecimal(roundCurrency(toDecimal(uwAdjustmentAmount))),
    subtotalNetPremium: fromDecimal(roundCurrency(toDecimal(subtotalNetPremium))),
    mifSurcharge: fromDecimal(roundCurrency(toDecimal(mifSurcharge))),
    stampDuty: fromDecimal(roundCurrency(toDecimal(stampDuty))),
    policyFee: fromDecimal(roundCurrency(toDecimal(policyFee))),
    totalPremium: fromDecimal(roundCurrency(toDecimal(grandTotalPremium))),
    taxRows: taxResult.rows,
    taxProfileCode: taxResult.profileCode,
  };

  return {
    premium: fromDecimal(roundCurrency(toDecimal(grandTotalPremium))),
    policyExcess: finalPolicyExcess,
    basis: 'MOTOR',
    calculationDetails: {
      premiumBreakdown,
      costBreakdown,
      taxRows: taxResult.rows,
      taxProfileCode: taxResult.profileCode,
      steps,
      calculatorVersion: MOTOR_CALCULATOR_VERSION,
    },
  };
}
