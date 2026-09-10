import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  providerEnvelopeSchema,
  providerReceiptSchema,
  providerRetryDecisionSchema,
  type ProviderEnvelope,
  type ProviderRetryInput,
} from '../src/contracts/provider.js';
import {
  acceptProviderDelivery,
  planProviderRetry,
  providerReceiptKeys,
  type ProviderAdapter,
  type ProviderHistory,
} from '../src/domain/provider.js';
import { hash, KernelError } from '../src/domain/canonical.js';
import { externalQuote, insuranceContext } from './fixtures/insurance.js';

const now = '2026-09-10T10:00:00.000Z';
const scope = {
  workspaceId: insuranceContext.workspaceId,
  tenantId: insuranceContext.tenantId,
  environment: 'sandbox' as const,
  operatingEntityId: insuranceContext.operatingEntityId,
};
const quote = { ...structuredClone(externalQuote), expiresAt: '2026-09-11T12:00:00.000Z' };
const envelope: ProviderEnvelope = {
  schemaVersion: 'provider-envelope-v1',
  providerId: 'test_provider',
  adapterId: 'test_adapter',
  adapterVersion: '1.0.0',
  mappingVersion: '1.0.0',
  eventId: 'event-1',
  idempotencyKey: 'request-1',
  correlationId: '1ce6a19b-02b7-4bda-99df-ad2ab87c1397',
  operation: 'quote',
  selection: {
    quoteReference: quote.sourceQuote.reference,
    quoteVersion: quote.sourceQuote.version,
    quoteHash: hash(quote),
    riskHash: hash({ canonicalRiskVersion: '1.0.0', fullSyntheticRisk: { occupancy: 'office' } }),
  },
  sequence: 1,
  occurredAt: now,
  source: {
    submissionReference: 'submission-1',
    riskReference: 'risk-1',
    payloadHash: '0'.repeat(64),
    evidenceRefs: ['evidence://test/source-1'],
  },
  outcome: { kind: 'quote_ready', currency: 'GBP', quote },
};
const emptyHistory = (): ProviderHistory => ({
  byEvent: null,
  byIdempotency: null,
  latestInStream: null,
});
const digest = (body: Uint8Array) => createHash('sha256').update(body).digest('hex');
const code = (expected: string) => (error: unknown) =>
  error instanceof KernelError && error.code === expected;

/** A test-only wire mapping and verifier. This is not a registered customer/live integration. */
function delivery(value: ProviderEnvelope = structuredClone(envelope)) {
  const wire = structuredClone(value) as Partial<ProviderEnvelope>;
  const { payloadHash: _, ...source } = wire.source!;
  const rawBody = Buffer.from(JSON.stringify({ ...wire, source }));
  const adapter: ProviderAdapter = {
    descriptor: {
      providerId: 'test_provider',
      adapterId: 'test_adapter',
      adapterVersion: '1.0.0',
      mappingVersion: '1.0.0',
      mode: 'synthetic',
      operations: ['quote', 'bind'],
      authenticityMethod: 'synthetic_fixture',
      maxPayloadBytes: 100_000,
      maxEventAgeMs: 60_000,
      maxFutureSkewMs: 1_000,
      ordering: 'strict_sequence',
    },
    verify: () => ({
      status: 'verified',
      method: 'synthetic_fixture',
      principalRef: 'synthetic_fixture',
      evidenceRef: 'evidence://test/verification',
    }),
    normalize: (body) => {
      const mapped = JSON.parse(Buffer.from(body).toString('utf8'));
      mapped.source.payloadHash = digest(body);
      return mapped;
    },
  };
  return {
    scope,
    adapter,
    rawBody,
    expectedSelection: value.selection,
    now,
    history: emptyHistory(),
  };
}

test('normalized quote preserves exact money, selected version, full-risk hash and source provenance', () => {
  const input = delivery();
  const result = acceptProviderDelivery(input);
  assert.equal(result.disposition, 'accepted');
  assert.equal(result.receipt.mode, 'synthetic');
  assert.deepEqual(result.receipt.envelope.selection, envelope.selection);
  assert.notEqual(result.receipt.envelope.selection.riskHash, hash(quote.risk));
  assert.equal(result.receipt.envelope.source.payloadHash, digest(input.rawBody));
  assert.deepEqual(result.receipt.envelope.outcome, envelope.outcome);
  assert.ok(providerReceiptSchema.safeParse(result.receipt).success);
  const { receiptHash, ...content } = result.receipt;
  assert.equal(receiptHash, hash(content));
  assert.equal('bound' in result, false);
});

