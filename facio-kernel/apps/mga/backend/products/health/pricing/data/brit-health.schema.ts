import { z } from 'zod';

/**
 * Canonical schema for BRIT Immigration Medical Insurance rate cards.
 *
 * Per ADR-0018 (and the precedent set by travel/home), rate cards live
 * as JSON + zod schema + loader. Schema is parsed once at boot from
 * `brit-health-2026.json` by `loader.ts`, then deep-frozen and cached.
 *
 * Source of truth: artifacts/health-insurance/Brit Immigration Rates.xlsx
 * - Gross premium and age-band excess vary by age band only.
 * - 30 % commission off the gross (net = gross × 0.70).
 * - Cover amounts are fixed across the product and do not vary by age.
 *
 * `excess` is either a positive EUR number (fixed deductible) or a
 * percentage co-insurance literal `'10%'` (for the 0–62 band).
 */

export const HEALTH_AGE_BANDS = ['0-62', '63-65', '66-70', '71-74', '75-79', '80+'] as const;
export type HealthAgeBand = (typeof HEALTH_AGE_BANDS)[number];

const ExcessSchema = z.union([
  z.number().nonnegative(),
  z.literal('10%'),
]);

const AgeBandRowSchema = z.object({
  band: z.enum(HEALTH_AGE_BANDS),
  premiumGross: z.number().positive(),
  commissionPercent: z.number().min(0).max(1),
  excess: ExcessSchema,
});

const CoverAmountsSchema = z.object({
  inpatientPerIllness: z.number().nonnegative(),
  inpatientPerPeriod: z.number().nonnegative(),
  dailyRoomRegular: z.number().nonnegative(),
  dailyRoomEmergency: z.number().nonnegative(),
  childbirthLumpSum: z.number().nonnegative(),
  repatriationLimit: z.number().nonnegative(),
  outpatientPerIllness: z.number().nonnegative(),
  outpatientPerPeriod: z.number().nonnegative(),
  outpatientExcess: z.number().nonnegative(),
  coinsurancePercent: z.number().min(0).max(100),
});

const GhsExtensionAmountsSchema = z.object({
  doctorVisit: z.number().nonnegative(),
  doctorVisitsPerPeriod: z.number().nonnegative(),
  medications: z.number().nonnegative(),
  deathByAccidentLimit: z.number().nonnegative(),
  repatriationAfterDeathLimit: z.number().nonnegative(),
});

export const BritHealthRatesSchema = z.object({
  asset: z.string().min(1),
  version: z.string().min(1),
  reviewed: z.string().min(1),
  ageBands: z.array(AgeBandRowSchema).min(1),
  baseCover: CoverAmountsSchema,
  ghsExtension: GhsExtensionAmountsSchema,
});

export type AgeBandRow = z.infer<typeof AgeBandRowSchema>;
export type CoverAmounts = z.infer<typeof CoverAmountsSchema>;
export type GhsExtensionAmounts = z.infer<typeof GhsExtensionAmountsSchema>;
export type BritHealthRates = z.infer<typeof BritHealthRatesSchema>;
