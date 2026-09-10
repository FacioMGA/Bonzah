import type { PremiumCalculation } from '../../../platform/types/index.js';
import type { CalculationStep } from '../../../platform/types/pricing.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { resolveJurisdictionProductConfig } from '../../../modules/jurisdiction/domain/productConfiguration.js';
import { getTravelAddonLabel, isTravelDestinationArea } from '@facio/products';
import { calculateTravelTaxes } from './travelTaxes.js';
import { resolveTravelAdminFeeFromBands } from './data/travel-fee-bands.loader.js';
import {
  ADDON_KEYS,
  resolveAgeBand,
  resolveDayBand,
  type AddonKey,
  type AddonConfig,
  type TravelPlan,
  type TripType,
  type AreaOfCover,
  type CoverType,
} from './data/loader.js';
import type { TravelRatingTables } from './programRatingModel.js';

/**
 * Thrown when input data is too malformed to price (invalid DOB,
 * invalid trip dates, missing maxTripDays for a multi-trip policy).
 *
 * Per ADR-0018, the calculator must surface the error rather than
 * silently substituting a default age / duration / band. Upstream
 * validation should reject these inputs before the calculator is
 * called; this class exists so the failure mode is explicit when it
 * does reach the pricing layer (e.g. via BDX import or a partially
 * validated wizard payload).
 */
export class TravelQuoteValidationError extends Error {
  readonly code: 'INVALID_DOB' | 'INVALID_TRIP_DATES' | 'MISSING_MAX_TRIP_DAYS';
  constructor(code: 'INVALID_DOB' | 'INVALID_TRIP_DATES' | 'MISSING_MAX_TRIP_DAYS', message: string) {
    super(message);
    this.name = 'TravelQuoteValidationError';
    this.code = code;
  }
}

export const TRAVEL_CALCULATOR_VERSION = 'travel@1.1.0';

export interface TravelQuoteData {
  eligibility?: {
    countryOfResidence?: string;
    /**
     * `isExpat` is preserved on the canonical shape for BDX/audit but,
     * per ADR-0025, is a DERIVED outcome of the seven objective answers
     * below — not a customer-input boolean. The wizard no longer asks
     * for it; UW automation writes it into the quote record.
     */
    isExpat?: boolean;
    nationality?: string;
    hasOtherNationality?: boolean;
    otherNationality?: string;
    /** Captured for audit only — Peter 2026-05-16 directs no UW gating. */
    residenceDuration?: 'lt_1_year' | '1_3_years' | 'gt_3_years';
    /** Captured for audit only — Peter 2026-05-16 directs no UW gating. */
    residencyStatus?: 'permanent_resident' | 'temporary_resident' | 'work_visa' | 'student_visa' | 'visitor' | 'other_visa';
    willRemainResident?: boolean;
    legallyPermittedToReside?: boolean;
    informationAccurate?: boolean;
    /** Existing Lloyd's 6-month / English-language declaration. */
    legalAgreement?: boolean;
  };
  travellers?: { coverType?: string; travellerCount?: number; leadTravellerDOB?: string; additionalTravellerDOBs?: string[] };
  trip?: { planType?: string; destinations?: string[]; startDate?: string; endDate?: string };
  /**
   * `selectedPlan` — which tier (silver/gold/platinum) to price.
   * `maxTripDays` — for annual/multi-trip policies only: the maximum number of days
   *   allowed per individual trip (e.g. 17, 31 or 45). Drives the rate-table day-band
   *   lookup instead of the single-trip start/end date duration.
   */
  quote?: { selectedPlan?: string; maxTripDays?: number };
  addons?: Record<string, boolean>;
  /**
   * Prior travel-claims history (ADR-0054). `hasPreviousTravelClaim` gates
   * the question; `previousTravelClaimBand` drives the rating decision —
   * `up_to_500` applies a 15% base-premium loading, `over_500` refers the
   * quote (no auto price). Absent = no previous claim = no loading.
   */
  risk?: {
    hasPreviousTravelClaim?: boolean;
    previousTravelClaimBand?: 'up_to_500' | 'over_500';
  };
}