test('verification occurs before normalization and unavailable/failed/unsupported verification fails closed', () => {
  for (const status of ['failed', 'unavailable', 'unsupported', 'throw', 'missing'] as const) {
    const input = delivery();
    let mapped = false;
    input.adapter.normalize = () => {
      mapped = true;
      throw new Error('must not map unauthenticated payload');
    };
    input.adapter.verify =
      status === 'missing'
        ? undefined
        : () => {
            if (status === 'throw') throw new Error('a private credential must never reach errors');
            return { status };
          };
    assert.throws(
      () => acceptProviderDelivery(input),
      (error) => {
        assert.ok(error instanceof KernelError);
        assert.equal(
          error.code,
          status === 'failed' ? 'PROVIDER_AUTH_FAILED' : 'PROVIDER_AUTH_UNAVAILABLE',
        );
        assert.equal(error.message.includes('private credential'), false);
        return true;
      },
    );
    assert.equal(mapped, false);
  }
});

test('real byte authentication conformance detects tampering and callback mutations cannot alter mapped bytes', () => {
  const input = delivery();
  const key = Buffer.from('synthetic-conformance-key-only');
  const signature = createHmac('sha256', key).update(input.rawBody).digest();
  input.adapter.descriptor.mode = 'live';
  input.adapter.descriptor.authenticityMethod = 'hmac_sha256';
  input.adapter.verify = (body) => {
    const valid = timingSafeEqual(signature, createHmac('sha256', key).update(body).digest());
    body.fill(0);
    return valid
      ? {
          status: 'verified',
          method: 'hmac_sha256',
          principalRef: 'test_key',
          evidenceRef: 'evidence://test/hmac',
        }
      : { status: 'failed' };
  };
  assert.equal(
    acceptProviderDelivery(input).receipt.envelope.source.payloadHash,
    digest(input.rawBody),
  );
  const original = input.rawBody;
  input.rawBody = Buffer.from(original);
  input.rawBody[0] = input.rawBody[0]! ^ 1;
  assert.throws(() => acceptProviderDelivery(input), code('PROVIDER_AUTH_FAILED'));
});

test('external authority claims, unsupported outcomes, malformed money and unregistered adapters are rejected', () => {
  for (const extra of [
    { scope },
    { authentication: { status: 'verified' } },
    { connected: true },
  ]) {
    assert.equal(providerEnvelopeSchema.safeParse({ ...envelope, ...extra }).success, false);
  }
  const mismatch = delivery();
  mismatch.adapter.descriptor.mappingVersion = '2.0.0';
  assert.throws(() => acceptProviderDelivery(mismatch), code('UNSUPPORTED_PROVIDER_CONTRACT'));
  const unsupported = delivery();
  unsupported.adapter.normalize = () => ({
    ...envelope,
    operation: 'payment',
    outcome: { kind: 'payment_verified' },
  });
  assert.throws(() => acceptProviderDelivery(unsupported), code('INVALID_PROVIDER_RESPONSE'));
  assert.equal(
    providerEnvelopeSchema.safeParse({
      ...envelope,
      outcome: { ...envelope.outcome, quote: { ...quote, premiumMinor: 100 } },
    }).success,
    false,
  );
});

test('synthetic evidence cannot enter production or impersonate live authentication', () => {
  const input = delivery();
  assert.throws(
    () => acceptProviderDelivery({ ...input, scope: { ...scope, environment: 'production' } }),
    code('SYNTHETIC_PROVIDER_FORBIDDEN'),
  );
  input.adapter.descriptor.mode = 'live';
  assert.throws(() => acceptProviderDelivery(input), code('INVALID_PROVIDER_CONTEXT'));
  const wrongMethod = delivery();
  wrongMethod.adapter.verify = () => ({
    status: 'verified',
    method: 'oauth_token',
    principalRef: 'fake',
    evidenceRef: 'evidence://test/fake',
  });
  assert.throws(() => acceptProviderDelivery(wrongMethod), code('PROVIDER_AUTH_FAILED'));
});

test('payload provenance, quote content, source identity and server-pinned risk selection must agree', () => {
  const wrongPayload = delivery();
  wrongPayload.adapter.normalize = () => envelope;
  assert.throws(() => acceptProviderDelivery(wrongPayload), code('PROVIDER_PAYLOAD_MISMATCH'));
  for (const change of [
    { quoteHash: 'f'.repeat(64) },
    { quoteReference: 'different-quote' },
    { quoteVersion: 'different-version' },
  ]) {
    const value = structuredClone(envelope);
    Object.assign(value.selection, change);
    assert.throws(() => acceptProviderDelivery(delivery(value)), code('PROVIDER_QUOTE_MISMATCH'));
  }
  const wrongSelection = delivery();
  wrongSelection.expectedSelection = { ...envelope.selection, riskHash: 'f'.repeat(64) };
  assert.throws(() => acceptProviderDelivery(wrongSelection), code('PROVIDER_SELECTION_MISMATCH'));
});

