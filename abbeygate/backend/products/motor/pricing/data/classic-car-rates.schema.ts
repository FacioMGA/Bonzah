import { z } from 'zod';

/**
 * Schema for the classic-car rate table.
 *
 * Source: `policy-documents/Classic Car rates.xlsx` (Sheet1).
 * Canonical data file: `./classic-car-rates.json`.
 * Loader: `./loader.ts` — validates against this schema, freezes, caches.
 *
 * Per `docs/architecture/contracts/canonical-ownership.md`:
 *   - Rate tables have exactly one canonical source: the JSON file.
 *   - All access goes through the loader. No inline literal copies.
 *   - The schema is the contract; runtime mutation is forbidden (frozen).
 *
 * KNOWN-ISSUE-1 (group enum mismatch). The vehicle-group column in the
 *   workbook contains '1'…'10' and 'NQ'. The premium / excess matrices only
 *   have keys '1'…'5' and '5+'. The consumer (`../classicPricing.ts`) does not
 *   map groups >5 down to '5+', so vehicles in groups 6-10 / NQ silently
 *   look up `undefined` and price as `NaN`. This was masked by `as const`
 *   in the previous TS literal (which lied about the type). Fix is owed as
 *   a follow-up commit; do NOT silently coerce here.
 *
 * KNOWN-ISSUE-2 (year sentinels). The workbook uses two sentinels that the
 *   consumer does not interpret:
 *     - `0`        in `fromYear` or `toYear` = "unspecified" (92 rows).
 *     - `9999`     in `toYear`                = "open-ended" (2 rows).
 *   Both currently cause `year <= toYear` / `year >= fromYear` filters to
 *   misbehave (sentinel rows either never match or always match). Consumer
 *   fix is owed.
 *
 * Both issues pre-date this externalization. The schema accepts the data as
 * it is so this PR ships clean; tightening + consumer fix follow.
 */

export const ClassicVehicleGroupSchema = z.enum([
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'NQ',
]);
/** Groups for which the rate matrices actually have a row. */
export const ClassicRateGroupSchema = z.enum(['1', '2', '3', '4', '5', '5+']);
export const ClassicMileageBandSchema = z.enum(['0-1500', '1501-3000', '3001-5000']);
export const ClassicExcessAgeBandSchema = z.enum(['10-20', '20+']);

const RateByGroupSchema = z.record(ClassicRateGroupSchema, z.number().nonnegative());

export const ClassicVehicleRowSchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  // Non-negative integer. 0 is the "unspecified" sentinel; 9999 is the
  // "open-ended" sentinel (toYear only). See KNOWN-ISSUE-2.
  fromYear: z.number().int().nonnegative(),
  toYear: z.number().int().nonnegative(),
  engineCc: z.number().int().nonnegative(),
  group: ClassicVehicleGroupSchema,
});

export const ClassicCarRatesSchema = z.object({
  premiumByMileageBand: z.record(ClassicMileageBandSchema, RateByGroupSchema),
  policyExcessByAgeBand: z.record(ClassicExcessAgeBandSchema, RateByGroupSchema),
  vehicleGroups: z.array(ClassicVehicleRowSchema).min(1),
});

export type ClassicCarRates = z.infer<typeof ClassicCarRatesSchema>;
export type ClassicVehicleGroup = z.infer<typeof ClassicVehicleGroupSchema>;
export type ClassicRateGroup = z.infer<typeof ClassicRateGroupSchema>;
export type ClassicMileageBand = z.infer<typeof ClassicMileageBandSchema>;
export type ClassicExcessAgeBand = z.infer<typeof ClassicExcessAgeBandSchema>;
export type ClassicVehicleRow = z.infer<typeof ClassicVehicleRowSchema>;
