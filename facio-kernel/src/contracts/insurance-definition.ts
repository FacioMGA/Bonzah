import { z } from 'zod';
import { id } from './primitives.js';
import { currencySchema, minorUnitSchema } from './money.js';

export const insuranceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + 'T00:00:00.000Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Use a real calendar date');
const text = z.string().trim().min(1).max(1000);
const label = z.string().trim().min(1).max(200);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const decimalValueSchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/)
  .refine((value) => !/^\-0(?:\.0+)?$/.test(value));
const nonnegativeMoney = minorUnitSchema.refine(
  (value) => minorUnitSchema.safeParse(value).success && BigInt(value) >= 0n,
);
const positiveMoney = minorUnitSchema.refine(
  (value) => minorUnitSchema.safeParse(value).success && BigInt(value) > 0n,
);
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const fieldBase = {
  id,
  label,
  required: z.boolean(),
  description: text,
  sourceRefs: z.array(text).min(1).max(20),
};
export const insuranceRiskFieldSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...fieldBase,
    type: z.literal('text'),
    minLength: z.number().int().min(0).max(4000),
    maxLength: z.number().int().min(1).max(4000),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal('choice'),
    options: z.array(z.strictObject({ id, label })).min(1).max(100),
  }),
  z.strictObject({ ...fieldBase, type: z.literal('boolean') }),
  z.strictObject({ ...fieldBase, type: z.literal('integer'), minimum: integer, maximum: integer }),
  z.strictObject({
    ...fieldBase,
    type: z.literal('decimal'),
    minimum: decimalValueSchema,
    maximum: decimalValueSchema,
    scale: z.number().int().min(0).max(6),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal('money'),
    minimumMinor: nonnegativeMoney,
    maximumMinor: positiveMoney,
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal('date'),
    minimum: insuranceDateSchema,
    maximum: insuranceDateSchema,
  }),
]);
export type InsuranceRiskField = z.infer<typeof insuranceRiskFieldSchema>;
export const insuranceAnswerSchema = z.union([z.string().max(4000), z.boolean(), integer]);
const predicateBase = { fieldId: id };
export const insurancePredicateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...predicateBase,
    kind: z.literal('comparison'),
    operator: z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte']),
    value: insuranceAnswerSchema,
  }),
  z.strictObject({
    ...predicateBase,
    kind: z.literal('membership'),
    operator: z.enum(['in', 'not_in']),
    values: z.array(insuranceAnswerSchema).min(1).max(100),
  }),
  z.strictObject({
    ...predicateBase,
    kind: z.literal('presence'),
    operator: z.enum(['present', 'absent']),
  }),
]);
export const insuranceConditionSchema = z.strictObject({
  mode: z.enum(['all', 'any']),
  conditions: z.array(insurancePredicateSchema).min(1).max(20),
});
const ruleBase = {
  id,
  reason: text,
  sourceRefs: z.array(text).min(1).max(20),
  when: insuranceConditionSchema,
};
export const insuranceDecisionRuleSchema = z.strictObject({
  ...ruleBase,
  outcome: z.enum(['refer', 'decline']),
});
export const coverageRateSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('flat'), premiumMinor: nonnegativeMoney }),
  z.strictObject({
    method: z.literal('per_unit'),
    quantityFieldId: id,
    premiumPerUnitMinor: nonnegativeMoney,
  }),
  z.strictObject({
    method: z.literal('limit_bps'),
    rateBps: z.number().int().min(0).max(1_000_000),
  }),
]);
export const insuranceCoverageSchema = z.strictObject({
  id,
  basis: z.literal('single_risk_per_occurrence'),
  name: label,
  description: text,
  required: z.boolean(),
  dependsOn: z.array(id).max(50),
  excludes: z.array(id).max(50),
  limit: z.strictObject({ minimumMinor: positiveMoney, maximumMinor: positiveMoney }),
  deductible: z.strictObject({ minimumMinor: nonnegativeMoney, maximumMinor: nonnegativeMoney }),
  rate: coverageRateSchema,
  sourceRefs: z.array(text).min(1).max(20),
});
/** Sole editable definition lives under configuration.products[].insurance. No source approval is asserted. */
export const insuranceProductDefinitionV1Schema = z.strictObject({
  schemaVersion: z.literal('insurance-product-v1'),
  pricingOwnership: z.literal('kernel_deterministic'),
  sourceRefs: z.array(text).min(1).max(20),
  territories: z
    .array(z.string().regex(/^[A-Z]{2}$/))
    .min(1)
    .max(100),
  termRules: z.strictObject({
    minimumDays: z.number().int().min(1).max(36525),
    maximumDays: z.number().int().min(1).max(36525),
    backdating: z.enum(['not_permitted', 'requires_approval']),
  }),
  riskFields: z.array(insuranceRiskFieldSchema).min(1).max(100),
  coverages: z.array(insuranceCoverageSchema).min(1).max(50),
  eligibilityRules: z.array(insuranceDecisionRuleSchema).max(100),
  rating: z.strictObject({
    termBasis: z.literal('whole_term'),
    minimumPremiumMinor: positiveMoney,
    factors: z
      .array(z.strictObject({ ...ruleBase, factorBps: z.number().int().min(1).max(1_000_000) }))
      .max(30),
  }),
  authority: z.strictObject({
    maximumPremiumMinor: positiveMoney,
    maximumTotalLimitMinor: positiveMoney,
    sourceRefs: z.array(text).min(1).max(20),
  }),
});
export type InsuranceProductDefinitionV1 = z.infer<typeof insuranceProductDefinitionV1Schema>;
export type InsuranceCondition = z.infer<typeof insuranceConditionSchema>;
export const configuredSubmissionV1Schema = z.strictObject({
  reference: text,
  version: text,
  summary: text,
  evidenceRefs: z.array(text).min(1).max(20),
  territory: z.string().regex(/^[A-Z]{2}$/),
  term: z.strictObject({ startDate: insuranceDateSchema, endDate: insuranceDateSchema }),
  expiresAt: z.string().datetime(),
  answers: z.record(id, insuranceAnswerSchema),
  coverages: z
    .array(
      z.strictObject({
        coverageId: id,
        limitMinor: positiveMoney,
        deductibleMinor: nonnegativeMoney,
      }),
    )
    .max(50),
});
export type ConfiguredSubmissionV1 = z.infer<typeof configuredSubmissionV1Schema>;
export const decisionIssueSchema = z.strictObject({
  code: z.string(),
  path: z.string(),
  message: z.string(),
});
export type DecisionIssue = z.infer<typeof decisionIssueSchema>;
const ruleEvidence = z.strictObject({
  ruleId: id,
  outcome: z.enum(['refer', 'decline']),
  result: z.enum(['true', 'false', 'unknown']),
  reason: text,
  sourceRefs: z.array(text),
});
export const insuranceEvaluationV1Schema = z.strictObject({
  engineVersion: z.literal('insurance-decision-v1'),
  productId: id,
  productVersion: z.string(),
  definitionHash: sha256,
  policyHash: sha256,
  runtimeReleaseId: z.string().uuid().nullable(),
  releaseHash: sha256.nullable(),
  inputHash: sha256,
  evaluatedOn: insuranceDateSchema,
  validation: z.strictObject({
    status: z.enum(['valid', 'invalid']),
    issues: z.array(decisionIssueSchema),
  }),
  applicability: z.strictObject({
    status: z.enum(['applicable', 'inapplicable']),
    reasons: z.array(z.string()),
  }),
  eligibility: z.strictObject({
    status: z.enum(['eligible', 'declined', 'undetermined']),
    rules: z.array(ruleEvidence),
  }),
  referral: z.strictObject({
    status: z.enum(['not_required', 'required', 'undetermined']),
    ruleIds: z.array(id),
  }),
  rating: z.strictObject({
    status: z.enum(['calculated', 'blocked']),
    currency: currencySchema,
    premiumMinor: positiveMoney.nullable(),
    lines: z.array(
      z.strictObject({
        coverageId: id,
        method: z.enum(['flat', 'per_unit', 'limit_bps']),
        premiumMinor: nonnegativeMoney,
      }),
    ),
    factors: z.array(
      z.strictObject({
        ruleId: id,
        result: z.enum(['true', 'false', 'unknown']),
        factorBps: z.number().int(),
        reason: text,
      }),
    ),
    minimumApplied: z.boolean(),
    rounding: z.literal('half-away-from-zero'),
    termBasis: z.literal('whole_term'),
    reasons: z.array(z.string()),
  }),
  authority: z.strictObject({
    status: z.enum(['within_authority', 'referral_required', 'undetermined']),
    reasons: z.array(z.string()),
  }),
  approval: z.strictObject({
    status: z.enum(['not_required', 'required_unsupported', 'undetermined']),
  }),
  bind: z.strictObject({ status: z.enum(['allowed', 'blocked']), reasons: z.array(z.string()) }),
  evaluationHash: sha256,
});
export type InsuranceEvaluationV1 = z.infer<typeof insuranceEvaluationV1Schema>;

