import { z } from 'zod';

/**
 * Canonical schema for travel pricing data (Brit Travel rate cards, Sept 2025).
 *
 * Per ADR-0018 (and the symmetry with motor / home — ADR-0014), travel rate
 * cards live as JSON + zod schema + loader. The legacy inline TypeScript
 * `RATES` object in `backend/products/travel/pricing/travelRateTable.ts`
 * has been deleted; consumers must read this schema's loader and pass
 * structured inputs.
 *
 * Rate-table key shape: `${plan}|${tripType}|${area}|${coverType}|${days}|${ageBand}`.
 * Each value is either a positive premium in EUR or the literal `'REFER'`
 * (age-band overrides where the matrix cell exists but flags manual review).
 */

export const TRAVEL_PLANS = ['silver', 'gold', 'platinum'] as const;
export type TravelPlan = (typeof TRAVEL_PLANS)[number];

export const TRIP_TYPES = ['Single trip', 'Multi trip'] as const;
export type TripType = (typeof TRIP_TYPES)[number];

export const AREAS_OF_COVER = ['Europe', 'Worldwide excl', 'WorldwideInc'] as const;
export type AreaOfCover = (typeof AREAS_OF_COVER)[number];

export const COVER_TYPES = ['Individual', 'Couple', 'Family', 'Single parent family'] as const;
export type CoverType = (typeof COVER_TYPES)[number];

export const AGE_BANDS = ['18-35', '36-50', '51-65', '66-70', '71-75', '76-78', '79', '80+'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const DAY_BANDS = [3, 5, 9, 12, 17, 23, 31, 45, 62] as const;
export type DayBand = (typeof DAY_BANDS)[number];

const RateCellSchema = z.union([z.number().min(0), z.literal('REFER')]);

/**
 * Add-on pricing rule per trip type. Two kinds supported:
 *   - `loadPercent`: amount = basePremium * value (e.g. winter-sports
 *     single-trip 100% load → value: 1.0 → premium doubles).
 *   - `perTraveller`: amount = travellerCount * value (flat fee per
 *     traveller; e.g. business cover 20 EUR/traveller).
 *
 * Some add-ons (winter-sports, gadget) have different rules between
 * single- and multi-trip policies, so each add-on declares both.
 */
const AddonRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('loadPercent'), value: z.number().min(0) }),
  z.object({ kind: z.literal('perTraveller'), value: z.number().min(0) }),
]);

const AddonConfigSchema = z.object({
  singleTrip: AddonRuleSchema,
  multiTrip: AddonRuleSchema,
});

export const ADDON_KEYS = [
  'winterSports',
  'businessCover',
  'golfCover',
  'terrorism',
  'sportsEquipment',
  'wedding',
  'gadget',
] as const;
export type AddonKey = (typeof ADDON_KEYS)[number];

const AddonsSchema = z.object({
  winterSports: AddonConfigSchema,
  businessCover: AddonConfigSchema,
  golfCover: AddonConfigSchema,
  terrorism: AddonConfigSchema,
  sportsEquipment: AddonConfigSchema,
  wedding: AddonConfigSchema,
  gadget: AddonConfigSchema,
});

/**
 * Single-trip cover-type multipliers (Andrew Francis email 2026-05-18).
 *
 * The BRIT Sept 2025 rate sheet only carries Individual rows for Single
 * Trip — Couple and Family rows exist on Multi Trip only. Andrew confirmed
 * Single Trip Couple/Family pricing is the Individual rate scaled:
 *   - Individual: 1.0 (base)
 *   - Couple:     1.9
 *   - Family:     2.15
 *
 * The calculator looks up the Individual rate for Single Trip regardless
 * of the customer's cover type, then applies the multiplier here. Multi
 * Trip continues to use direct Couple/Family rate cells (multiplier = 1.0
 * implicitly because the rate is already cover-type-specific).
 */
const SingleTripCoverMultipliersSchema = z.object({
  Individual: z.number().positive(),
  Couple: z.number().positive(),
  Family: z.number().positive(),
});

/**
 * Underwriting profit loading (ADR-0035).
 *
 * Applied to `basePremium + addonsTotal` (the net premium before tax
 * and admin fee). The loaded net is then handed to the tax engine
 * AND to the admin-fee band lookup, so a small underwriting margin
 * can legitimately reclassify a quote into a higher admin-fee band
 * (this is the workbook's intent — see row 9 platinum and row 16
 * silver in `artifacts/travel-insurance-info/TRAVEL RATES ADJUSTMENT.xlsx`).
 *
 * `rate` is the fractional margin (e.g. 0.02 = 2 %). Bound to the
 * unit interval to fail loud if a percent slips in as `2.0` instead
 * of `0.02`. `appliesTo` is fixed at `"net_premium"` for now; future
 * variants (e.g. `"base_premium"`) would land via a new ADR.
 */
const UnderwritingProfitLoadingSchema = z.object({
  rate: z.number().min(0).max(1),
  appliesTo: z.literal('net_premium'),
});

/**
 * Prior travel-claim loading (ADR-0054).
 *
 * When the customer declares a previous travel-insurance claim of up to
 * €500, `upTo500Rate` is applied to the base premium as a distinct
 * `loading.claims` line, folded into the net premium before the
 * underwriting profit loading, tax and admin-fee band. A declared claim
 * OVER €500 is a referral (handled in the calculator / UW automation), so
 * no rate is carried for it here.
 *
 * `upTo500Rate` is the fractional loading (0.15 = 15%), bound to the unit
 * interval to fail loud if a percent slips in as `15` instead of `0.15`.
 */
const PriorClaimLoadingSchema = z.object({
  upTo500Rate: z.number().min(0).max(1),
  appliesTo: z.literal('base_premium'),
});

export const BritTravelRatesSchema = z.object({
  version: z.string().min(1),
  rates: z.record(z.string(), RateCellSchema),
  addons: AddonsSchema,
  singleTripCoverMultipliers: SingleTripCoverMultipliersSchema,
  underwritingProfitLoading: UnderwritingProfitLoadingSchema,
  priorClaimLoading: PriorClaimLoadingSchema,
});
export type BritTravelRates = z.infer<typeof BritTravelRatesSchema>;
export type RateCell = z.infer<typeof RateCellSchema>;
export type AddonConfig = z.infer<typeof AddonConfigSchema>;
export type SingleTripCoverMultipliers = z.infer<typeof SingleTripCoverMultipliersSchema>;
export type UnderwritingProfitLoading = z.infer<typeof UnderwritingProfitLoadingSchema>;
export type PriorClaimLoading = z.infer<typeof PriorClaimLoadingSchema>;
