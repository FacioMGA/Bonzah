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

export function proposerAgeFactorFromScheme(age: number): number {
    // Abbeygate motor workbook proposer-age ladder.
    if (!Number.isFinite(age) || age <= 0) return 1.0;
    if (age >= 80) return 1.2;
    if (age > 40) return 0.9;
    if (age > 30) return 1.0;
    if (age >= 28 && age <= 30) return 1.12;
    if (age >= 26 && age <= 27) return 1.175;
    if (age === 25) return 1.2255;
    if (age === 24) return 2.75;
    if (age === 23) return 3.0;
    if (age === 22) return 3.25;
    if (age === 21) return 4.0;
    if (age < 21) return 5.0;
    return 1.0;
}

export function vehicleAgeFactorFromMatrix(vehicleYear: number): number {
    const nowYear = new Date().getFullYear();
    if (!Number.isFinite(vehicleYear) || vehicleYear <= 0) return 1.0;
    const ageYears = Math.max(0, nowYear - vehicleYear);
    if (ageYears <= 5) return 1.0;
    if (ageYears <= 10) return 0.9; // 6-10 years
    return 0.875; // >10 years (11+)
}

export function licencePeriodFactorFromScheme(licenseYears: number): number {
    // Scheme: <1y +25%, 1y+ but <2y +10%, 2y+ rate
    if (!Number.isFinite(licenseYears) || licenseYears < 0) return 1.0;
    if (licenseYears < 1) return 1.25;
    if (licenseYears < 2) return 1.1;
    return 1.0;
}

