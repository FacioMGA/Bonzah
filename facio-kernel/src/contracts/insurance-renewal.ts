import { z } from 'zod';
import { configuredSubmissionSchema, insuranceEvaluationSchema } from './insurance-definition.js';
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/),
  sha = z.string().regex(/^[a-f0-9]{64}$/);
export const renewalInputSchema = z.strictObject({
  sourceRecordId: z.string().uuid(),
  sourceVersion: z.number().int().positive(),
  sourceRecordHash: sha,
  productId: id,
  productVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  submission: configuredSubmissionSchema,
});
export type RenewalInput = z.infer<typeof renewalInputSchema>;
export const renewalSourceSchema = z.strictObject({
  recordId: z.string().uuid(),
  version: z.number().int().positive(),
  recordHash: sha,
  quoteHash: sha,
  submissionHash: sha,
  runtimeReleaseId: z.string().uuid(),
});
export const renewalComparisonSchema = z.strictObject({
  changedSections: z.array(z.string()),
  addedRiskRows: z.array(z.string()),
  removedRiskRows: z.array(z.string()),
  changedRiskRows: z.array(z.string()),
});
export const renewalEvaluationSchema = z.strictObject({
  source: renewalSourceSchema,
  comparison: renewalComparisonSchema,
  evaluation: insuranceEvaluationSchema,
  renewalHash: sha,
});
export const renewalEvidenceSchema = z.strictObject({
  source: renewalSourceSchema,
  comparison: renewalComparisonSchema,
  requestedAt: z.string().datetime(),
  actorId: id,
});
