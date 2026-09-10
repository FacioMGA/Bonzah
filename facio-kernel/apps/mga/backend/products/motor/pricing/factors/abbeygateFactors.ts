/**
 * Abbeygate-specific rating factor functions.
 *
 * Extracted from the inline closures inside `calculateAutoInsurancePremium`.
 * Each function is a pure, deterministic factor lookup — independently testable,
 * zero runtime cost (V8 inlines pure functions aggressively).
 *
 * Client-specific: these encode Abbeygate's AIG Scheme workbook factor tables.
 * For a new insurer, create a parallel `factors/<clientName>Factors.ts`.
 */

import type { QuoteData } from '../../../../platform/types/autoInsurance.js';
import type { AbbeygateAutoCyprus2022Matrix } from '../data/abbeygate-auto-cyprus-2022.schema.js';

// ─── Helpers ──────────────────────────────────────────────────────

type UnknownRecord = Record<string, unknown>;
export function asRecord(value: unknown): UnknownRecord {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

export function normalizeCountryValue(raw: unknown): string {
    const value = String(raw || '').trim();
    if (!value) return '';
    const upper = value.toUpperCase();
    if (upper === 'CY' || upper === 'CYP') return 'Cyprus';
    if (upper === 'PT' || upper === 'PRT') return 'Portugal';
    if (upper === 'ES' || upper === 'ESP') return 'Spain';
    return value;
}

export function withNormalizedCountryBeforeUw(quoteData: QuoteData): QuoteData {
    return {
        ...quoteData,
        countryOfRegistration: normalizeCountryValue(quoteData.countryOfRegistration),
        vehicleLocation: normalizeCountryValue(quoteData.vehicleLocation),
    };
}

export function getAge(dobString: string): number {
    if (!dobString) {
        throw new Error('[abbeygateFactors] dateOfBirth is required to compute age — refusing silent default. Validate upstream before calling.');
    }
    const today = new Date();
    const birthDate = new Date(dobString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}

export function getKms(kmsString: string): number {
    return parseInt(kmsString?.toString().replace(/[^0-9]/g, '') || '0', 10);
}

export function getExcess(dataExcess: string, override?: number): number {
    if (override !== undefined) return override;
    const cleaned = dataExcess?.replace(/[^0-9]/g, '');
    if (!cleaned) {
        throw new Error('[abbeygateFactors] excess is required — refusing silent default. Validate upstream before calling.');
    }
    return parseInt(cleaned, 10);
}

// ─── Car Factor Tables ────────────────────────────────────────────

type FactorBand = { min: number; max: number; factor: number };

function factorForBand(value: number, bands: readonly FactorBand[]): number {
    const band = bands.find((entry) => value >= entry.min && value <= entry.max);
    if (!band) throw new Error(`No configured factor band for value ${value}.`);
    return band.factor;
}

export function proposerAgeFactorFromScheme(age: number, bands: readonly FactorBand[]): number {
    if (!Number.isFinite(age) || age <= 0) return 1.0;
    return factorForBand(age, bands);
}

export function vehicleAgeFactorFromMatrix(vehicleYear: number, bands: readonly FactorBand[]): number {
    const nowYear = new Date().getFullYear();
    if (!Number.isFinite(vehicleYear) || vehicleYear <= 0) return 1.0;
    const ageYears = Math.max(0, nowYear - vehicleYear);
    return factorForBand(ageYears, bands);
}

export function licencePeriodFactorFromScheme(licenseYears: number, bands: readonly FactorBand[]): number {
    if (!Number.isFinite(licenseYears) || licenseYears < 0) return 1.0;
    return factorForBand(licenseYears, bands);
}

export function addedDriversUnder25FactorFromScheme(hasAdditionalDrivers: boolean, youngestAge: number, bands: readonly FactorBand[]): number {
    if (!hasAdditionalDrivers) return 1.0;
    if (!Number.isFinite(youngestAge)) return 1.0;
    return factorForBand(youngestAge, bands);
}

/**
 * Driver coverage restriction → minimum permitted authorised-driver
 * age (ABY-232 / ADR-0025). Returns `null` for named modes — the age
 * gate there is governed per-row, not by a blanket open-driver
 * threshold.
 *
 *   POLICYHOLDER_ONLY    → null
 *   NAMED_DRIVERS        → null
 *   ANY_DRIVER_25_PLUS   → 25
 *   ANY_DRIVER_40_PLUS   → 40
 */
export function driverRestrictionMinAge(restriction: unknown): number | null {
    if (restriction === 'ANY_DRIVER_25_PLUS') return 25;
    if (restriction === 'ANY_DRIVER_40_PLUS') return 40;
    return null;
}

/**
 * Coverage-restriction gate for the under-25 loading. The scheme
 * under-25 ladder (90% / 125% / 150% / 200%) only applies when the
 * policy collects NAMED additional drivers; for the two open modes
 * (ANY_DRIVER_25_PLUS / ANY_DRIVER_40_PLUS) the policy excludes
 * under-25 drivers by definition, so the loading must not be charged.
 * For POLICYHOLDER_ONLY there are no additional drivers at all, so
 * the factor collapses to 1.0.
 *
 * This is functionally equivalent to the original
 * `addedDriversUnder25FactorFromScheme(hasAdditionalDrivers, …)`
 * because `hasAdditionalDrivers` is forced to `false` in the
 * non-NAMED modes by the wizard / BO controllers — but encoding the
 * gate explicitly here prevents future regressions if either side
 * drifts.
 */
export function addedDriversUnder25FactorWithRestriction(
    driverRestriction: unknown,
    hasAdditionalDrivers: boolean,
    youngestAge: number,
    bands: readonly FactorBand[],
): number {
    if (driverRestriction && driverRestriction !== 'NAMED_DRIVERS') return 1.0;
    return addedDriversUnder25FactorFromScheme(hasAdditionalDrivers, youngestAge, bands);
}

export function minAdditionalDriversLicenseYears(quoteData: QuoteData): number | null {
    const rows = Array.isArray((quoteData as { additionalDrivers?: unknown[] }).additionalDrivers)
        ? (quoteData as { additionalDrivers?: unknown[] }).additionalDrivers || []
        : [];
    const years = rows
        .map((row) => (row && typeof row === 'object' ? (row as { licenseYears?: unknown }).licenseYears : null))
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0);
    if (!years.length) return null;
    return Math.min(...years);
}

type NcdDiscount = { ncb: string; discount: number };

export function protectedNcdPremiumFactor(
    protectNCB: boolean,
    ncb: string,
    discounts: readonly NcdDiscount[],
    protectedFactor: number,
): number {
    if (!protectNCB) return 1.0;
    return ncdDiscountPctFromScheme(ncb, discounts) > 0 ? protectedFactor : 1.0;
}

export function ncdDiscountPctFromScheme(ncb: string, discounts: readonly NcdDiscount[]): number {
    const v = String(ncb || '').trim();
    if (!v) return 0;
    return discounts.find((entry) => entry.ncb === v)?.discount ?? 0;
}

export function vehicleUseFactorFromScheme(use: string, factors: AbbeygateAutoCyprus2022Matrix['factors']['vehicleUse']): number {
    const v = String(use || '').trim();
    return factors[v] ?? factors.default;
}

export function convictionFactorFromScheme(quoteData: QuoteData, scheme: AbbeygateAutoCyprus2022Matrix['factors']['convictions']): number {
    if (!quoteData.hasConvictions) return 1.0;
    const quoteDataExtra = asRecord(quoteData);
    const cls = String(quoteData.convictionClass || '');
    if (cls === 'major') {
        const majorCount = Number(
            quoteDataExtra.majorOffenceCount ??
            quoteDataExtra.majorConvictionsCountLast5Years ??
            quoteDataExtra.majorConvictionCount ??
            1
        );
        const countBand = scheme.majorCountFactors.find((band) => Number.isFinite(majorCount) && majorCount >= band.min);
        if (countBand) return countBand.factor;
        const yrs = Number(quoteData.majorConvictionWithinYears);
        return scheme.majorYearsFactors.find((band) => band.years === yrs)?.factor ?? scheme.classFactors.major ?? scheme.classFactors.default;
    }
    return scheme.classFactors[cls] ?? scheme.classFactors.default;
}

export function claimsFactorFromScheme(quoteData: QuoteData, scheme: AbbeygateAutoCyprus2022Matrix['factors']['claims']): number {
    if (!quoteData.hasClaims) return 1.0;
    const count = Number(quoteData.claimsCountLast5Years);
    const total = Number(quoteData.claimsTotalCostLast5Years);
    const maxFault = Number(quoteData.maxFaultClaimCostLast5Years);
    if (!Number.isFinite(count) || count <= 0) return 1.0;
    if (Number.isFinite(maxFault)) {
        const maximumFaultBand = scheme.maximumFaultBands.find((band) =>
            maxFault > band.minExclusive && (band.maxExclusive === null || maxFault < band.maxExclusive)
        );
        if (maximumFaultBand) return maximumFaultBand.factor;
    }
    const countAndTotalBand = scheme.countAndTotalBands.find((band) =>
        count === band.count && Number.isFinite(total) && (band.inclusive ? total <= band.maxTotal : total < band.maxTotal)
    );
    if (countAndTotalBand) return countAndTotalBand.factor;
    if (count > scheme.overCount.countExclusive) return scheme.overCount.factor;
    return 1.0;
}

// ─── Excess Factor ────────────────────────────────────────────────

export function compExcessFactorFromScheme(_referenceCompExcess: number): number {
    // Peter's approved 2026-09-04 instruction provides no automatic
    // excess-to-discount schedule. A discretionary underwriter discount of
    // up to 20% is applied later through `uwAdjustments`, with a reason; it
    // is not a public-rater factor. Retain this single source for callers
    // that expect an automatic factor and return 1.0 unconditionally.
    return 1.0;
}

// ─── TPL Factor ───────────────────────────────────────────────────

export function tplBasePremiumFromAge(age: number, bands: AbbeygateAutoCyprus2022Matrix['tpl']['ageBands']): number {
    const band = bands.find((entry) => age <= entry.max);
    if (!band) throw new Error(`No configured TPL age band for ${age}.`);
    return band.premium;
}

export function tplMileageFactorFromScheme(_kms: number): number {
    // Per Abbeygate motor rating sheet (Peter Sheppard, 2026-05-15): no
    // mileage loading on TPL. Previously this returned 0.95/1.00/1.05/1.10
    // by annual-km band; that loading is not in the scheme and has been
    // removed. The signature is retained so existing callers compile;
    // it returns 1.0 unconditionally and is a candidate for inlining
    // out of the TPL module once all callers are updated.
    return 1.0;
}

// ─── Named Drivers ────────────────────────────────────────────────

/**
 * Project the canonical `driverRestriction` enum (ABY-232 /
 * ADR-0025) to the two-state pricing basis used by the rating
 * factors:
 *
 *   POLICYHOLDER_ONLY    → NAMED_DRIVERS  (qualifies for −15% discount)
 *   NAMED_DRIVERS        → NAMED_DRIVERS  (qualifies for −15% discount)
 *   ANY_DRIVER_25_PLUS   → OPEN_DRIVERS   (AAD rate, no discount)
 *   ANY_DRIVER_40_PLUS   → OPEN_DRIVERS   (AAD rate, plus 7.5%
 *                                         age-band discount approved
 *                                         by Peter Sheppard on
 *                                         2026-05-19)
 *
 * Legacy quotes (pre-ABY-232) that carry only the old
 * `driverPricingBasis` literal are honoured as a fallback so already
 * persisted policy versions keep rating identically until they are
 * re-rated. Quotes that pre-date both fields default to
 * `NAMED_DRIVERS` (the historical implicit default).
 */
export function resolveDriverPricingBasis(qd: QuoteData): 'NAMED_DRIVERS' | 'OPEN_DRIVERS' {
    const restriction = (qd as QuoteData & { driverRestriction?: string }).driverRestriction;
    if (restriction === 'ANY_DRIVER_25_PLUS' || restriction === 'ANY_DRIVER_40_PLUS') return 'OPEN_DRIVERS';
    if (restriction === 'POLICYHOLDER_ONLY' || restriction === 'NAMED_DRIVERS') return 'NAMED_DRIVERS';
    const legacyBasis = String((qd as QuoteData & { driverPricingBasis?: string }).driverPricingBasis || '').toUpperCase();
    if (legacyBasis === 'OPEN_DRIVERS') return 'OPEN_DRIVERS';
    return 'NAMED_DRIVERS';
}

export function namedDriversDiscountFactor(basis: 'NAMED_DRIVERS' | 'OPEN_DRIVERS', namedDriversFactor: number): number {
    return basis === 'NAMED_DRIVERS' ? namedDriversFactor : 1.0;
}

export function openDriverAgeBandDiscountFactor(driverRestriction: unknown, anyDriver40PlusFactor: number): number {
    return driverRestriction === 'ANY_DRIVER_40_PLUS' ? anyDriver40PlusFactor : 1.0;
}

export function maxAdditionalDriverAge(quoteData: QuoteData, getAgeFn: (dob: string) => number): number | null {
    const rows = Array.isArray((quoteData as { additionalDrivers?: unknown[] }).additionalDrivers)
        ? (quoteData as { additionalDrivers?: unknown[] }).additionalDrivers || []
        : [];
    const ages = rows
        .map((row) => (row && typeof row === 'object' ? (row as { dateOfBirth?: unknown }).dateOfBirth : null))
        .map((dob) => (dob ? getAgeFn(String(dob)) : Number.NaN))
        .filter((value) => Number.isFinite(value) && value > 0);
    if (!ages.length) return null;
    return Math.max(...ages);
}

// ─── Motorcycle Factor Tables ─────────────────────────────────────

export type MotorcycleBandEntry = { maxCc: number; premium: number };

export function motorcycleBasePremiumFromMatrix(engineSize: number, bands: readonly MotorcycleBandEntry[]): number {
    const found = bands.find((b) => engineSize <= b.maxCc);
    return found ? found.premium : bands[bands.length - 1]!.premium;
}

export function motorcycleRiderAgeFactorFromWorkbook(ridersAge: number, bands: AbbeygateAutoCyprus2022Matrix['motorcycle']['riderAgeFactors']): number {
    if (!Number.isFinite(ridersAge) || ridersAge <= 0) return 1.0;
    return factorForBand(ridersAge, bands);
}

export function motorcycleNcdFactorFromWorkbook(ncb: string, factors: AbbeygateAutoCyprus2022Matrix['motorcycle']['ncdFactors']): number {
    const v = String(ncb || '').trim();
    return factors[v] ?? factors.default;
}

export function motorcycleCountryFactorFromWorkbook(countryRaw: string, factors: AbbeygateAutoCyprus2022Matrix['motorcycle']['countryFactors']): number {
    return factors[normalizeCountryValue(countryRaw)] ?? factors.default;
}

export function motorcycleFixedFeeFromWorkbook(countryRaw: string, fees: AbbeygateAutoCyprus2022Matrix['motorcycle']['fixedFees']): number {
    return fees[normalizeCountryValue(countryRaw)] ?? fees.default;
}

// ─── Matrix Lookups ───────────────────────────────────────────────

export function parseEngineBand(
    engineSize: number,
    bands: readonly string[],
    options: { unmatched: 'first' | 'throw' } = { unmatched: 'first' },
): number {
    for (let i = 0; i < bands.length; i++) {
        const s = String(bands[i]).trim();
        if (/^Over\s+\d+$/i.test(s)) {
            const min = parseInt(s.replace(/[^0-9]/g, ''), 10);
            if (engineSize > min) return i;
        } else if (s.includes('-')) {
            const parts = s.replace(/\s/g, '').split('-');
            const min = parseInt(parts[0], 10);
            const max = parseInt(parts[1], 10);
            if (engineSize >= min && engineSize <= max) return i;
        }
    }
    if (options.unmatched === 'throw') {
        throw new Error(`No engine-capacity band is configured for ${engineSize}cc.`);
    }
    return 0;
}

export function lookupBasePremiumFromMatrix(
    engineSize: number,
    vehicleValue: number,
    matrix: {
        engineSizeBands: readonly string[];
        vehicleValueBands: readonly number[];
        values: readonly (readonly number[])[];
    },
    options?: { bumpEngineBands?: number }
): number {
    const x = matrix.vehicleValueBands;
    const baseYIdx = parseEngineBand(engineSize, matrix.engineSizeBands);
    // Cabriolet/convertible scheme rule: rate one engine band higher
    // (clamped to the top of the matrix). Callers supply the bump count;
    // 0 means "no bump", 1 means "one band up", etc.
    const bump = Math.max(0, Math.trunc(options?.bumpEngineBands ?? 0));
    const maxYIdx = matrix.values.length - 1;
    const yIdx = Math.min(maxYIdx, baseYIdx + bump);
    if (!Number.isFinite(vehicleValue) || vehicleValue <= 0) return matrix.values[yIdx][0];
    let xIdx = x.findIndex((v) => vehicleValue <= v);
    if (xIdx === -1) xIdx = x.length - 1;
    return matrix.values[yIdx][xIdx];
}

// ─── Policy Term ──────────────────────────────────────────────────

export function resolveTermFactor(quoteDataExtra: UnknownRecord, policyTerm: AbbeygateAutoCyprus2022Matrix['factors']['policyTerm']): { termMonths: number; termFactor: number } {
    const termMonthsRaw = Number(quoteDataExtra.__mbePolicyTermMonths ?? quoteDataExtra.policyTermMonths);
    const termMonths =
        Number.isFinite(termMonthsRaw) && termMonthsRaw > 0
            ? termMonthsRaw
            : String(quoteDataExtra.policyTerm || '').toLowerCase().includes('6')
                ? 6
                : 12;
    const termFactor = termMonths <= policyTerm.shortTermMaxMonths ? policyTerm.shortTermFactor : 1.0;
    return { termMonths, termFactor };
}

// ─── UW Adjustments ──────────────────────────────────────────────

export function clampAbs(n: number, maxAbs: number): number {
    if (!Number.isFinite(n)) return 0;
    const m = Math.abs(maxAbs);
    if (!Number.isFinite(m) || m <= 0) return 0;
    return Math.max(-m, Math.min(m, n));
}

export function resolveUwAdjustmentPctCap(configuredCap: number): number {
    if (!Number.isFinite(configuredCap) || configuredCap <= 0 || configuredCap > 100) {
        throw new Error('Motor programme UW adjustment cap is invalid.');
    }
    return configuredCap;
}
