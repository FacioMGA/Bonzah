import { z } from 'zod';

/**
 * Canonical schema for travel per-country tax rates (BRIT BAA 2026 expansion).
 *
 * Implements the data side of [ADR-0024](../../../../docs/architecture/decisions/ADR-0024-travel-customer-residence-as-tax-jurisdiction.md):
 * the customer-declared `eligibility.countryOfResidence` selects one of these
 * rows, and `calculateTravelTaxes` applies the row to the net premium.
 *
 * Per the canonical-ownership "Product rate tables" row, this lives as
 * JSON + zod schema + loader; inline TS literal tax tables under
 * `backend/products/travel/pricing/` are forbidden by the
 * `check-no-inline-rate-tables.mjs` guard.
 *
 * Schema invariants (failed loud at load time, never at calc time):
 *   - 9 BRIT-authorised countries: CY, PT, GR, ES, BE, NL, IT, FR, MT.
 *   - `refer: true` rows MUST omit `iptRate` (refusing to encode a rate
 *     the binder hasn't authorised). Non-refer rows MUST set `iptRate`.
 *   - `interimConservative: true` is a metadata flag for ops/finance —
 *     it does NOT change the calc; it surfaces in the trace so a future
 *     BRIT confirmation is a one-line JSON edit.
 *
 * Adding a country = add a row + add the country code to
 * `JurisdictionCountryCode` + add a residence option in the manifest +
 * cite an ADR. No code change in the loader or calc.
 */

export const TRAVEL_TAX_COUNTRIES = ['CY', 'PT', 'GR', 'ES', 'BE', 'NL', 'IT', 'FR', 'MT'] as const;
export type TravelTaxCountry = (typeof TRAVEL_TAX_COUNTRIES)[number];

const ParafiscalLevySchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  rate: z.number().min(0).max(1).optional(),
  flatPerPolicy: z.number().min(0).optional(),
}).refine(
  (levy) => (levy.rate !== undefined) !== (levy.flatPerPolicy !== undefined),
  { message: 'Parafiscal levy must declare exactly one of `rate` or `flatPerPolicy`.' },
);

const ReferRowSchema = z.object({
  countryCode: z.enum(TRAVEL_TAX_COUNTRIES),
  refer: z.literal(true),
  notes: z.string().min(1),
});

const ActiveRowSchema = z.object({
  countryCode: z.enum(TRAVEL_TAX_COUNTRIES),
  refer: z.literal(false).optional(),
  iptRate: z.number().min(0).max(1),
  iptLabel: z.string().min(1),
  flatStampDuty: z.number().min(0).optional(),
  flatStampDutyLabel: z.string().min(1).optional(),
  minimumDuty: z.number().min(0).optional(),
  parafiscalLevies: z.array(ParafiscalLevySchema).optional(),
  interimConservative: z.boolean().optional(),
  notes: z.string().optional(),
});

export const TravelEuTaxRowSchema = z.union([ActiveRowSchema, ReferRowSchema]);
export type TravelEuTaxRow = z.infer<typeof TravelEuTaxRowSchema>;

export const TravelEuTaxRatesSchema = z.object({
  version: z.string().min(1),
  source: z.string().min(1),
  asOf: z.string().min(1),
  rows: z.array(TravelEuTaxRowSchema),
}).refine(
  (data) => {
    const codes = data.rows.map((r) => r.countryCode);
    return new Set(codes).size === codes.length;
  },
  { message: 'Duplicate countryCode in rows.' },
).refine(
  (data) => {
    const codes = new Set(data.rows.map((r) => r.countryCode));
    return TRAVEL_TAX_COUNTRIES.every((c) => codes.has(c));
  },
  { message: 'Missing rows: every BRIT-authorised country must have a tax row (use refer:true if rate is unconfirmed).' },
);
export type TravelEuTaxRates = z.infer<typeof TravelEuTaxRatesSchema>;