export function addedDriversUnder25FactorFromScheme(hasAdditionalDrivers: boolean, youngestAge: number): number {
    if (!hasAdditionalDrivers) return 1.0;
    if (!Number.isFinite(youngestAge)) return 1.0;
    if (youngestAge === 21) return 3.0;
    if (youngestAge === 22) return 2.5;
    if (youngestAge === 23) return 2.25;
    if (youngestAge === 24) return 1.9;
    return 1.0;
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
): number {
    if (driverRestriction && driverRestriction !== 'NAMED_DRIVERS') return 1.0;
    return addedDriversUnder25FactorFromScheme(hasAdditionalDrivers, youngestAge);
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

export function protectedNcdPremiumFactor(protectNCB: boolean, ncb: string): number {
    // +10% of gross premium when NCD protection is selected and there is NCD to protect.
    // Motorcycles do not carry NCD on this scheme (ncdDiscountPctFromScheme returns 0 for them).
    if (!protectNCB) return 1.0;
    return ncdDiscountPctFromScheme(ncb) > 0 ? 1.1 : 1.0;
}

export function ncdDiscountPctFromScheme(ncb: string): number {
    const v = String(ncb || '').trim();
    if (!v || v === 'None') return 0;
    if (v === '1 Year') return 0.30;
    if (v === '2 Years') return 0.40;
    if (v === '3 Years') return 0.50;
    if (v === '4 Years') return 0.60;
    if (v === '5+ Years') return 0.65;
    return 0;
}

export function vehicleUseFactorFromScheme(use: string): number {
    const v = String(use || '').trim();
    if (v === 'Class 2') return 1.15; // +15%
    if (v === 'Class 3') return 1.40; // +40%
    // Private / SD&P / Class 1 are standard
    return 1.0;
}

export function convictionFactorFromScheme(quoteData: QuoteData): number {
    if (!quoteData.hasConvictions) return 1.0;
    const quoteDataExtra = asRecord(quoteData);
    const cls = String(quoteData.convictionClass || '');
    if (cls === 'minor_technical') return 1.0;
    if (cls === 'minor_offence_10') return 1.1;
    if (cls === 'minor_offence_225') return 1.225;
    if (cls === 'serious_technical') {
        // Rating guide: +15% for one serious technical offence.
        // Two or more are referred (no additional load — UW automation handles the referral).
        return 1.15;
    }
    if (cls === 'major') {
        const majorCount = Number(
            quoteDataExtra.majorOffenceCount ??
            quoteDataExtra.majorConvictionsCountLast5Years ??
            quoteDataExtra.majorConvictionCount ??
            1
        );
        if (Number.isFinite(majorCount) && majorCount >= 3) return 5.0;
        if (Number.isFinite(majorCount) && majorCount >= 2) return 2.5;
        const yrs = Number(quoteData.majorConvictionWithinYears);
        if (yrs === 2) return 1.5;
        if (yrs === 3) return 1.25;
        if (yrs === 5) return 1.15;
        return 1.15;
    }
    return 1.0;
}

export function claimsFactorFromScheme(quoteData: QuoteData): number {
    if (!quoteData.hasClaims) return 1.0;
    const count = Number(quoteData.claimsCountLast5Years);
    const total = Number(quoteData.claimsTotalCostLast5Years);
    const maxFault = Number(quoteData.maxFaultClaimCostLast5Years);
    if (!Number.isFinite(count) || count <= 0) return 1.0;
    if (Number.isFinite(maxFault)) {
        if (maxFault > 100_000) return 4.0; // +300%
        if (maxFault > 50_000 && maxFault < 100_000) return 2.5; // +150%
    }
    // Incident up to 3k no load
    if (count === 1 && Number.isFinite(total) && total <= 3_000) return 1.0;
    if (count === 1 && Number.isFinite(total) && total > 3_000 && total < 50_000) return 1.2; // +20%
    if (count === 2 && Number.isFinite(total) && total < 50_000) return 1.35; // +35%
    if (count === 3 && Number.isFinite(total) && total < 50_000) return 1.5; // +50%
    if (count > 3) return 3.0; // +200% (note: automation may decline >3)
    return 1.0;
}

// ─── Excess Factor ────────────────────────────────────────────────

export function compExcessFactorFromScheme(_referenceCompExcess: number): number {
    // Per Abbeygate motor rating sheet (Peter Sheppard, 2026-05-15): the
    // scheme does not offer excess-reduction discounts on the online
    // product (no -2.5%/-7.5%/-12.5%/-17.5% tiers for higher excesses,
    // no +5% loading for sub-€250 excesses). The minimum policy excess
    // is enforced upstream via `computeDeclaredValueBasedExcess`.
    // Function retained as a single-source factor for callers that
    // already expect it; returns 1.0 unconditionally.
    return 1.0;
}

// ─── TPL Factor ───────────────────────────────────────────────────

export function tplBasePremiumFromAge(age: number): number {
    if (age <= 24) return 240;
    if (age <= 35) return 180;
    if (age <= 55) return 150;
    return 170; // 56+
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

export function namedDriversDiscountFactor(basis: 'NAMED_DRIVERS' | 'OPEN_DRIVERS'): number {
    return basis === 'NAMED_DRIVERS' ? 0.85 : 1.0;
}

export function openDriverAgeBandDiscountFactor(driverRestriction: unknown): number {
    return driverRestriction === 'ANY_DRIVER_40_PLUS' ? 0.925 : 1.0;
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

export function motorcycleRiderAgeFactorFromWorkbook(ridersAge: number): number {
    // Abbeygate motor scheme motorcycle rider age ladder.
    if (!Number.isFinite(ridersAge) || ridersAge <= 0) return 1.0;
    if (ridersAge >= 46) return 0.875; // -12.5%
    if (ridersAge >= 31) return 1.0;   // standard rate (31–45)
    if (ridersAge >= 27) return 2.5;   // +150% (27–30)
    if (ridersAge >= 25) return 4.0;   // +300% (25–26)
    return 1.0;                        // under 25 — no-quote handled by UW automation
}

export function motorcycleNcdFactorFromWorkbook(ncb: string): number {
    const v = String(ncb || '').trim();
    if (v === '1 Year') return 0.7;
    if (v === '2 Years') return 0.6;
    if (v === '3 Years') return 0.5;
    if (v === '4 Years') return 0.4;
    if (v === '5+ Years') return 0.35;
    return 1.0;
}

export function motorcycleCountryFactorFromWorkbook(countryRaw: string): number {
    const country = String(countryRaw || '').toLowerCase();
    if (country.includes('spain') || country === 'es' || country === 'esp') return 1.083;
    if (country.includes('portugal') || country === 'pt' || country === 'prt') return 1.129;
    return 1.0;
}

export function motorcycleFixedFeeFromWorkbook(countryRaw: string): number {
    const country = String(countryRaw || '').toLowerCase();
    return country.includes('cyprus') || country === 'cy' || country === 'cyp' ? 99 : 97;
}

export function motorcycleCompExcessFromWorkbook(engineSize: number): number {
    if (!Number.isFinite(engineSize) || engineSize <= 0) return 500;
    if (engineSize <= 100) return 150;
    if (engineSize <= 250) return 250;
    if (engineSize <= 500) return 350;
    if (engineSize <= 900) return 400;
    return 500;
}

// ─── Matrix Lookups ───────────────────────────────────────────────

export function parseEngineBand(engineSize: number, bands: readonly string[]): number {
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

export function resolveTermFactor(quoteDataExtra: UnknownRecord): { termMonths: number; termFactor: number } {
    const termMonthsRaw = Number(quoteDataExtra.__mbePolicyTermMonths ?? quoteDataExtra.policyTermMonths);
    const termMonths =
        Number.isFinite(termMonthsRaw) && termMonthsRaw > 0
            ? termMonthsRaw
            : String(quoteDataExtra.policyTerm || '').toLowerCase().includes('6')
                ? 6
                : 12;
    const termFactor = termMonths <= 6 ? 0.6 : 1.0;
    return { termMonths, termFactor };
}

// ─── Tax & Charges ────────────────────────────────────────────────

export function resolveGovernmentTax(termMonths: number): number {
    // Deprecated: use calculateMotorTaxes() with CY_MOTOR_ABBEYGATE_CURRENT.
    return termMonths === 6 ? 4.5 : 9.0;
}

export function resolveStampDuty(inceptionDate: Date): number {
    // Deprecated: use calculateMotorTaxes() with CY_MOTOR_ABBEYGATE_CURRENT.
    // Stamp duty removed from 1 Jan 2026
    return inceptionDate.getFullYear() >= 2026 ? 0 : 2.0;
}

// ─── UW Adjustments ──────────────────────────────────────────────

export function clampAbs(n: number, maxAbs: number): number {
    if (!Number.isFinite(n)) return 0;
    const m = Math.abs(maxAbs);
    if (!Number.isFinite(m) || m <= 0) return 0;
    return Math.max(-m, Math.min(m, n));
}

export function resolveUwAdjustmentPctCap(quoteData: QuoteData): number {
    const configured = Number((quoteData as QuoteData & { uwAdjustmentPctCap?: number }).uwAdjustmentPctCap);
    if (!Number.isFinite(configured) || configured <= 0) return 20;
    return Math.min(configured, 100);
}