export type InsuranceRiskFieldV2 = InsuranceRiskField & {
  visibleWhen: InsuranceCondition | null;
  requiredWhen: InsuranceCondition | null;
};
export const insuranceRiskFieldV2Schema = z.union(
  insuranceRiskFieldSchema.options.map((option) =>
    option.extend({
      visibleWhen: insuranceConditionSchema.nullable(),
      requiredWhen: insuranceConditionSchema.nullable(),
    }),
  ) as unknown as [
    z.ZodType<InsuranceRiskFieldV2>,
    z.ZodType<InsuranceRiskFieldV2>,
    ...z.ZodType<InsuranceRiskFieldV2>[],
  ],
);
export const coverageScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('policy') }),
  z.strictObject({ kind: z.literal('risk_group'), groupId: id }),
]);
export const selectionScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('policy') }),
  z.strictObject({ kind: z.literal('risk'), groupId: id, rowId: id }),
]);
export type SelectionScope = z.infer<typeof selectionScopeSchema>;
const moneyBounds = z.strictObject({ minimumMinor: positiveMoney, maximumMinor: positiveMoney });
export const insuranceCoverageV2Schema = insuranceCoverageSchema.omit({ basis: true }).extend({
  scope: coverageScopeSchema,
  limitBasis: z.enum(['per_occurrence', 'per_person', 'policy_term_aggregate']),
  aggregateLimit: moneyBounds
    .extend({ basis: z.enum(['per_occurrence', 'policy_term']) })
    .nullable(),
  layer: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('primary') }),
    z.strictObject({
      kind: z.literal('excess'),
      underlyingCoverageId: id,
      attachment: moneyBounds,
    }),
  ]),
});
export const insuranceProductDefinitionV2Schema = insuranceProductDefinitionV1Schema.extend({
  schemaVersion: z.literal('insurance-product-v2'),
  riskFields: z.array(insuranceRiskFieldV2Schema).max(100),
  riskGroups: z
    .array(
      z.strictObject({
        id,
        label,
        description: text,
        minimumRows: z.number().int().min(0).max(100),
        maximumRows: z.number().int().min(1).max(100),
        fields: z.array(insuranceRiskFieldV2Schema).min(1).max(100),
        eligibilityRules: z.array(insuranceDecisionRuleSchema).max(100),
        sourceRefs: z.array(text).min(1).max(20),
      }),
    )
    .max(20),
  coverages: z.array(insuranceCoverageV2Schema).min(1).max(50),
  rating: insuranceProductDefinitionV1Schema.shape.rating.extend({
    termBasis: z.enum(['whole_term', 'per_day']),
  }),
  authority: insuranceProductDefinitionV1Schema.shape.authority.extend({
    limitMeasure: z.literal('sum_of_declared_maximum_exposures'),
  }),
  cancellation: z
    .strictObject({
      calculation: z.enum(['per_day_remaining', 'actual_days_pro_rata']),
      minimumPremiumTreatment: z.literal('block_if_applied'),
      sourceRefs: z.array(text).min(1).max(20),
    })
    .optional(),
  servicing: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('disabled') }),
    z.strictObject({
      mode: z.literal('recalculate_remaining'),
      allowRiskChanges: z.boolean(),
      allowTermExtension: z.boolean(),
      calculation: z.enum(['per_day_remaining', 'actual_days_pro_rata']),
      minimumPremiumTreatment: z.literal('block_if_applied'),
      sourceRefs: z.array(text).min(1).max(20),
    }),
  ]),
});
export type InsuranceProductDefinitionV2 = z.infer<typeof insuranceProductDefinitionV2Schema>;
export const configuredSubmissionV2Schema = configuredSubmissionV1Schema.extend({
  schemaVersion: z.literal('insurance-submission-v2'),
  riskGroups: z
    .array(
      z.strictObject({
        groupId: id,
        rows: z
          .array(z.strictObject({ rowId: id, answers: z.record(id, insuranceAnswerSchema) }))
          .max(100),
      }),
    )
    .max(20),
  coverages: z
    .array(
      configuredSubmissionV1Schema.shape.coverages.element.extend({
        scope: selectionScopeSchema,
        aggregateMinor: positiveMoney.optional(),
        attachmentMinor: positiveMoney.optional(),
      }),
    )
    .max(500),
});
export type ConfiguredSubmissionV2 = z.infer<typeof configuredSubmissionV2Schema>;
export const insuranceEvaluationV2Schema = insuranceEvaluationV1Schema.extend({
  engineVersion: z.literal('insurance-decision-v2'),
  purpose: z.enum(['new_business', 'service']),
  serviceEffectiveDate: insuranceDateSchema.nullable(),
  fieldStates: z.array(
    z.strictObject({
      scope: selectionScopeSchema,
      fieldId: id,
      visible: z.enum(['true', 'false', 'unknown']),
      required: z.enum(['true', 'false', 'unknown']),
    }),
  ),
  eligibility: insuranceEvaluationV1Schema.shape.eligibility.extend({
    rules: z.array(ruleEvidence.extend({ scope: selectionScopeSchema })),
  }),
  rating: insuranceEvaluationV1Schema.shape.rating.extend({
    lines: z.array(
      insuranceEvaluationV1Schema.shape.rating.shape.lines.element.extend({
        scope: selectionScopeSchema,
      }),
    ),
    termBasis: z.enum(['whole_term', 'per_day']),
    dailyPremiumMinor: nonnegativeMoney.nullable(),
    termDays: z.number().int(),
  }),
});
export type InsuranceEvaluationV2 = z.infer<typeof insuranceEvaluationV2Schema>;
export const insuranceProductDefinitionSchema = z.discriminatedUnion('schemaVersion', [
  insuranceProductDefinitionV1Schema,
  insuranceProductDefinitionV2Schema,
]);
export type InsuranceProductDefinition = z.infer<typeof insuranceProductDefinitionSchema>;
export const configuredSubmissionSchema = z.union([
  configuredSubmissionV1Schema,
  configuredSubmissionV2Schema,
]);
export type ConfiguredSubmission = z.infer<typeof configuredSubmissionSchema>;
export const insuranceEvaluationSchema = z.discriminatedUnion('engineVersion', [
  insuranceEvaluationV1Schema,
  insuranceEvaluationV2Schema,
]);
export type InsuranceEvaluation = z.infer<typeof insuranceEvaluationSchema>;

export const configuredDecisionSchema = z.strictObject({
  submission: configuredSubmissionSchema,
  evaluation: insuranceEvaluationSchema,
  evaluatedAt: z.string().datetime(),
  bindEvaluation: z
    .strictObject({ evaluation: insuranceEvaluationSchema, evaluatedAt: z.string().datetime() })
    .optional(),
});
