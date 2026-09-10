import { createHash } from 'node:crypto';
import { z } from 'zod';
import { scopeSchema, type Scope } from '../contracts/configuration.js';
import {
  providerAdapterDescriptorSchema,
  providerAuthenticationSchema,
  providerEnvelopeSchema,
  providerReceiptSchema,
  providerRetryInputSchema,
  providerSelectionSchema,
  type ProviderAdapterDescriptor,
  type ProviderAuthentication,
  type ProviderEnvelope,
  type ProviderReceipt,
  type ProviderRetryDecision,
  type ProviderRetryInput,
  type ProviderSelection,
} from '../contracts/provider.js';
import { hash, KernelError } from './canonical.js';

/**
 * Registered server code, never an operation/tool input. verify must authenticate the exact bytes
 * and authorized provider principal using server-resolved credentials/transport context. No
 * protocol implementation, credential lookup or live provider registration is supplied here.
 */
export interface ProviderAdapter {
  descriptor: ProviderAdapterDescriptor;
  verify?: (body: Uint8Array) => ProviderAuthentication;
  normalize: (body: Uint8Array) => unknown;
}

export interface ProviderHistory {
  byEvent: ProviderReceipt | null;
  byIdempotency: ProviderReceipt | null;
  latestInStream: ProviderReceipt | null;
}

function invalid(code: string, message: string, status = 422): never {
  throw new KernelError(code, message, status);
}
const bytesHash = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex');

/** Keys include the whole server scope. Lookups must retain historical receipts across versions. */
export function providerReceiptKeys(scope: Scope, envelope: ProviderEnvelope) {
  return {
    eventKey: hash({ scope, providerId: envelope.providerId, eventId: envelope.eventId }),
    idempotencyKey: hash({
      scope,
      providerId: envelope.providerId,
      idempotencyKey: envelope.idempotencyKey,
    }),
    streamKey: hash({
      scope,
      providerId: envelope.providerId,
      quoteReference: envelope.selection.quoteReference,
    }),
  };
}

function verifyStoredReceipt(receipt: ProviderReceipt, scope: Scope): void {
  const parsed = providerReceiptSchema.safeParse(receipt);
  if (!parsed.success) invalid('INTEGRITY_ERROR', 'Stored provider receipt is malformed', 500);
  const { receiptHash, ...content } = parsed.data;
  const keys = providerReceiptKeys(content.scope, content.envelope);
  if (
    hash(content) !== receiptHash ||
    hash(scope) !== hash(content.scope) ||
    hash(content.envelope) !== content.envelopeHash ||
    keys.eventKey !== content.eventKey ||
    keys.idempotencyKey !== content.idempotencyKey ||
    keys.streamKey !== content.streamKey
  )
    invalid('INTEGRITY_ERROR', 'Stored provider receipt does not match its scope or content', 500);
}

/**
 * Pure boundary decision only. The owner must transactionally persist the returned receipt and
 * business outcome under unique event/idempotency/sequence constraints. This does not dispatch,
 * change an insurance record, grant bind authority, verify payment or claim provider acceptance.
 */