/**
 * Canonical ordered breakdown of a travel quote — the single source of
 * truth for every customer- and operator-facing surface that displays
 * how the premium was assembled.
 *
 * ABY-264 — consumers (wizard sidebar across all steps, payment-step
 * order summary, BO Premium tab, PDF schedule) MUST iterate this array
 * instead of re-deriving labels or order from `addonBreakdown` /
 * `quoteData.addons` / endorsement templates. The calculator is the
 * only writer; everyone else is a reader. Per ADR-0011 and
 * `docs/architecture/contracts/canonical-ownership.md`, drift on this
 * shape would land an admin-fee line on one surface but not another —
 * which is exactly the customer complaint that produced ABY-264.
 *
 * Order is fixed: `base` → `addon` (in catalogue order) → `tax`
 * (each levy) → `fee` (admin / stamp / etc.) → `total`. Consumers
 * that need to render only a sub-section can filter on `kind`.
 */
export type TravelBreakdownLineKind = 'base' | 'addon' | 'loading' | 'discount' | 'tax' | 'fee' | 'total';

export interface TravelBreakdownLine {
  /** Stable machine identifier (e.g. `base`, `addon.businessCover`, `loading.uwProfit`, `tax.ipt`, `fee.admin`, `total`). */
  code: string;
  /** Customer-facing label (e.g. "Base premium", "Business Cover", "Premium adjustment", "Admin fee", "Total"). */
  label: string;
  /**
   * Amount in the quote currency. Positive for every calculator-emitted
   * line; `discount` lines (ADR-0056 declared-premium alignment on
   * BDX-imported policies) are the one negative case. `0` lines are omitted.
   */
  amount: number;
  /** Bucket kind so consumers can group/style without parsing `code`. */
  kind: TravelBreakdownLineKind;
}

export interface TravelBreakdown {
  basePremium: number;
  addonsTotal: number;
  addonBreakdown: Record<string, number>;
  /**
   * Underwriting profit loading (ADR-0035) — the margin amount applied
   * to `basePremium + addonsTotal` before tax and admin fee. Keep on
   * the breakdown so BO Premium, schedule PDF and BDX can reconstruct
   * the loaded vs unloaded identity without re-running the rate JSON.
   */
  uwProfitLoading: number;
  /**
   * Prior travel-claim loading (ADR-0054) — 15% of base premium when the
   * customer declared a previous travel claim of up to €500. Folded into
   * `netPremium` before the underwriting profit loading. `0` when no claim
   * was declared. An over-€500 claim never reaches here (it refers).
   */
  claimsLoading: number;
  /**
   * `base + addons + claimsLoading + uwProfitLoading` — i.e. the loaded
   * net premium that the tax engine and admin-fee band lookup both see.
   * Per ADR-0035 the admin band is resolved against this loaded value
   * (a 2 % loading can cross e.g. the €70 boundary, which is what the
   * underwriter workbook expects); ADR-0054 folds the prior-claim loading
   * in before the underwriting profit loading.
   */
  netPremium: number;
  iptAmount: number;
  adminFee: number;
  grossPremium: number;
  /** Canonical ordered breakdown for display. See `TravelBreakdownLine` doc. */
  lines: TravelBreakdownLine[];
}

/**
 * Add-on pricing is JSON-driven. Per the BRIT Travel Sept 2025 active-sale
 * sheet (Andy 2026-05-16), each add-on declares a `singleTrip` and
 * `multiTrip` rule:
 *   - `loadPercent`: amount = basePremium × value (winter-sports
 *     single-trip 100% load).
 *   - `perTraveller`: amount = travellerCount × value.
 *
 * No inline multiplier table — `check-no-inline-rate-tables.mjs`
 * forbids that pattern; pricing data lives in
 * `data/brit-travel-2025.json`.
 */
function calculateAddonAmount(
  config: AddonConfig,
  tripType: TripType,
  basePremium: number,
  travellerCount: number,
): number {
  const rule = tripType === 'Multi trip' ? config.multiTrip : config.singleTrip;
  if (rule.kind === 'loadPercent') {
    return Number((basePremium * rule.value).toFixed(2));
  }
  // perTraveller
  return Number((travellerCount * rule.value).toFixed(2));
}

function isAddonKey(name: string): name is AddonKey {
  return (ADDON_KEYS as readonly string[]).includes(name);
}

function defaultTravellerCountForCoverType(raw: string): number {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'couple') return 2;
  if (normalized === 'family') return 3;
  if (normalized === 'single_parent_family' || normalized === 'single parent family') return 3;
  return 1;
}

