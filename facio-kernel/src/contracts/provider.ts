import { z } from 'zod';
import { id, scopeSchema } from './configuration.js';
import { externalQuoteSchema } from './insurance.js';
import { currencySchema } from './money.js';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const version = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/)
  .max(40);
const reference = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\u0000-\u001f\u007f]+$/)
  .refine((value) => value === value.trim(), 'Provider references must be canonical');
const evidenceRef = z.string().regex(/^evidence:\/\/[a-zA-Z0-9/_:.-]{1,250}$/);
const instant = z.string().datetime();

/** This identity is compared with the selection pinned by the owning application. */
export const providerSelectionSchema = z.strictObject({
  quoteReference: reference,
  quoteVersion: reference,
  quoteHash: sha256,
  riskHash: sha256,
});
export type ProviderSelection = z.infer<typeof providerSelectionSchema>;

export const providerFailureCodeSchema = z.enum([
  'timeout',
  'unavailable',
  'rate_limited',
  'rejected',
  'invalid_response',
  'unauthorized',
  'unsupported',
]);

// Provider declarations are evidence. None of these outcomes grants bind, payment or authority.
export const providerOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('quote_ready'),
    currency: currencySchema,
    quote: externalQuoteSchema,
  }),
  z.strictObject({ kind: z.literal('referred'), reasonCodes: z.array(id).min(1).max(50) }),
  z.strictObject({ kind: z.literal('declined'), reasonCodes: z.array(id).min(1).max(50) }),
  z.strictObject({ kind: z.literal('bind_confirmed'), externalBindingReference: reference }),
  z.strictObject({ kind: z.literal('failure'), code: providerFailureCodeSchema }),
]);

export const providerEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal('provider-envelope-v1'),
  providerId: id,
  adapterId: id,
  adapterVersion: version,
  mappingVersion: version,
  eventId: reference,
  idempotencyKey: reference,
  correlationId: z.string().uuid(),
  operation: z.enum(['quote', 'bind']),
  selection: providerSelectionSchema,
  sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  occurredAt: instant,
  source: z.strictObject({
    submissionReference: reference,
    riskReference: reference,
    payloadHash: sha256,
    evidenceRefs: z.array(evidenceRef).min(1).max(20),
  }),
  outcome: providerOutcomeSchema,
});
export type ProviderEnvelope = z.infer<typeof providerEnvelopeSchema>;

export const providerAuthenticityMethodSchema = z.enum([
  'hmac_sha256',
  'oauth_token',
  'mutual_tls',
  'synthetic_fixture',
]);
export const providerAdapterDescriptorSchema = z
  .strictObject({
    providerId: id,
    adapterId: id,
    adapterVersion: version,
    mappingVersion: version,
    mode: z.enum(['live', 'synthetic']),
    operations: z
      .array(z.enum(['quote', 'bind']))
      .min(1)
      .max(2),
    authenticityMethod: providerAuthenticityMethodSchema,
    maxPayloadBytes: z.number().int().min(1).max(1_048_576),
    maxEventAgeMs: z.number().int().min(1).max(86_400_000),
    maxFutureSkewMs: z.number().int().min(0).max(300_000),
    ordering: z.literal('strict_sequence'),
  })
  .superRefine((value, context) => {
    if ((value.mode === 'synthetic') !== (value.authenticityMethod === 'synthetic_fixture'))
      context.addIssue({
        code: 'custom',
        message: 'Synthetic evidence and live authentication cannot be interchanged',
      });
    if (new Set(value.operations).size !== value.operations.length)
      context.addIssue({ code: 'custom', message: 'Adapter operations must be unique' });
  });
export type ProviderAdapterDescriptor = z.infer<typeof providerAdapterDescriptorSchema>;

export const providerAuthenticationSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('verified'),
    method: providerAuthenticityMethodSchema,
    principalRef: id,
    evidenceRef,
  }),
  z.strictObject({ status: z.enum(['failed', 'unavailable', 'unsupported']) }),
]);
export type ProviderAuthentication = z.infer<typeof providerAuthenticationSchema>;

const receiptContent = {
  receiptVersion: z.literal('provider-receipt-v1'),
  scope: scopeSchema,
  mode: z.enum(['live', 'synthetic']),
  eventKey: sha256,
  idempotencyKey: sha256,
  streamKey: sha256,
  envelopeHash: sha256,
  envelope: providerEnvelopeSchema,
  authentication: providerAuthenticationSchema.options[0],
  acceptedAt: instant,
};
export const providerReceiptSchema = z
  .strictObject({ ...receiptContent, receiptHash: sha256 })
  .refine(
    (value) =>
      (value.mode === 'synthetic') === (value.authentication.method === 'synthetic_fixture'),
    'Receipt provenance must distinguish live authentication from synthetic evidence',
  );
export type ProviderReceipt = z.infer<typeof providerReceiptSchema>;

export const providerRetryInputSchema = z
  .strictObject({
    operation: z.enum(['quote', 'bind']),
    failureCode: providerFailureCodeSchema,
    deliveryState: z.enum(['not_sent', 'confirmed_failed', 'sent_unknown']),
    idempotency: z.enum(['guaranteed', 'unsupported']),
    idempotencyKey: reference,
    attempt: z.number().int().min(1).max(20),
    maxAttempts: z.number().int().min(1).max(20),
    now: instant,
    deadlineAt: instant,
    timeoutMs: z.number().int().min(1).max(120_000),
    baseDelayMs: z.number().int().min(1).max(60_000),
    maxDelayMs: z.number().int().min(1).max(3_600_000),
    retryAfterMs: z.number().int().min(0).max(3_600_000).optional(),
  })
  .refine(
    (value) => value.baseDelayMs <= value.maxDelayMs && value.attempt <= value.maxAttempts,
    'Retry counters and delay bounds must be consistent',
  );
export type ProviderRetryInput = z.infer<typeof providerRetryInputSchema>;

export const providerRetryDecisionSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('retry'),
    nextAttempt: z.number().int().min(2).max(20),
    idempotencyKey: reference,
    notBefore: instant,
    timeoutMs: z.number().int().min(1).max(120_000),
  }),
  z.strictObject({
    action: z.literal('stop'),
    reason: z.enum([
      'permanent_failure',
      'attempts_exhausted',
      'deadline_exceeded',
      'retry_after_exceeds_policy',
    ]),
  }),
  z.strictObject({
    action: z.literal('reconcile'),
    reason: z.literal('ambiguous_external_outcome'),
  }),
]);
export type ProviderRetryDecision = z.infer<typeof providerRetryDecisionSchema>;