test('authentic duplicate returns the exact original receipt even after selection advances and event ages', () => {
  const input = delivery();
  const receipt = acceptProviderDelivery(input).receipt;
  input.history = { byEvent: receipt, byIdempotency: receipt, latestInStream: receipt };
  input.now = '2026-09-12T10:00:00.000Z';
  input.expectedSelection = { ...envelope.selection, quoteVersion: '2' };
  assert.deepEqual(acceptProviderDelivery(input), { disposition: 'duplicate', receipt });
  input.adapter.verify = () => ({ status: 'failed' });
  assert.throws(() => acceptProviderDelivery(input), code('PROVIDER_AUTH_FAILED'));
});

test('event and idempotency collisions reject changed content across actors and source versions', () => {
  const receipt = acceptProviderDelivery(delivery()).receipt;
  for (const key of ['byEvent', 'byIdempotency'] as const) {
    const changed = structuredClone(envelope);
    changed.outcome = { kind: 'referred', reasonCodes: ['needs_review'] };
    changed.selection.quoteVersion = '2';
    const input = delivery(changed);
    input.history[key] = receipt;
    assert.throws(() => acceptProviderDelivery(input), code('PROVIDER_REPLAY_CONFLICT'));
  }
});

test('scope keys isolate all four dimensions; wrong or tampered stored receipts fail integrity checks', () => {
  const receipt = acceptProviderDelivery(delivery()).receipt;
  for (const different of [
    { workspaceId: 'other_workspace' },
    { tenantId: 'other_tenant' },
    { environment: 'uat' as const },
    { operatingEntityId: 'other_entity' },
  ]) {
    const otherScope = { ...scope, ...different };
    const keys = providerReceiptKeys(otherScope, envelope);
    for (const key of ['eventKey', 'idempotencyKey', 'streamKey'] as const)
      assert.notEqual(keys[key], receipt[key]);
    assert.throws(
      () =>
        acceptProviderDelivery({
          ...delivery(),
          scope: otherScope,
          history: { byEvent: receipt, byIdempotency: null, latestInStream: null },
        }),
      code('INTEGRITY_ERROR'),
    );
  }
  const input = delivery();
  input.history.byEvent = { ...receipt, envelopeHash: 'f'.repeat(64) };
  assert.throws(() => acceptProviderDelivery(input), code('INTEGRITY_ERROR'));
  input.history.byEvent = { ...receipt, envelope: { ...receipt.envelope, sequence: 2 } };
  assert.throws(() => acceptProviderDelivery(input), code('INTEGRITY_ERROR'));
  assert.throws(
    () => acceptProviderDelivery({ ...delivery(), history: {} as ProviderHistory }),
    code('INTEGRITY_ERROR'),
  );
  assert.equal(providerReceiptSchema.safeParse({ ...receipt, mode: 'live' }).success, false);
});

test('strict ordering spans quote versions and rejects sequence gaps, older events and unknown replays', () => {
  const prior = acceptProviderDelivery(delivery()).receipt;
  const next = structuredClone(envelope);
  next.eventId = 'event-2';
  next.idempotencyKey = 'request-2';
  next.sequence = 2;
  next.selection.quoteVersion = '2';
  next.outcome = { kind: 'referred', reasonCodes: ['needs_review'] };
  const input = delivery(next);
  input.history.latestInStream = prior;
  const result = acceptProviderDelivery(input);
  assert.equal(result.receipt.streamKey, prior.streamKey);
  for (const sequence of [1, 3]) {
    const bad = delivery({ ...next, sequence });
    bad.history.latestInStream = prior;
    assert.throws(() => acceptProviderDelivery(bad), code('PROVIDER_SEQUENCE_CONFLICT'));
  }
  assert.throws(() => acceptProviderDelivery(delivery(next)), code('PROVIDER_SEQUENCE_CONFLICT'));
  const older = delivery({ ...next, occurredAt: '2026-09-10T09:59:59.000Z' });
  older.history.latestInStream = prior;
  assert.throws(() => acceptProviderDelivery(older), code('PROVIDER_SEQUENCE_CONFLICT'));
});

