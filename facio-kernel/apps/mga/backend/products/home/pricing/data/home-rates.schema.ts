import { z } from 'zod';

/**
 * Canonical schema for home pricing data.
 *
 * Per ADR-0014, home rate cards live as JSON + zod schema + loader, never as
 * inline TypeScript literals. The same schema validates every per-vintage
 * file under `backend/products/home/pricing/data/home-rates-*.json`.
 */

export const PROPERTY_USE = ['Permanent', 'Holiday'] as const;
export type PropertyUse = (typeof PROPERTY_USE)[number];

export const RATE_BRACKETS = ['small', 'largeNoAd', 'smallWithAd'] as const;
export type RateBracket = (typeof RATE_BRACKETS)[number];

const RateBlockSchema = z.object({
  buildings: z.number().min(0),
  contents: z.number().min(0),
  jewellery: z.number().min(0).nullable(),
  otherAllRisks: z.number().min(0).nullable(),
});

const WorkbookRateBlockSchema = z.object({
  buildingsBase: z.number().min(0),
  buildingsOver: z.number().min(0),
  buildingsAd: z.number().min(0).nullable(),
  contentsBase: z.number().min(0),
  contentsOver: z.number().min(0),
  contentsAd: z.number().min(0).nullable(),
  jewellery: z.number().min(0).nullable(),
  otherAllRisks: z.number().min(0).nullable(),
  solar: z.number().min(0),
});

const CountryRateCardSchema = z.object({
  Permanent: z.object({
    small: RateBlockSchema,
    largeNoAd: RateBlockSchema,
    smallWithAd: RateBlockSchema,
  }),
  Holiday: z.object({
    small: RateBlockSchema,
    largeNoAd: RateBlockSchema,
    smallWithAd: RateBlockSchema,
  }),
});

const CountryWorkbookSchema = z.object({
  Permanent: WorkbookRateBlockSchema,
  Holiday: WorkbookRateBlockSchema,
});

/**
 * Underwriting profit loading (ADR-0036).
 *
 * Margin applied to `afterDiscounts` (the underwritten net premium
 * after risk loadings and customer discounts) but *before* the
 * country-specific tax engine and the €131 minimum-premium floor.
 *
 * `rate` is the fractional margin (e.g. 0.034 = 3.4 %). Bound to the
 * unit interval to fail loud if a percent slips in as `3.4` instead
 * of `0.034`. `appliesTo` is fixed at `"net_premium"`; future
 * variants (e.g. applying to `basePremium` instead) would arrive
 * behind a new ADR with a new literal value.
 */
const UnderwritingProfitLoadingSchema = z.object({
  rate: z.number().min(0).max(1),
  appliesTo: z.literal('net_premium'),
});

const WildfireLoadingSchema = z.object({
  amber: z.number().min(0).max(1),
  yellow: z.number().min(0).max(1),
  green: z.number().min(0).max(1),
});

/**
 * Per-country base rating loading, keyed by ISO-3166-1 alpha-2 country
 * code (ADR-0052).
 *
 * Some territories share the Cyprus base rate card but carry a flat
 * country-level uplift on every risk (e.g. Greece = Cyprus premium
 * +20%, per Abbeygate underwriting). A country absent from this map has
 * no base uplift — the loading is genuinely 0, not a defaulted value.
 * The rate is fractional (0.20 = +20%) and applied additively in the
 * calculator's loadings pool alongside the island and wildfire loadings.
 */
const CountryBaseLoadingSchema = z.record(z.string(), z.number().min(0).max(1));

const HomePricingRulesSchema = z.object({
  propertyAgeDiscounts: z.record(z.string(), z.number().min(0).max(1)),
  noClaimsDiscounts: z.record(z.string(), z.number().min(0).max(1)),
  increasedExcessDiscounts: z.record(z.string(), z.number().min(0).max(1)),
  previousClaimsLoadings: z.record(z.string(), z.number().min(0).max(5)),
  combustibleConstructionLoading: z.number().min(0).max(5),
  staticCaravanLoading: z.number().min(0).max(5),
  greekPostcodeLoading: z.object({ postcodes: z.array(z.string().min(1)).min(1), rate: z.number().min(0).max(5) }),
  alarmDiscount: z.number().min(0).max(1),
  proposerOver45Discount: z.number().min(0).max(1),
  discretionaryDiscountCap: z.number().min(0).max(1),
  europAssistance: z.object({ countryCodes: z.array(z.string().min(2)).min(1), fee: z.number().min(0) }),
});

export const HomeRatesSchema = z.object({
  vintage: z.string().min(1),
  source: z.string().min(1),
  rateCards: z.record(z.string(), CountryRateCardSchema),
  workbook: z.record(z.string(), CountryWorkbookSchema),
  minPremium: z.number().min(0),
  underwritingProfitLoading: UnderwritingProfitLoadingSchema,
  wildfireLoading: WildfireLoadingSchema,
  countryBaseLoading: CountryBaseLoadingSchema,
  pricingRules: HomePricingRulesSchema,
});

export type RateBlock = z.infer<typeof RateBlockSchema>;
export type WorkbookRateBlock = z.infer<typeof WorkbookRateBlockSchema>;
export type HomeRates = z.infer<typeof HomeRatesSchema>;
export type HomeUnderwritingProfitLoading = z.infer<typeof UnderwritingProfitLoadingSchema>;
export type HomeWildfireLoading = z.infer<typeof WildfireLoadingSchema>;
export type HomeCountryBaseLoading = z.infer<typeof CountryBaseLoadingSchema>;
export type HomePricingRules = z.infer<typeof HomePricingRulesSchema>;