export function acceptProviderDelivery(input: {
  scope: Scope;
  adapter: ProviderAdapter;
  rawBody: Uint8Array;
  expectedSelection: ProviderSelection;
  now: string;
  history: ProviderHistory;
}): { disposition: 'accepted' | 'duplicate'; receipt: ProviderReceipt } {
  const scopeResult = scopeSchema.safeParse(input.scope);
  const descriptorResult = providerAdapterDescriptorSchema.safeParse(input.adapter.descriptor);
  const selectionResult = providerSelectionSchema.safeParse(input.expectedSelection);
  if (
    !scopeResult.success ||
    !descriptorResult.success ||
    !selectionResult.success ||
    !z.string().datetime().safeParse(input.now).success
  )
    invalid('INVALID_PROVIDER_CONTEXT', 'Provider boundary requires valid server context');
  const scope = scopeResult.data;
  const descriptor = descriptorResult.data;
  const historyResult = z
    .strictObject({
      byEvent: providerReceiptSchema.nullable(),
      byIdempotency: providerReceiptSchema.nullable(),
      latestInStream: providerReceiptSchema.nullable(),
    })
    .safeParse(input.history);
  if (!historyResult.success)
    invalid('INTEGRITY_ERROR', 'Stored provider history is incomplete or malformed', 500);
  const history = historyResult.data;
  if (descriptor.mode === 'synthetic' && scope.environment === 'production')
    invalid(
      'SYNTHETIC_PROVIDER_FORBIDDEN',
      'Synthetic providers cannot supply production evidence',
      403,
    );
  if (
    !(input.rawBody instanceof Uint8Array) ||
    input.rawBody.byteLength === 0 ||
    input.rawBody.byteLength > descriptor.maxPayloadBytes
  )
    invalid(
      'INVALID_PROVIDER_PAYLOAD',
      'Provider payload is empty or exceeds the registered limit',
    );
  if (typeof input.adapter.verify !== 'function')
    invalid('PROVIDER_AUTH_UNAVAILABLE', 'No registered provider verifier is available', 503);

  // Separate copies prevent an adapter callback from changing bytes subsequently authenticated/mapped.
  const body = Uint8Array.from(input.rawBody);
  let verification: unknown;
  try {
    verification = input.adapter.verify(Uint8Array.from(body));
  } catch {
    invalid('PROVIDER_AUTH_UNAVAILABLE', 'Provider verification could not complete', 503);
  }
  const authentication = providerAuthenticationSchema.safeParse(verification);
  if (!authentication.success)
    invalid('PROVIDER_AUTH_FAILED', 'Provider verification returned an invalid result', 401);
  if (authentication.data.status !== 'verified') {
    const status = authentication.data.status;
    invalid(
      status === 'failed' ? 'PROVIDER_AUTH_FAILED' : 'PROVIDER_AUTH_UNAVAILABLE',
      'Provider authenticity has not been established',
      status === 'failed' ? 401 : 503,
    );
  }
  if (authentication.data.method !== descriptor.authenticityMethod)
    invalid(
      'PROVIDER_AUTH_FAILED',
      'Provider verification method does not match its registration',
      401,
    );
  let normalized: unknown;
  try {
    normalized = input.adapter.normalize(Uint8Array.from(body));
  } catch {
    invalid(
      'INVALID_PROVIDER_RESPONSE',
      'Registered provider mapping could not normalize the payload',
    );
  }
  const parsed = providerEnvelopeSchema.safeParse(normalized);
  if (!parsed.success)
    invalid(
      'INVALID_PROVIDER_RESPONSE',
      'Provider payload does not conform to the registered envelope',
    );
  const envelope = parsed.data;
  if (
    envelope.providerId !== descriptor.providerId ||
    envelope.adapterId !== descriptor.adapterId ||
    envelope.adapterVersion !== descriptor.adapterVersion ||
    envelope.mappingVersion !== descriptor.mappingVersion ||
    !descriptor.operations.includes(envelope.operation)
  )
    invalid(
      'UNSUPPORTED_PROVIDER_CONTRACT',
      'Provider adapter, mapping or operation is not registered',
    );
  if (envelope.source.payloadHash !== bytesHash(body))
    invalid(
      'PROVIDER_PAYLOAD_MISMATCH',
      'Provider provenance does not match the authenticated bytes',
    );
  if (
    (envelope.operation === 'bind' &&
      !['bind_confirmed', 'failure'].includes(envelope.outcome.kind)) ||
    (envelope.operation === 'quote' && envelope.outcome.kind === 'bind_confirmed')
  )
    invalid('INVALID_PROVIDER_OUTCOME', 'Provider outcome is incompatible with its operation');
  if (envelope.outcome.kind === 'quote_ready') {
    const quote = envelope.outcome.quote;
    if (
      quote.eligibility !== 'quote_ready' ||
      hash(quote) !== envelope.selection.quoteHash ||
      quote.sourceQuote.reference !== envelope.selection.quoteReference ||
      quote.sourceQuote.version !== envelope.selection.quoteVersion
    )
      invalid(
        'PROVIDER_QUOTE_MISMATCH',
        'Provider quote does not match the exact selected quote identity',
      );
  }

  const keys = providerReceiptKeys(scope, envelope);
  const envelopeHash = hash(envelope);
  for (const [lookup, receipt] of Object.entries(history)) {
    if (!receipt) continue;
    verifyStoredReceipt(receipt, scope);
    const expectedKey =
      lookup === 'byEvent'
        ? 'eventKey'
        : lookup === 'byIdempotency'
          ? 'idempotencyKey'
          : 'streamKey';
    if (receipt[expectedKey] !== keys[expectedKey])
      invalid('INTEGRITY_ERROR', 'Provider history lookup returned a different identity', 500);
  }
  const duplicates = [history.byEvent, history.byIdempotency].filter((item) => item !== null);
  if (duplicates.length) {
    for (const receipt of duplicates) {
      if (receipt.envelopeHash !== envelopeHash || receipt.mode !== descriptor.mode)
        invalid(
          'PROVIDER_REPLAY_CONFLICT',
          'Provider identity was previously used for different content',
          409,
        );
    }
    if (duplicates.length === 2 && duplicates[0]!.receiptHash !== duplicates[1]!.receiptHash)
      invalid('INTEGRITY_ERROR', 'Provider duplicate indexes disagree', 500);
    return { disposition: 'duplicate', receipt: duplicates[0]! };
  }
  if (hash(envelope.selection) !== hash(selectionResult.data))
    invalid(
      'PROVIDER_SELECTION_MISMATCH',
      'Provider outcome targets a different pinned quote or risk',
      409,
    );
  const now = Date.parse(input.now);
  const occurredAt = Date.parse(envelope.occurredAt);
  if (occurredAt > now + descriptor.maxFutureSkewMs || occurredAt < now - descriptor.maxEventAgeMs)
    invalid(
      'PROVIDER_EVENT_EXPIRED',
      'Provider event is outside the configured freshness window',
      409,
    );
  if (
    envelope.outcome.kind === 'quote_ready' &&
    Date.parse(envelope.outcome.quote.expiresAt) <= now
  )
    invalid('PROVIDER_QUOTE_EXPIRED', 'Provider quote is already expired', 409);
  const latest = history.latestInStream;
  if (envelope.sequence !== (latest?.envelope.sequence ?? 0) + 1)
    invalid(
      'PROVIDER_SEQUENCE_CONFLICT',
      'Provider event is stale or has an unresolved sequence gap',
      409,
    );
  if (latest && occurredAt < Date.parse(latest.envelope.occurredAt))
    invalid(
      'PROVIDER_SEQUENCE_CONFLICT',
      'Provider event time precedes the prior accepted event',
      409,
    );
  const content = {
    receiptVersion: 'provider-receipt-v1' as const,
    scope,
    mode: descriptor.mode,
    ...keys,
    envelopeHash,
    envelope,
    authentication: authentication.data,
    acceptedAt: input.now,
  };
  return {
    disposition: 'accepted',
    receipt: providerReceiptSchema.parse({ ...content, receiptHash: hash(content) }),
  };
}

