import { z } from 'zod';
import {
  configuredSubmissionV2Schema,
  insuranceEvaluationV2Schema,
  insuranceDateSchema,
} from './insurance-definition.js';
import { minorUnitSchema } from './money.js';
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(1000);
export const configuredServiceInputSchema = z.strictObject({
  recordId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  recordHash: sha,
  submission: configuredSubmissionV2Schema,
  effectiveDate: insuranceDateSchema,
  reason: text,
  evidenceRefs: z.array(text).min(1).max(20),
});
export type ConfiguredServiceInput = z.infer<typeof configuredServiceInputSchema>;
export const serviceCalculationSchema = z.strictObject({
  method: z.enum(['per_day_remaining', 'actual_days_pro_rata']),
  rounding: z.literal('half-away-from-zero'),
  oldTermDays: z.number().int().positive(),
  newTermDays: z.number().int().positive(),
  oldRemainingDays: z.number().int().nonnegative(),
  newRemainingDays: z.number().int().nonnegative(),
  removedPremiumMinor: minorUnitSchema,
  addedPremiumMinor: minorUnitSchema,
  premiumDeltaMinor: minorUnitSchema,
  resultingPremiumMinor: minorUnitSchema,
});
export const configuredServiceEvaluationSchema = z.strictObject({
  schemaVersion: z.literal('insurance-service-v1'),
  recordId: z.string().uuid(),
  priorVersion: z.number().int().positive(),
  priorRecordHash: sha,
  priorSubmissionHash: sha,
  submission: configuredSubmissionV2Schema,
  evaluation: insuranceEvaluationV2Schema,
  effectiveDate: insuranceDateSchema,
  reason: text,
  evidenceRefs: z.array(text).min(1).max(20),
  status: z.enum(['allowed', 'blocked']),
  reasons: z.array(text),
  calculation: serviceCalculationSchema.nullable(),
  evaluationHash: sha,
});
export type ConfiguredServiceEvaluation = z.infer<typeof configuredServiceEvaluationSchema>;
export const configuredServiceEvidenceSchema = configuredServiceEvaluationSchema.extend({
  evaluatedAt: z.string().datetime(),
});

export const configuredCancellationInputSchema = z.strictObject({
  recordId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  recordHash: sha,
  effectiveDate: insuranceDateSchema,
  reason: text,
  evidenceRefs: z.array(text).min(1).max(20),
});
export type ConfiguredCancellationInput = z.infer<typeof configuredCancellationInputSchema>;
export const configuredCancellationEvaluationSchema = z.strictObject({
  schemaVersion: z.literal('insurance-cancellation-v1'),
  recordId: z.string().uuid(),
  priorVersion: z.number().int().positive(),
  priorRecordHash: sha,
  priorSubmissionHash: sha,
  definitionHash: sha,
  releaseHash: sha,
  evaluatedOn: insuranceDateSchema,
  effectiveDate: insuranceDateSchema,
  reason: text,
  evidenceRefs: z.array(text).min(1).max(20),
  status: z.enum(['allowed', 'blocked']),
  reasons: z.array(text),
  calculation: z
    .strictObject({
      method: z.enum(['per_day_remaining', 'actual_days_pro_rata']),
      rounding: z.literal('half-away-from-zero'),
      termDays: z.number().int().positive(),
      remainingDays: z.number().int().nonnegative(),
      returnPremiumMinor: minorUnitSchema,
      premiumDeltaMinor: minorUnitSchema,
      resultingPremiumMinor: minorUnitSchema,
    })
    .nullable(),
  refundStatus: z.literal('not_requested'),
  noticeStatus: z.literal('not_issued'),
  evaluationHash: sha,
});
export type ConfiguredCancellationEvaluation = z.infer<
  typeof configuredCancellationEvaluationSchema
>;
export const configuredCancellationEvidenceSchema = configuredCancellationEvaluationSchema.extend({
  evaluatedAt: z.string().datetime(),
});
