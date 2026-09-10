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
  .union([z.number(), z.literal(Number.POSITIVE_INFINITY)])
  .nullable()
  .transform((value) => (value === null ? Number.POSITIVE_INFINITY : value));

const FactorEntrySchema = z.object({
  label: z.string().min(1),
  min: z.number().nonnegative(),
  max: InfinityNullable,
  factor: z.number(),
});

const NcdDiscountEntrySchema = z.object({
  ncb: z.string().min(1),
  discount: z.number().min(0).max(1),
});

const BaseMatrixSchema = z.object({
  vehicleValueBands: z.array(z.number().nonnegative()).min(1),
  engineSizeBands: z.array(z.string().min(1)).min(1),
  basePolicyExcessEngineSizeBands: z.array(z.string().min(1)).min(1),
  basePolicyExcessByEngineBand: z.array(z.number().nonnegative()).min(1),
  values: z.array(z.array(z.number().nonnegative())).min(1),
}).superRefine((value, ctx) => {
  if (value.basePolicyExcessByEngineBand.length !== value.basePolicyExcessEngineSizeBands.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'basePolicyExcessByEngineBand must provide exactly one excess for every basePolicyExcessEngineSizeBands entry.',
      path: ['basePolicyExcessByEngineBand'],
    });
  }
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

const MotorExcessThresholdSchema = z.object({
  max: InfinityNullable,
  excess: z.number().nonnegative(),
});

const PremiumBandSchema = z.object({
  max: InfinityNullable,
  premium: z.number().nonnegative(),
});

export const AbbeygateAutoCyprus2022MatrixSchema = z.object({
  baseMatrix: BaseMatrixSchema,
  factors: z.object({
    proposerAge: z.array(FactorEntrySchema).min(1),
    vehicleAge: z.array(FactorEntrySchema).min(1),
    licencePeriod: z.array(FactorEntrySchema).min(1),
    addedDriversUnder25: z.array(FactorEntrySchema).min(1),
    ncd: z.object({
      discounts: z.array(NcdDiscountEntrySchema).min(1),
      protectedFactor: z.number().positive(),
    }),
    driverPricing: z.object({
      namedDriversFactor: z.number().positive(),
      anyDriver40PlusFactor: z.number().positive(),
      additionalDriverAgeLoading: z.object({
        ageOver: z.number().nonnegative(),
        factor: z.number().positive(),
      }),
    }),
    vehicleUse: z.record(z.string(), z.number().positive()),
    convictions: z.object({
      classFactors: z.record(z.string(), z.number().positive()),
      majorCountFactors: z.array(z.object({ min: z.number().nonnegative(), factor: z.number().positive() })).min(1),
      majorYearsFactors: z.array(z.object({ years: z.number().nonnegative(), factor: z.number().positive() })).min(1),
    }),
    claims: z.object({
      maximumFaultBands: z.array(z.object({ minExclusive: z.number().nonnegative(), maxExclusive: z.number().positive().nullable(), factor: z.number().positive() })).min(1),
      countAndTotalBands: z.array(z.object({ count: z.number().positive(), maxTotal: z.number().positive(), inclusive: z.boolean(), factor: z.number().positive() })).min(1),
      overCount: z.object({ countExclusive: z.number().nonnegative(), factor: z.number().positive() }),
    }),
    policyTerm: z.object({
      shortTermMaxMonths: z.number().positive(),
      shortTermFactor: z.number().positive(),
    }),
    onlineDiscount: z.number().min(0).max(1),
    uwAdjustmentPctCap: z.number().positive().max(100),
  }),
  motorcycle: z.object({
    basePremium: z.array(MotorcycleBasePremiumEntrySchema).min(1),
    riderAgeFactors: z.array(MotorcycleRiderAgeFactorEntrySchema).min(1),
    ncdFactors: z.record(z.string(), z.number().positive()),
    countryFactors: z.record(z.string(), z.number().positive()),
    fixedFees: z.record(z.string(), z.number().nonnegative()),
  }),
  excess: z.object({
    electricPrivateCarBase: z.number().nonnegative(),
    cabrioAdditional: z.number().nonnegative(),
    motorcaravanByDeclaredValue: z.array(MotorExcessThresholdSchema).min(1),
    motorcycleByEngineCapacity: z.array(MotorExcessThresholdSchema).min(1),
    voluntaryOptions: z.object({
      increment: z.number().positive(),
      maximum: z.number().positive(),
    }),
  }),
  motorcaravan: z.object({
    basePremiumByAnnualKms: z.array(MotorcaravanBaseEntrySchema).min(1),
    overWeightTonnes: z.number().positive(),
    overWeightFactor: z.number().positive(),
    locationFactors: z.record(z.string(), z.number().positive()),
  }),
  tpl: z.object({
    ageBands: z.array(PremiumBandSchema).min(1),
    minimumPremium: z.number().nonnegative(),
    tpoFactor: z.number().positive(),
  }),
  classic: z.object({
    excessPctOfValue: z.number().nonnegative(),
  }),
});

export type AbbeygateAutoCyprus2022Matrix = z.infer<typeof AbbeygateAutoCyprus2022MatrixSchema>;
