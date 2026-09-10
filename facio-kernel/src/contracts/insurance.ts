import { z } from 'zod';
import {
  renewalInputSchema,
  renewalEvaluationSchema,
  renewalEvidenceSchema,
} from './insurance-renewal.js';
import { id, scopeSchema } from './configuration.js';
import {
  configuredCancellationInputSchema,
  configuredCancellationEvaluationSchema,
  configuredCancellationEvidenceSchema,
  configuredServiceInputSchema,
  configuredServiceEvaluationSchema,
  configuredServiceEvidenceSchema,
} from './insurance-service.js';
import { bindApprovalEvidenceSchema } from './approval.js';
import {
  configuredDecisionSchema,
  configuredSubmissionSchema,
  insuranceEvaluationSchema,
  insuranceProductDefinitionSchema,
} from './insurance-definition.js';
import {
  currencySchema,
  financialAllocationInputSchema,
  financialAllocationResultSchema,
  minorUnitSchema,
} from './money.js';

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + 'T00:00:00.000Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Use a real calendar date');
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const text = z.string().trim().min(1).max(1000);
const positiveMoney = minorUnitSchema.refine(
  (value) => minorUnitSchema.safeParse(value).success && BigInt(value) > 0n,
  'Premium must be positive',
);
const requirementGate = z.enum(['not_required', 'required_unsupported']);

export const runtimePolicySchema = z.strictObject({
  id,
  version,
  name: z.string().trim().min(1).max(200),
  currency: currencySchema,
  effectiveFrom: dateOnlySchema,
  effectiveTo: dateOnlySchema,
  maximumPremiumMinor: positiveMoney,
  maximumParticipants: z.number().int().min(1).max(100),
  commission: financialAllocationInputSchema.shape.commission,
  requirements: z.strictObject({
    payment: requirementGate,
    approval: z.enum(['not_required', 'required_unsupported', 'independent_review']),
    providerVerification: requirementGate,
  }),
});
export type RuntimePolicy = z.infer<typeof runtimePolicySchema>;
export const scopedRuntimePolicySchema = z.strictObject({
  scope: scopeSchema,
  policy: runtimePolicySchema,
  policyHash: sha256,
});
export type ScopedRuntimePolicy = z.infer<typeof scopedRuntimePolicySchema>;

export const externalQuoteSchema = z.strictObject({
  sourceQuote: z.strictObject({
    reference: text,
    version: text,
    evidenceRefs: z.array(text).min(1).max(20),
  }),
  risk: z.strictObject({ summary: text, externalRiskReference: text.nullable() }),
  term: z.strictObject({ startDate: dateOnlySchema, endDate: dateOnlySchema }),
  expiresAt: z.string().datetime(),
  eligibility: z.enum(['quote_ready', 'referred', 'declined']),
  premiumMinor: positiveMoney,
  participants: financialAllocationInputSchema.shape.participants,
});
export type ExternalQuote = z.infer<typeof externalQuoteSchema>;

export const insuranceRecordSchema = z.strictObject({
  id: z.string().uuid(),
  scope: scopeSchema,
  status: z.enum(['quoted', 'bound', 'cancelled']),
  sourceMode: z.enum(['manual_external_quote', 'configured_product']),
  version: z.number().int().positive(),
  recordHash: sha256,
  quoteHash: sha256,
  productId: id,
  productVersion: version,
  productPolicyHash: sha256,
  runtimeReleaseId: z.string().uuid().optional(),
  quote: externalQuoteSchema,
  currency: currencySchema,
  premiumMinor: minorUnitSchema.refine(
    (value) => minorUnitSchema.safeParse(value).success && BigInt(value) >= 0n,
  ),
  financials: financialAllocationResultSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastEffectiveDate: dateOnlySchema.nullable(),
  decision: configuredDecisionSchema.optional(),
  approval: bindApprovalEvidenceSchema.optional(),
  configuredService: configuredServiceEvidenceSchema.optional(),
  configuredCancellation: configuredCancellationEvidenceSchema.optional(),
  renewal: renewalEvidenceSchema.optional(),
});
export type InsuranceRecord = z.infer<typeof insuranceRecordSchema>;
export const insuranceEventSchema = z.strictObject({
  id: z.string().uuid(),
  scope: scopeSchema,
  recordId: z.string().uuid(),
  version: z.number().int().positive(),
  type: z.enum([
    'quote_created',
    'quote_revised',
    'bound',
    'endorsement',
    'cancellation',
    'reinstatement',
  ]),
  actorId: id,
  correlationId: z.string().uuid(),
  createdAt: z.string().datetime(),
  effectiveDate: dateOnlySchema.nullable(),
  reason: text,
  premiumDeltaMinor: minorUnitSchema,
  recordHash: sha256,
  previousRecordHash: sha256.nullable(),
});
export type InsuranceEvent = z.infer<typeof insuranceEventSchema>;
export const insuranceMutationResultSchema = z.strictObject({
  record: insuranceRecordSchema,
  event: insuranceEventSchema,
});
export type InsuranceMutationResult = z.infer<typeof insuranceMutationResultSchema>;
const recordInput = z.strictObject({ recordId: z.string().uuid() });
const mutationIdentity = {
  idempotencyKey: z.string().uuid(),
  recordId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
};