test('freshness, expiration, malformed payload and mapping failures cannot create apparently valid quotes', () => {
  for (const occurredAt of ['2026-09-10T09:58:00.000Z', '2026-09-10T10:00:02.000Z'])
    assert.throws(
      () => acceptProviderDelivery(delivery({ ...envelope, occurredAt })),
      code('PROVIDER_EVENT_EXPIRED'),
    );
  const expired = structuredClone(envelope);
  if (expired.outcome.kind !== 'quote_ready') throw new Error('fixture');
  expired.outcome.quote.expiresAt = now;
  expired.selection.quoteHash = hash(expired.outcome.quote);
  assert.throws(() => acceptProviderDelivery(delivery(expired)), code('PROVIDER_QUOTE_EXPIRED'));
  const input = delivery();
  input.rawBody = Buffer.from('');
  assert.throws(() => acceptProviderDelivery(input), code('INVALID_PROVIDER_PAYLOAD'));
  input.rawBody = Buffer.from('not json');
  assert.throws(() => acceptProviderDelivery(input), code('INVALID_PROVIDER_RESPONSE'));
});

test('referral, decline, bind confirmation and failure remain distinct provider declarations', () => {
  const outcomes: ProviderEnvelope['outcome'][] = [
    { kind: 'referred', reasonCodes: ['authority_review'] },
    { kind: 'declined', reasonCodes: ['outside_appetite'] },
    { kind: 'bind_confirmed', externalBindingReference: 'external-binding-1' },
    { kind: 'failure', code: 'timeout' },
  ];
  for (const outcome of outcomes) {
    const value = {
      ...envelope,
      outcome,
      operation: outcome.kind === 'bind_confirmed' ? ('bind' as const) : ('quote' as const),
    };
    assert.deepEqual(acceptProviderDelivery(delivery(value)).receipt.envelope.outcome, outcome);
  }
  assert.throws(
    () => acceptProviderDelivery(delivery({ ...envelope, operation: 'bind' })),
    code('INVALID_PROVIDER_OUTCOME'),
  );
});

const retry: ProviderRetryInput = {
  operation: 'quote',
  failureCode: 'timeout',
  deliveryState: 'sent_unknown',
  idempotency: 'guaranteed',
  idempotencyKey: 'stable-request-1',
  attempt: 1,
  maxAttempts: 4,
  now,
  deadlineAt: '2026-09-10T10:02:00.000Z',
  timeoutMs: 10_000,
  baseDelayMs: 1_000,
  maxDelayMs: 5_000,
};
test('retry decisions retain the key, honor capped backoff/Retry-After and fit the whole next attempt into deadline', () => {
  const result = planProviderRetry(retry);
  assert.deepEqual(result, {
    action: 'retry',
    nextAttempt: 2,
    idempotencyKey: retry.idempotencyKey,
    notBefore: '2026-09-10T10:00:01.000Z',
    timeoutMs: 10_000,
  });
  assert.ok(providerRetryDecisionSchema.safeParse(result).success);
  assert.deepEqual(planProviderRetry({ ...retry, attempt: 5, maxAttempts: 6 }), {
    action: 'retry',
    nextAttempt: 6,
    idempotencyKey: retry.idempotencyKey,
    notBefore: '2026-09-10T10:00:05.000Z',
    timeoutMs: 10_000,
  });
  assert.equal(planProviderRetry({ ...retry, retryAfterMs: 4_000 }).action, 'retry');
  assert.deepEqual(planProviderRetry({ ...retry, retryAfterMs: 6_000 }), {
    action: 'stop',
    reason: 'retry_after_exceeds_policy',
  });
  assert.deepEqual(planProviderRetry({ ...retry, deadlineAt: '2026-09-10T10:00:10.000Z' }), {
    action: 'stop',
    reason: 'deadline_exceeded',
  });
  assert.deepEqual(planProviderRetry({ ...retry, attempt: 4 }), {
    action: 'stop',
    reason: 'attempts_exhausted',
  });
  assert.throws(() => planProviderRetry({ ...retry, attempt: 5 }), code('INVALID_PROVIDER_RETRY'));
  for (const failureCode of [
    'rejected',
    'invalid_response',
    'unauthorized',
    'unsupported',
  ] as const)
    assert.deepEqual(planProviderRetry({ ...retry, failureCode }), {
      action: 'stop',
      reason: 'permanent_failure',
    });
});

test('ambiguous bind and non-idempotent outcomes require reconciliation even after attempts/deadline are exhausted', () => {
  for (const value of [
    { ...retry, operation: 'bind' as const },
    { ...retry, idempotency: 'unsupported' as const },
  ]) {
    assert.deepEqual(planProviderRetry(value), {
      action: 'reconcile',
      reason: 'ambiguous_external_outcome',
    });
    assert.equal(planProviderRetry({ ...value, attempt: 4, deadlineAt: now }).action, 'reconcile');
    assert.equal(planProviderRetry({ ...value, deliveryState: 'not_sent' }).action, 'retry');
  }
});
