import { z } from 'zod';

/**
 * Schema for the Abbeygate Cyprus 2022 motor (comprehensive) rating matrix.
 *
 * Source: `policy-documents/ABBEYGATE AIG SCHEME COMP COVER Calculator 2022 Cyprus (1).xlsx`
 *   (sheet: "Hidden Workings"), plus the scheme-level add-ons (motorcycle,
 *   motorcaravan, classic) that previously lived alongside the workbook
 *   matrix in the in-code literal.
 *
 * Canonical data file: `./abbeygate-auto-cyprus-2022.json`.
 * Loader: `./loader.ts` (`loadAbbeygateAutoCyprus2022Matrix`) — validates
 *   against this schema, freezes, caches.
 *
 * Per `docs/architecture/contracts/canonical-ownership.md`:
 *   - Rate tables have exactly one canonical source: the JSON file.
 *   - All access goes through the loader. No inline literal copies.
 *   - The schema is the contract; runtime mutation is forbidden (frozen).
 *
 * "No upper bound" sentinel.
 *   The previous TS literal used `Infinity` as the catch-all upper bound on
 *   `motorcycle.basePremium[*].maxCc`, `motorcycle.riderAgeFactors[*].max`,
 *   and `motorcaravan.basePremiumByAnnualKms[*].maxKms`. JSON has no
 *   Infinity, so the JSON encodes the catch-all as `null` and this schema
 *   transforms `null` -> `Number.POSITIVE_INFINITY` so consumers (which
 *   compare `value <= maxX`) keep their existing semantics unchanged.
 */

const InfinityNullable = z
  .number()
  .nullable()
  .transform((value) => (value === null ? Number.POSITIVE_INFINITY : value));

const FactorEntrySchema = z.object({
  label: z.string().min(1),
  factor: z.number(),
});

const BaseMatrixSchema = z.object({
  vehicleValueBands: z.array(z.number().nonnegative()).min(1),
  engineSizeBands: z.array(z.string().min(1)).min(1),
  values: z.array(z.array(z.number().nonnegative())).min(1),
});

const MotorcycleBasePremiumEntrySchema = z.object({
  maxCc: InfinityNullable,
  premium: z.number().nonnegative(),
});

const MotorcycleRiderAgeFactorEntrySchema = z.object({
  min: z.number().nonnegative(),
  max: InfinityNullable,
  factor: z.number(),
});

const MotorcaravanBaseEntrySchema = z.object({
  maxKms: InfinityNullable,
  premium: z.number().nonnegative(),
});

export const AbbeygateAutoCyprus2022MatrixSchema = z.object({
  baseMatrix: BaseMatrixSchema,
  factors: z.object({
    proposerAge: z.array(FactorEntrySchema).min(1),
    vehicleAge: z.array(FactorEntrySchema).min(1),
    licencePeriod: z.array(FactorEntrySchema).min(1),
    addedDriversUnder25: z.array(FactorEntrySchema).min(1),
  }),
  motorcycle: z.object({
    basePremium: z.array(MotorcycleBasePremiumEntrySchema).min(1),
    riderAgeFactors: z.array(MotorcycleRiderAgeFactorEntrySchema).min(1),
  }),
  motorcaravan: z.object({
    basePremiumByAnnualKms: z.array(MotorcaravanBaseEntrySchema).min(1),
  }),
  classic: z.object({
    excessPctOfValue: z.number().nonnegative(),
  }),
});

export type AbbeygateAutoCyprus2022Matrix = z.infer<typeof AbbeygateAutoCyprus2022MatrixSchema>;