/** No sleeping or dispatch. An owning durable worker must claim work before using this decision. */
export function planProviderRetry(input: ProviderRetryInput): ProviderRetryDecision {
  const parsed = providerRetryInputSchema.safeParse(input);
  if (!parsed.success)
    invalid('INVALID_PROVIDER_RETRY', 'Provider retry policy or attempt is invalid');
  const value = parsed.data;
  // A timeout can hide a completed external mutation. Preserve this uncertainty even at a deadline.
  if (
    value.deliveryState === 'sent_unknown' &&
    (value.operation === 'bind' || value.idempotency !== 'guaranteed')
  )
    return { action: 'reconcile', reason: 'ambiguous_external_outcome' };
  if (!['timeout', 'unavailable', 'rate_limited'].includes(value.failureCode))
    return { action: 'stop', reason: 'permanent_failure' };
  if (value.attempt >= value.maxAttempts) return { action: 'stop', reason: 'attempts_exhausted' };
  if ((value.retryAfterMs ?? 0) > value.maxDelayMs)
    return { action: 'stop', reason: 'retry_after_exceeds_policy' };
  const delay = Math.max(
    value.retryAfterMs ?? 0,
    Math.min(value.maxDelayMs, value.baseDelayMs * 2 ** (value.attempt - 1)),
  );
  const nextTime = Date.parse(value.now) + delay;
  if (nextTime + value.timeoutMs > Date.parse(value.deadlineAt))
    return { action: 'stop', reason: 'deadline_exceeded' };
  return {
    action: 'retry',
    nextAttempt: value.attempt + 1,
    idempotencyKey: value.idempotencyKey,
    notBefore: new Date(nextTime).toISOString(),
    timeoutMs: value.timeoutMs,
  };
}