function travellerCountFromInput(travellers: TravelQuoteData['travellers']): number {
  const coverType = String(travellers?.coverType || 'single');
  const minimum = defaultTravellerCountForCoverType(coverType);
  const requested = Number(travellers?.travellerCount);
  if (!Number.isFinite(requested) || requested < minimum) return minimum;
  return Math.max(minimum, Math.floor(requested));
}

// Destination groupings derived from the rate table's area codes.
const EXCLUDED_DESTINATIONS = new Set(['Cuba', 'Iran', 'North Korea']);
const US_LIKE = new Set(['USA', 'United States', 'Canada', 'Mexico', 'Caribbean']);

const TRAVEL_AREA_VALUE_TO_RATE_AREA: Record<string, AreaOfCover> = {
  europe: 'Europe',
  worldwide_excluding_usa_canada: 'Worldwide excl',
  worldwide_including_usa_canada: 'WorldwideInc',
};

function mapDestinationsToArea(destinations: string[]): AreaOfCover {
  const d = destinations.map((x) => String(x || '').trim());
  const selectedArea = d.find(isTravelDestinationArea);
  if (selectedArea) return TRAVEL_AREA_VALUE_TO_RATE_AREA[selectedArea];
  const includesUs = d.some((x) => US_LIKE.has(x));
  if (includesUs) return 'WorldwideInc';
  // Europe shortlist — if everything is in the Europe set, Europe; else WW excl.
  const EUROPE = new Set([
    'Cyprus','Greece','Spain','Portugal','Italy','France','Germany','Belgium','Netherlands','Austria',
    'Switzerland','UK','United Kingdom','Ireland','Sweden','Norway','Denmark','Finland','Malta','Poland','Czechia',
  ]);
  const allEurope = d.length > 0 && d.every((x) => EUROPE.has(x));
  if (allEurope) return 'Europe';
  return 'Worldwide excl';
}

function normalizeCoverType(raw: string): CoverType {
  const x = String(raw || '').toLowerCase();
  if (x === 'couple') return 'Couple';
  if (x === 'family') return 'Family';
  // The Brit Sept 2025 worksheet has no separate Single parent family row.
  // It is rated on the Family row, with travellerCount still controlling add-ons.
  if (x === 'single_parent_family' || x === 'single parent family') return 'Family';
  return 'Individual';
}

function normalizePlan(raw: string): TravelPlan {
  const x = String(raw || '').toLowerCase();
  if (x === 'gold') return 'gold';
  if (x === 'platinum') return 'platinum';
  return 'silver';
}

function normalizeTripType(raw: string): TripType {
  const x = String(raw || '').toLowerCase();
  return x === 'annual_multi_trip' || x === 'multi_trip' || x === 'multi trip' ? 'Multi trip' : 'Single trip';
}

function ageFromDOB(dob: string): number {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) {
    // ADR-0018: no silent default. Invalid DOB is a validation error,
    // not an "assume 30" fallback.
    throw new TravelQuoteValidationError(
      'INVALID_DOB',
      `Invalid lead-traveller date of birth: '${String(dob || '')}'.`,
    );
  }
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
  return age;
}

function oldestTravellerAge(travellers: TravelQuoteData['travellers']): number {
  const dobValues = [
    String(travellers?.leadTravellerDOB || ''),
    ...(Array.isArray(travellers?.additionalTravellerDOBs) ? travellers?.additionalTravellerDOBs || [] : []),
  ].filter((dob) => String(dob || '').trim());
  const ages = dobValues.map((dob) => ageFromDOB(String(dob)));
  return Math.max(...ages);
}

function tripDurationDays(startIso: string, endIso: string): number {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    // ADR-0018: no silent default. Invalid trip dates are a validation
    // error, not an "assume 9 days" fallback.
    throw new TravelQuoteValidationError(
      'INVALID_TRIP_DATES',
      `Invalid trip dates: start='${String(startIso || '')}', end='${String(endIso || '')}'.`,
    );
  }
  return Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)));
}

function resolveMaxTripDays(quote: TravelQuoteData['quote']): number {
  const raw = Number(quote?.maxTripDays);
  if (!Number.isFinite(raw) || raw <= 0) {
    // ADR-0018: multi-trip policies MUST declare maxTripDays. No silent
    // 17-day default.
    throw new TravelQuoteValidationError(
      'MISSING_MAX_TRIP_DAYS',
      'Multi-trip travel quote requires `quote.maxTripDays` (positive integer).',
    );
  }
  return raw;
}