export const insuranceOperations = {
  insurance_evaluate_renewal: {
    readOnly: true,
    method: 'POST',
    path: '/api/insurance/renewal/evaluate',
    permission: 'insurance:read',
    summary: 'Compare a proposed distinct renewal term against an exact expiring policy revision',
    input: renewalInputSchema,
    output: renewalEvaluationSchema,
  },
  insurance_create_renewal_quote: {
    method: 'POST',
    path: '/api/insurance/renewal-quotes',
    permission: 'insurance:quote',
    mcp: false,
    summary:
      'Create a separate renewal quote with current decisions and a pinned expiring-policy comparison',
    input: renewalInputSchema.extend({
      participants: financialAllocationInputSchema.shape.participants,
      idempotencyKey: z.string().uuid(),
      expectedRenewalHash: sha256,
    }),
    output: insuranceMutationResultSchema,
  },
  insurance_evaluate_cancellation: {
    readOnly: true,
    method: 'POST',
    path: '/api/insurance/cancellation/evaluate',
    permission: 'insurance:read',
    summary:
      'Calculate an explicitly configured return premium without issuing a notice or cash refund',
    input: configuredCancellationInputSchema,
    output: configuredCancellationEvaluationSchema,
  },
  insurance_cancel_configured: {
    method: 'POST',
    path: '/api/insurance/configured-cancellation',
    permission: 'insurance:service',
    mcp: false,
    summary:
      'Retain configured cancellation and earned/return premium evidence; no cash refund or notice is issued',
    input: configuredCancellationInputSchema.extend({
      idempotencyKey: z.string().uuid(),
      expectedEvaluationHash: sha256,
    }),
    output: insuranceMutationResultSchema,
  },
  insurance_evaluate_service: {
    readOnly: true,
    method: 'POST',
    path: '/api/insurance/service/evaluate',
    permission: 'insurance:read',
    summary:
      'Preview a retained configured policy change and exact remaining-term premium movement',
    input: configuredServiceInputSchema,
    output: configuredServiceEvaluationSchema,
  },
  insurance_service_configured: {
    method: 'POST',
    path: '/api/insurance/configured-service',
    permission: 'insurance:service',
    mcp: false,
    summary: 'Record a configured risk or term change using the pinned remaining-term evaluation',
    input: configuredServiceInputSchema.extend({
      idempotencyKey: z.string().uuid(),
      expectedEvaluationHash: sha256,
    }),
    output: insuranceMutationResultSchema,
  },
  insurance_evaluate_product: {
    readOnly: true,
    method: 'POST',
    path: '/api/insurance/evaluate',
    permission: 'insurance:read',
    summary:
      'Evaluate the pinned active insurance definition without creating a quote or asserting source approval',
    input: z.strictObject({
      productId: id,
      productVersion: version,
      recordId: z.string().uuid().optional(),
      submission: configuredSubmissionSchema,
    }),
    output: insuranceEvaluationSchema,
  },
  insurance_create_configured_quote: {
    method: 'POST',
    path: '/api/insurance/configured-quotes',
    permission: 'insurance:quote',
    mcp: false,
    summary:
      'Capture server-derived product rating and decisions after checking the selected evaluation hash',
    input: z.strictObject({
      idempotencyKey: z.string().uuid(),
      productId: id,
      productVersion: version,
      submission: configuredSubmissionSchema,
      participants: financialAllocationInputSchema.shape.participants,
      expectedEvaluationHash: sha256,
    }),
    output: insuranceMutationResultSchema,
  },
  insurance_revise_configured_quote: {
    method: 'PUT',
    path: '/api/insurance/configured-quotes',
    permission: 'insurance:quote',
    mcp: false,
    summary: 'Re-evaluate an unbound configured quote against its retained insurance definition',
    input: z.strictObject({
      ...mutationIdentity,
      recordHash: sha256,
      submission: configuredSubmissionSchema,
      participants: financialAllocationInputSchema.shape.participants,
      expectedEvaluationHash: sha256,
    }),
    output: insuranceMutationResultSchema,
  },
  insurance_record_definition: {
    method: 'GET',
    path: '/api/insurance/record-definition',
    permission: 'insurance:read',
    summary: 'Resolve the selected record’s exact retained product definition and operating policy',
    input: recordInput,
    output: z.strictObject({
      recordId: z.string().uuid(),
      policy: runtimePolicySchema,
      policyHash: sha256,
      runtimeReleaseId: z.string().uuid().nullable(),
      insurance: insuranceProductDefinitionSchema.nullable(),
      definitionHash: sha256.nullable(),
    }),
  },
  insurance_catalog: {
    method: 'GET',
    path: '/api/insurance/catalog',
    permission: 'insurance:read',
    summary: 'Inspect immutable scoped policies for the local manual insurance runtime',
    input: z.strictObject({}),
    output: z.strictObject({
      policies: z.array(
        z.strictObject({
          policyHash: sha256,
          policy: runtimePolicySchema,
          runtimeReleaseId: z.string().uuid().optional(),
          insurance: insuranceProductDefinitionSchema.optional(),
          definitionHash: sha256.optional(),
        }),
      ),
    }),
  },
  insurance_list: {
    method: 'GET',
    path: '/api/insurance/records',
    permission: 'insurance:read',
    summary: 'List up to 100 latest scoped local insurance records',
    input: z.strictObject({}),
    output: z.strictObject({
      records: z.array(insuranceRecordSchema).max(100),
      hasMore: z.boolean(),
    }),
  },
  insurance_get: {
    method: 'GET',
    path: '/api/insurance/record',
    permission: 'insurance:read',
    summary: 'Inspect one scoped local insurance record and its selected quote',
    input: recordInput,
    output: z.strictObject({ record: insuranceRecordSchema }),
  },
  insurance_history: {
    method: 'GET',
    path: '/api/insurance/history',
    permission: 'insurance:read',
    summary: 'Inspect immutable scoped insurance revisions and events',
    input: recordInput,
    output: z.strictObject({
      recordId: z.string().uuid(),
      revisions: z.array(insuranceRecordSchema),
      events: z.array(insuranceEventSchema),
    }),
  },
  insurance_create_quote: {
    method: 'POST',
    path: '/api/insurance/quotes',
    permission: 'insurance:quote',
    mcp: false,
    summary:
      'Capture a manually supplied external quote in the local runtime; no provider verification is implied',
    input: z.strictObject({
      idempotencyKey: z.string().uuid(),
      productId: id,
      productVersion: version,
      quote: externalQuoteSchema,
    }),
    output: insuranceMutationResultSchema,
  },
  insurance_revise_quote: {
    method: 'PUT',
    path: '/api/insurance/quotes',
    permission: 'insurance:quote',
    mcp: false,
    summary: 'Revise an unbound external quote with optimistic concurrency',
    input: z.strictObject({ ...mutationIdentity, recordHash: sha256, quote: externalQuoteSchema }),
    output: insuranceMutationResultSchema,
  },
  insurance_bind: {
    method: 'POST',
    path: '/api/insurance/bind',
    permission: 'insurance:bind',
    mcp: false,
    summary:
      'Bind the exact stored quote locally after checking its revision, expiry and server policy prerequisites',
    input: z.strictObject({
      ...mutationIdentity,
      quoteHash: sha256,
      approvalId: z.string().uuid().optional(),
    }),
    output: insuranceMutationResultSchema,
  },
  insurance_service: {
    method: 'POST',
    path: '/api/insurance/service',
    permission: 'insurance:service',
    mcp: false,
    summary:
      'Record an explicit manual endorsement, cancellation or reinstatement delta locally without automatic proration',
    input: z.strictObject({
      ...mutationIdentity,
      recordHash: sha256,
      action: z.enum(['endorsement', 'cancellation', 'reinstatement']),
      premiumDeltaMinor: minorUnitSchema,
      effectiveDate: dateOnlySchema,
      reason: text,
    }),
    output: insuranceMutationResultSchema,
  },
} as const;
export type InsuranceOperationName = keyof typeof insuranceOperations;
