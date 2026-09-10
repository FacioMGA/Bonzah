import { z } from 'zod';
import { id, scopeSchema } from './configuration.js';
import { externalQuoteSchema } from './insurance.js';
import { configuredSubmissionSchema } from './insurance-definition.js';
import { currencySchema } from './money.js';
import {
  providerAdapterDescriptorSchema,
  providerFailureCodeSchema,
  providerReceiptSchema,
  providerSelectionSchema,
} from './provider.js';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime();
export const providerExecutionPolicySchema = z
  .strictObject({
    maxAttempts: z.number().int().min(1).max(10),
    timeoutMs: z.number().int().min(10).max(120_000),
    deadlineMs: z.number().int().min(10).max(86_400_000),
    baseDelayMs: z.number().int().min(1).max(60_000),
    maxDelayMs: z.number().int().min(1).max(3_600_000),
    idempotency: z.enum(['guaranteed', 'unsupported']),
  })
  .refine(
    (p) => p.baseDelayMs <= p.maxDelayMs && p.timeoutMs <= p.deadlineMs,
    'Provider timeout and delay bounds must fit the policy',
  );
export type ProviderExecutionPolicy = z.infer<typeof providerExecutionPolicySchema>;

export const providerRequestSchema = z.strictObject({
  id: z.string().uuid(),
  scope: scopeSchema,
  operation: z.literal('quote'),
  purpose: z.literal('quote_evidence'),
  adapter: providerAdapterDescriptorSchema,
  policy: providerExecutionPolicySchema,
  recordId: z.string().uuid(),
  recordVersion: z.number().int().positive(),
  recordHash: sha,
  releaseId: z.string().uuid(),
  releaseHash: sha,
  selection: providerSelectionSchema,
  riskIdentity: z.literal('configured_submission_v1'),
  submission: configuredSubmissionSchema,
  currency: currencySchema,
  quote: externalQuoteSchema,
  correlationId: z.string().uuid(),
  actorId: id,
  outboundIdempotencyKey: z.string().uuid(),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  streamPosition: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  createdAt: instant,
  deadlineAt: instant,
  requestHash: sha,
});
export type ProviderRequest = z.infer<typeof providerRequestSchema>;

export const providerJobStateSchema = z.strictObject({
  requestId: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum([
    'queued',
    'in_flight',
    'retry_wait',
    'reconciliation_required',
    'completed',
    'failed',
    'superseded',
  ]),
  task: z.enum(['send', 'reconcile']),
  attempts: z.number().int().min(0).max(10),
  nextAttemptAt: instant,
  claim: z.strictObject({ token: z.string().uuid(), expiresAt: instant }).nullable(),
  lastFailure: providerFailureCodeSchema.nullable(),
  receiptHash: sha.nullable(),
  updatedAt: instant,
  stateHash: sha,
});
export type ProviderJobState = z.infer<typeof providerJobStateSchema>;

export const providerAuditSchema = z.strictObject({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  scope: scopeSchema,
  version: z.number().int().positive(),
  kind: z.enum([
    'requested',
    'claimed',
    'retry_requested',
    'retry_scheduled',
    'failed',
    'reconciliation_required',
    'claim_expired',
    'receipt_accepted',
    'receipt_duplicate',
    'callback_rejected',
    'late_attempt_ignored',
    'superseded',
  ]),
  actorId: id.nullable(),
  correlationId: z.string().uuid(),
  attempt: z.number().int().min(0).max(10),
  createdAt: instant,
  stateHash: sha,
  receiptHash: sha.nullable(),
  code: z
    .string()
    .regex(/^[A-Z_a-z0-9]{1,80}$/)
    .nullable(),
  previousHash: sha.nullable(),
  auditHash: sha,
});
export type ProviderAudit = z.infer<typeof providerAuditSchema>;

export const providerExecutionViewSchema = z.strictObject({
  request: providerRequestSchema,
  state: providerJobStateSchema.omit({ claim: true }),
  audit: z.array(providerAuditSchema),
  receipts: z.array(providerReceiptSchema),
  authority: z.literal('evidence_only_no_insurance_mutation'),
});
export type ProviderExecutionView = z.infer<typeof providerExecutionViewSchema>;

export const providerCatalogEntrySchema = z.strictObject({
  descriptor: providerAdapterDescriptorSchema,
  policy: providerExecutionPolicySchema,
  supportedSourceMode: z.literal('configured_product'),
  purpose: z.literal('quote_evidence'),
  canReconcile: z.boolean(),
  connection: z.enum(['synthetic_training', 'registered_live_adapter']),
  grantsBindAuthority: z.literal(false),
});
export const providerOperations = {
  provider_catalog: {
    method: 'GET',
    path: '/api/insurance/providers/catalog',
    permission: 'provider:read',
    summary: 'Discover server-registered quote-evidence adapters and explicit provenance',
    input: z.strictObject({}),
    output: z.strictObject({ adapters: z.array(providerCatalogEntrySchema) }),
  },
  provider_list: {
    method: 'GET',
    path: '/api/insurance/providers/requests',
    permission: 'provider:read',
    summary: 'List the latest 100 scoped durable provider requests',
    input: z.strictObject({ recordId: z.string().uuid().optional() }),
    output: z.strictObject({
      requests: z.array(providerExecutionViewSchema).max(100),
      hasMore: z.boolean(),
    }),
  },
  provider_get: {
    method: 'GET',
    path: '/api/insurance/providers/request',
    permission: 'provider:read',
    summary: 'Read scoped provider evidence and immutable attempt history',
    input: z.strictObject({ requestId: z.string().uuid() }),
    output: providerExecutionViewSchema,
  },
  provider_request: {
    method: 'POST',
    path: '/api/insurance/providers/requests',
    permission: 'provider:request',
    mcp: false,
    summary:
      'Queue evidence for an exact configured record and immutable release; grants no bind authority',
    input: z.strictObject({
      recordId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      expectedRecordHash: sha,
      adapterId: id,
      idempotencyKey: z.string().uuid(),
    }),
    output: providerExecutionViewSchema,
  },
  provider_retry: {
    method: 'POST',
    path: '/api/insurance/providers/retry',
    permission: 'provider:request',
    mcp: false,
    summary: 'Resume a due retry or request supported reconciliation within the original limits',
    input: z.strictObject({
      requestId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      idempotencyKey: z.string().uuid(),
    }),
    output: providerExecutionViewSchema,
  },
} as const;
export type ProviderOperationName = keyof typeof providerOperations;