export function calculateTravelPremium(data: TravelQuoteData, ratingTables: TravelRatingTables): { premium: PremiumCalculation; breakdown: TravelBreakdown; refer: boolean; reason?: string; declined: boolean; declineReason?: string } {
  const tenant = getTenantConfig();
  // ADR-0024: customer-declared `eligibility.countryOfResidence` drives
  // the resolved Travel tax jurisdiction. Tenant remains the operating
  // identity (admin fee, currency, BDX migration) — only the regulatory
  // tax dimension flips per quote.
  const jurisdictionConfig = resolveJurisdictionProductConfig({
    productCode: 'TRAVEL',
    tenant,
    customerCountryOfResidence: data.eligibility?.countryOfResidence ?? null,
  });
  const plan = normalizePlan(String(data.quote?.selectedPlan || 'silver'));
  const tripType = normalizeTripType(String(data.trip?.planType || 'single_trip'));
  const destinations = Array.isArray(data.trip?.destinations) ? data.trip!.destinations! : [];

  if (destinations.some((x) => EXCLUDED_DESTINATIONS.has(x))) {
    return {
      premium: {
        premium: 0, basis: 'HYBRID',
        calculationDetails: {
          steps: [{ id: 'travel.declined.excludedDestination', name: 'Declined: excluded destination', kind: 'total', output: 0, inputs: { destinations } }],
          calculatorVersion: TRAVEL_CALCULATOR_VERSION,
        },
      },
      breakdown: zeroBreakdown(),
      refer: false,
      declined: true,
      declineReason: 'Destination includes an excluded country (Cuba, Iran, or North Korea)',
    };
  }

  // ADR-0054 — a declared previous travel claim OVER €500 is a hard
  // referral: the platform does not auto-offer a price it will not stand
  // behind. Mirrors the age-band REFER path — no rate lookup, no auto
  // price. The customer-facing referral copy is owned by
  // `travelUwAutomation.ts`.
  if (data.risk?.hasPreviousTravelClaim === true && data.risk.previousTravelClaimBand === 'over_500') {
    return {
      premium: {
        premium: 0, basis: 'HYBRID',
        calculationDetails: {
          steps: [{ id: 'travel.refer.priorClaim', name: 'Refer: prior travel claim over threshold', kind: 'total', output: 0, inputs: { previousTravelClaimBand: 'over_500' } }],
          calculatorVersion: TRAVEL_CALCULATOR_VERSION,
        },
      },
      breakdown: zeroBreakdown(),
      refer: true,
      reason: 'Prior travel claim over €500 requires manual underwriting review',
      declined: false,
    };
  }

  const steps: CalculationStep[] = [];

  const area = mapDestinationsToArea(destinations);
  const coverType = normalizeCoverType(String(data.travellers?.coverType || 'single'));

  // For annual/multi-trip policies, the pricing day-band represents the maximum
  // number of days allowed per individual trip (a policy parameter chosen by the
  // customer), NOT the duration of the specific trip being quoted.  For single
  // trips, we derive it from the start/end dates as before.
  const days =
    tripType === 'Multi trip'
      ? resolveMaxTripDays(data.quote)
      : tripDurationDays(String(data.trip?.startDate || ''), String(data.trip?.endDate || ''));
  const dayBand = resolveDayBand(days);
  const age = oldestTravellerAge(data.travellers);
  const ageBand = resolveAgeBand(age);

  if (days > 62 && tripType === 'Single trip') {
    return {
      premium: {
        premium: 0, basis: 'HYBRID',
        calculationDetails: {
          steps: [{ id: 'travel.refer.maxDays', name: 'Refer: trip exceeds single-trip max', kind: 'total', output: 0, inputs: { days, cap: 62 } }],
          calculatorVersion: TRAVEL_CALCULATOR_VERSION,
        },
      },
      breakdown: zeroBreakdown(),
      refer: true,
      reason: `Trip duration ${days} days exceeds single-trip matrix (max 62)`,
      declined: false,
    };
  }

  // Single Trip: the BRIT Sept 2025 sheet only carries Individual rows.
  // Per Andrew Francis 2026-05-18, Couple / Family Single Trip pricing is
  // the Individual rate scaled by `singleTripCoverMultipliers` from the
  // canonical JSON. Multi Trip retains direct cover-type-specific rate
  // cells and does NOT apply the multiplier.
  const lookupCoverType: CoverType = tripType === 'Single trip' ? 'Individual' : coverType;
  const singleTripMultiplier = tripType === 'Single trip'
    ? ratingTables.rateCard.singleTripCoverMultipliers[coverType === 'Couple' ? 'Couple' : coverType === 'Family' ? 'Family' : 'Individual']
    : 1;
  const rateKey = `${plan}|${tripType}|${area}|${lookupCoverType}|${dayBand}|${ageBand}`;
  const rate = ratingTables.rateCard.rates[rateKey] ?? null;
  if (rate === null) {
    return {
      premium: {
        premium: 0, basis: 'HYBRID',
        calculationDetails: {
          steps: [{ id: 'travel.refer.noRate', name: 'Refer: no rate cell', kind: 'total', output: 0,
            inputs: { plan, tripType, area, coverType, lookupCoverType, dayBand, ageBand } }],
          calculatorVersion: TRAVEL_CALCULATOR_VERSION,
        },
      },
      breakdown: zeroBreakdown(),
      refer: true,
      reason: `No rate cell available for ${plan}/${tripType}/${area}/${lookupCoverType}/${dayBand}d/${ageBand}`,
      declined: false,
    };
  }
  if (rate === 'REFER') {
    return {
      premium: {
        premium: 0, basis: 'HYBRID',
        calculationDetails: {
          steps: [{ id: 'travel.refer.age', name: 'Refer: age band needs review', kind: 'total', output: 0, inputs: { ageBand } }],
          calculatorVersion: TRAVEL_CALCULATOR_VERSION,
        },
      },
      breakdown: zeroBreakdown(),
      refer: true,
      reason: `Age band ${ageBand} requires manual review`,
      declined: false,
    };
  }

  const basePremium = Number((rate * singleTripMultiplier).toFixed(2));
  const travellerCount = travellerCountFromInput(data.travellers);
  steps.push({
    id: 'travel.base', name: 'Base premium', kind: 'table_lookup',
    inputs: { plan, tripType, area, coverType, lookupCoverType, dayBand, ageBand, individualRate: rate, singleTripMultiplier },
    output: basePremium,
  });

  const addonBreakdown: Record<string, number> = {};
  // ABY-264 — record the per-addon lines in canonical catalogue order so
  // `breakdown.lines` (rendered by wizard / BO / PDF) has a stable
  // ordering that matches every other surface (Step 5 option cards, PDF
  // schedule "Optional Extensions" list). Iterating `data.addons` in
  // insertion order would produce different orders on different
  // surfaces — that was the root drift behind the original ABY-241/242.
  const selectedAddonOrder: AddonKey[] = [];
  let addonsTotal = 0;
  for (const name of ADDON_KEYS) {
    if (!data.addons?.[name]) continue;
    if (!isAddonKey(name)) continue;
    const config = ratingTables.rateCard.addons[name];
    const amount = calculateAddonAmount(config, tripType, basePremium, travellerCount);
    if (amount <= 0) continue;
    addonBreakdown[name] = amount;
    addonsTotal += amount;
    selectedAddonOrder.push(name);
    const rule = tripType === 'Multi trip' ? config.multiTrip : config.singleTrip;
    steps.push({
      id: `travel.addon.${name}`,
      name: getTravelAddonLabel(name),
      kind: 'fee',
      amount,
      inputs: { travellerCount, tripType, kind: rule.kind, value: rule.value },
    });
  }
  // ADR-0035 — Underwriting profit loading. The BRIT Travel binder
  // ships a flat margin applied to `basePremium + addonsTotal`. We
  // resolve the rate from JSON (no `.ts` literal — single-source
  // remains intact) and emit it BOTH as a calculation step (so BDX /
  // audit can reconstruct loaded vs unloaded) and as a dedicated
  // breakdown line (so wizard sidebar, payment step, BO Premium tab
  // and PDF schedule render it the same way per ADR-0031). The admin
  // fee band is then resolved against the *loaded* net premium —
  // that's the workbook's intent and is what makes row 9 platinum /
  // row 16 silver cross the €70 boundary.
  // ADR-0054 — prior travel-claim loading. A declared previous claim of
  // up to €500 loads the base premium by `priorClaimLoading.upTo500Rate`
  // (15%). The line is folded into the net premium BEFORE the underwriting
  // profit loading, so the UW margin, tax and admin-fee band all cascade
  // on top of it (mirrors the compounding order in ADR-0052 Home). Over
  // €500 already referred above. No claim → 0. Rate is JSON-driven — no
  // `.ts` literal (`check-no-inline-rate-tables.mjs`).
  const claimsLoading =
    data.risk?.hasPreviousTravelClaim === true && data.risk.previousTravelClaimBand === 'up_to_500'
      ? Number((basePremium * ratingTables.rateCard.priorClaimLoading.upTo500Rate).toFixed(2))
      : 0;
  if (claimsLoading > 0) {
    steps.push({
      id: 'travel.claimsLoading',
      name: 'Claims history loading',
      kind: 'factor',
      amount: claimsLoading,
      factor: ratingTables.rateCard.priorClaimLoading.upTo500Rate,
      inputs: { appliesTo: ratingTables.rateCard.priorClaimLoading.appliesTo, base: basePremium, band: 'up_to_500', source: 'program-rating-model.priorClaimLoading' },
    });
  }

  const uwProfitLoadingConfig = ratingTables.rateCard.underwritingProfitLoading;
  const uwProfitLoadingBase = Number((basePremium + addonsTotal + claimsLoading).toFixed(2));
  const uwProfitLoading = Number((uwProfitLoadingBase * uwProfitLoadingConfig.rate).toFixed(2));
  if (uwProfitLoading > 0) {
    steps.push({
      id: 'travel.uwProfitLoading',
      name: 'Underwriting profit loading',
      kind: 'factor',
      amount: uwProfitLoading,
      factor: uwProfitLoadingConfig.rate,
      inputs: { appliesTo: uwProfitLoadingConfig.appliesTo, base: uwProfitLoadingBase, source: 'brit-travel.underwritingProfitLoading' },
    });
  }
  const netPremium = Number((uwProfitLoadingBase + uwProfitLoading).toFixed(2));
  steps.push({ id: 'travel.netPremium', name: 'Net premium', kind: 'subtotal', output: netPremium });

  // ADR-0024: per-country regulatory tax engine. NL is configured as
  // `refer: true` in the tax JSON; emit a REFERRAL outcome (not a
  // synthetic rate). `no-defensive-fallbacks` rule applies.
  const taxes = calculateTravelTaxes({ config: jurisdictionConfig, netPremium });
  if (taxes.refer) {
    return {
      premium: {
        premium: 0,
        basis: 'HYBRID',
        calculationDetails: {
          steps: [
            ...steps,
            {
              id: 'travel.refer.taxProfile',
              name: 'Refer: tax profile pending BRIT confirmation',
              kind: 'total',
              output: 0,
              inputs: { country: jurisdictionConfig.countryCode, profile: taxes.profileCode },
              notes: taxes.referReason,
            },
          ],
          calculatorVersion: TRAVEL_CALCULATOR_VERSION,
        },
      },
      breakdown: zeroBreakdown(),
      refer: true,
      reason: `TAX_PROFILE_REFER: ${taxes.referReason || `Tax profile for ${jurisdictionConfig.countryCode} pending confirmation`}`,
      declined: false,
    };
  }

  if (taxes.iptAmount > 0) {
    steps.push({
      id: 'travel.tax.ipt',
      name: 'Insurance premium tax',
      kind: 'tax',
      amount: taxes.iptAmount,
      inputs: { country: jurisdictionConfig.countryCode, profile: taxes.profileCode, ...(taxes.interimConservative ? { interimConservative: true } : {}) },
    });
  }
  if (taxes.parafiscalAmount > 0) {
    steps.push({ id: 'travel.tax.parafiscal', name: 'Parafiscal levies', kind: 'tax', amount: taxes.parafiscalAmount });
  }
  if (taxes.flatStampDuty > 0) {
    steps.push({ id: 'travel.tax.stampDuty', name: 'Stamp duty / flat fee', kind: 'tax', amount: taxes.flatStampDuty });
  }

  // Broker admin fee — Travel uses a sliding band on net premium per
  // Andy 2026-05-16 (data/travel-fee-bands.json). Replaces the previous
  // flat tenant.adminFee read; this is Travel-only and applies on the
  // net premium (pre-tax) per Andy's directive. Tenant remains the
  // operating identity (auth, branding, currency) per ADR-0024 — only
  // the fee structure now lives at the product layer.
  const adminFee = resolveTravelAdminFeeFromBands(netPremium, ratingTables.adminFees);
  if (adminFee > 0) {
    steps.push({
      id: 'travel.fee.admin',
      name: 'Admin fee',
      kind: 'fee',
      amount: adminFee,
      inputs: { netPremium, source: 'travel-fee-bands' },
    });
  }

  const grossPremium = Number((netPremium + taxes.totalTaxAmount + adminFee).toFixed(2));
  steps.push({ id: 'travel.grossPremium', name: 'Total', kind: 'total', output: grossPremium });

  // ABY-264 — assemble the single canonical breakdown the wizard
  // sidebar, payment-step summary, BO Premium tab and PDF schedule all
  // read. The order is fixed by the spine:
  //   1. Base premium (rate table × Single Trip multiplier; no addons,
  //      no taxes, no admin fee)
  //   2. Each selected add-on (catalogue order — see selectedAddonOrder)
  //   3. Underwriting profit loading (ADR-0035; applied to base + addons)
  //   4. Each tax / parafiscal levy that actually applies
  //   5. Admin fee (one line — applied off the net premium per Andy
  //      2026-05-16; the sliding band is data, not branching here)
  //   6. Total (sum of everything above; equals primary.annualPremium)
  //
  // Zero-amount lines are omitted so consumers can iterate without
  // filtering. Admin fee and tax lines stay in the same order on every
  // surface, including PDF, so the BO operator and the customer see
  // the same column of numbers.
  const lines: TravelBreakdownLine[] = [];
  if (basePremium > 0) {
    lines.push({ code: 'base', label: 'Base premium', amount: basePremium, kind: 'base' });
  }
  for (const key of selectedAddonOrder) {
    const amount = addonBreakdown[key] ?? 0;
    if (amount <= 0) continue;
    lines.push({ code: `addon.${key}`, label: getTravelAddonLabel(key), amount, kind: 'addon' });
  }
  if (claimsLoading > 0) {
    // ADR-0054 — prior-claims loading line. Sits before the UW profit
    // loading line; identified across surfaces by `code: 'loading.claims'`.
    lines.push({ code: 'loading.claims', label: 'Claims history adjustment', amount: claimsLoading, kind: 'loading' });
  }
  if (uwProfitLoading > 0) {
    // ADR-0035 — customer-facing label is the neutral "Premium adjustment"
    // (the internal concept / CalculationStep name stays "Underwriting
    // profit loading" for BDX/audit). The line is identified across every
    // surface by `code: 'loading.uwProfit'` / `kind: 'loading'`, not its
    // wording, so softening the label does not break any consumer.
    lines.push({ code: 'loading.uwProfit', label: 'Premium adjustment', amount: uwProfitLoading, kind: 'loading' });
  }
  if (taxes.iptAmount > 0) {
    lines.push({ code: 'tax.ipt', label: 'Insurance premium tax', amount: taxes.iptAmount, kind: 'tax' });
  }
  if (taxes.parafiscalAmount > 0) {
    lines.push({ code: 'tax.parafiscal', label: 'Parafiscal levies', amount: taxes.parafiscalAmount, kind: 'tax' });
  }
  if (taxes.flatStampDuty > 0) {
    lines.push({ code: 'tax.stampDuty', label: 'Stamp duty', amount: taxes.flatStampDuty, kind: 'tax' });
  }
  if (adminFee > 0) {
    lines.push({ code: 'fee.admin', label: 'Admin fee', amount: adminFee, kind: 'fee' });
  }
  lines.push({ code: 'total', label: 'Total', amount: grossPremium, kind: 'total' });

  return {
    premium: {
      premium: grossPremium,
      basis: 'HYBRID',
      calculationDetails: {
        fixedAmount: grossPremium,
        proRataFactor: 1,
        steps,
        calculatorVersion: TRAVEL_CALCULATOR_VERSION,
      },
    },
    breakdown: {
      basePremium,
      addonsTotal,
      addonBreakdown,
      uwProfitLoading,
      claimsLoading,
      netPremium,
      iptAmount: Number((taxes.iptAmount + taxes.parafiscalAmount + taxes.flatStampDuty).toFixed(2)),
      adminFee,
      grossPremium,
      lines,
    },
    refer: false,
    declined: false,
  };
}

function zeroBreakdown(): TravelBreakdown {
  return {
    basePremium: 0,
    addonsTotal: 0,
    addonBreakdown: {},
    uwProfitLoading: 0,
    claimsLoading: 0,
    netPremium: 0,
    iptAmount: 0,
    adminFee: 0,
    grossPremium: 0,
    lines: [],
  };
}
