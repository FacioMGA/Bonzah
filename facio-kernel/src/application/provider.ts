import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  contextSchema,
  scopeSchema,
  type Context,
  type Scope,
} from '../contracts/configuration.js';
import type { SandboxRelease } from '../contracts/control-plane.js';
import type { InsuranceRecord } from '../contracts/insurance.js';
import {
  providerExecutionPolicySchema,
  providerOperations,
  providerRequestSchema,
  type ProviderExecutionPolicy,
  type ProviderOperationName,
  type ProviderRequest,
} from '../contracts/provider-execution.js';
import {
  providerAdapterDescriptorSchema,
  providerAuthenticationSchema,
  providerEnvelopeSchema,
  providerFailureCodeSchema,
  type ProviderAdapterDescriptor,
  type ProviderEnvelope,
} from '../contracts/provider.js';
import { acceptProviderDelivery, planProviderRetry } from '../domain/provider.js';
import type {
  ProviderHeaders,
  ProviderVerification,
  ProviderVerifier,
} from '../domain/provider-authentication.js';
import { hash, KernelError } from '../domain/canonical.js';
import { ProviderStorage } from '../storage/provider.js';

export { createHmacSha256Verifier } from '../domain/provider-authentication.js';
export type { ProviderHeaders, ProviderVerifier } from '../domain/provider-authentication.js';

export interface ProviderExecutionHost {
  providers: ProviderStorage;
  transaction<T>(work: () => T): T;
  insuranceRead(scope: Scope, id: string): InsuranceRecord | null;
  control: { release(scope: Scope, id?: string): SandboxRelease | null };
}
export type ProviderTransportResult =
  | { kind: 'delivery'; rawBody: Uint8Array; headers?: ProviderHeaders }
  | { kind: 'pending' }
  | {
      kind: 'failure';
      code: z.infer<typeof providerFailureCodeSchema>;
      deliveryState: 'not_sent' | 'confirmed_failed' | 'sent_unknown';
      retryAfterMs?: number;
    };
/** Only trusted server registration can provide dispatch, credentials, normalization and verification. */
export interface ProviderExecutionAdapter {
  descriptor: ProviderAdapterDescriptor;
  policy: ProviderExecutionPolicy;
  verify?: ProviderVerifier;
  normalize: (body: Uint8Array, request: ProviderRequest) => unknown;
  send: (
    request: ProviderRequest,
    options: { signal: AbortSignal },
  ) => Promise<ProviderTransportResult>;
  reconcile?: (
    request: ProviderRequest,
    options: { signal: AbortSignal },
  ) => Promise<ProviderTransportResult>;
}
const failureSchema = z.strictObject({
  kind: z.literal('failure'),
  code: providerFailureCodeSchema,
  deliveryState: z.enum(['not_sent', 'confirmed_failed', 'sent_unknown']),
  retryAfterMs: z.number().int().min(0).max(3_600_000).optional(),
});
const scopeOf = (context: Scope): Scope =>
  scopeSchema.parse({
    workspaceId: context.workspaceId,
    tenantId: context.tenantId,
    environment: context.environment,
    operatingEntityId: context.operatingEntityId,
  });
function fail(code: string, message: string, status = 422): never {
  throw new KernelError(code, message, status);
}
const byteHash = (body: Uint8Array) => createHash('sha256').update(body).digest('hex');

/** Durable quote evidence only. No method modifies insurance, payment, approval or bind authority. */
export class ProviderApplication {
  private readonly adapters = new Map<string, ProviderExecutionAdapter>();
  constructor(
    private readonly host: ProviderExecutionHost,
    adapters: readonly ProviderExecutionAdapter[] = [],
    private readonly clock: () => Date = () => new Date(),
  ) {
    for (const adapter of adapters) {
      const descriptor = providerAdapterDescriptorSchema.parse(adapter.descriptor);
      const policy = providerExecutionPolicySchema.parse(adapter.policy);
      if (
        !descriptor.operations.includes('quote') ||
        this.adapters.has(descriptor.adapterId) ||
        typeof adapter.send !== 'function' ||
        typeof adapter.normalize !== 'function'
      )
        fail(
          'INVALID_PROVIDER_REGISTRATION',
          'Quote adapters must be uniquely registered server-side',
        );
      if (descriptor.mode === 'live' && descriptor.authenticityMethod !== 'hmac_sha256')
        fail(
          'PROVIDER_AUTH_UNSUPPORTED',
          'Durable live ingress currently requires the registered HMAC protocol',
        );
      this.adapters.set(descriptor.adapterId, { ...adapter, descriptor, policy });
    }
  }
  private adapter(request: ProviderRequest): ProviderExecutionAdapter {
    const adapter = this.adapters.get(request.adapter.adapterId);
    if (
      !adapter ||
      hash(adapter.descriptor) !== hash(request.adapter) ||
      hash(adapter.policy) !== hash(request.policy)
    )
      fail(
        'PROVIDER_ADAPTER_UNAVAILABLE',
        'The exact pinned provider registration is unavailable',
        503,
      );
    return adapter;
  }
  private allowed(adapter: ProviderExecutionAdapter, scope: Scope): boolean {
    return (
      ['development', 'sandbox'].includes(scope.environment) &&
      (adapter.descriptor.mode === 'live' || ['development', 'sandbox'].includes(scope.environment))
    );
  }
  execute(name: ProviderOperationName, raw: unknown, context: Context): unknown {
    contextSchema.parse(context);
    const op = providerOperations[name];
    if (!context.permissions.includes(op.permission))
      fail('FORBIDDEN', 'Provider permission is required', 403);
    const input = op.input.parse(raw);
    const scope = scopeOf(context);
    if (name === 'provider_catalog')
      return {
        adapters: [...this.adapters.values()]
          .filter((a) => this.allowed(a, scope))
          .map((a) => ({
            descriptor: a.descriptor,
            policy: a.policy,
            supportedSourceMode: 'configured_product',
            purpose: 'quote_evidence',
            canReconcile: typeof a.reconcile === 'function',
            connection:
              a.descriptor.mode === 'synthetic' ? 'synthetic_training' : 'registered_live_adapter',
            grantsBindAuthority: false,
          })),
      };
    if (name === 'provider_list')
      return {
        requests: this.host.providers.list(scope, (input as { recordId?: string }).recordId),
        hasMore: this.host.providers.hasMore(scope, (input as { recordId?: string }).recordId),
      };
    if (name === 'provider_get')
      return this.host.providers.view(scope, (input as { requestId: string }).requestId);
    if (!['development', 'sandbox'].includes(scope.environment))
      fail(
        'PROVIDER_ENVIRONMENT_UNSUPPORTED',
        'Provider execution is limited to development and sandbox',
        403,
      );
    const mutation = input as { idempotencyKey: string };
    const fingerprint = hash(input);
    const cached = this.host.providers.command(scope, name, mutation.idempotencyKey, fingerprint);
    if (cached) return cached;
    const result =
      name === 'provider_request'
        ? this.request(providerOperations.provider_request.input.parse(input), context)
        : this.retry(providerOperations.provider_retry.input.parse(input), context);
    this.host.providers.remember(scope, name, mutation.idempotencyKey, fingerprint, result);
    return result;
  }
  private request(
    input: z.infer<typeof providerOperations.provider_request.input>,
    context: Context,
  ) {
    const scope = scopeOf(context);
    const adapter = this.adapters.get(input.adapterId);
    if (!adapter || !this.allowed(adapter, scope))
      fail(
        'PROVIDER_ADAPTER_UNAVAILABLE',
        'Provider adapter is not registered in this environment',
        422,
      );
    const record = this.host.insuranceRead(scope, input.recordId);
    if (!record) fail('RECORD_NOT_FOUND', 'Insurance record is unavailable in this scope', 404);
    if (record.version !== input.expectedVersion || record.recordHash !== input.expectedRecordHash)
      fail('RECORD_VERSION_CONFLICT', 'Select the current insurance record version', 409);
    if (record.sourceMode !== 'configured_product' || !record.decision || !record.runtimeReleaseId)
      fail(
        'PROVIDER_SOURCE_UNSUPPORTED',
        'Provider execution requires a configured record with complete pinned risk and sandbox release',
      );
    const release = this.host.control.release(scope, record.runtimeReleaseId);
    if (
      !release ||
      release.hash !== record.decision.evaluation.releaseHash ||
      hash(record.decision.submission) !== record.decision.evaluation.inputHash
    )
      fail(
        'INTEGRITY_ERROR',
        'The configured record does not match its immutable release or submitted risk',
        500,
      );
    const now = this.clock().toISOString();
    if (record.status === 'cancelled' || Date.parse(record.quote.expiresAt) <= Date.parse(now))
      fail(
        'PROVIDER_RECORD_UNAVAILABLE',
        'Cancelled records and expired quotes cannot start provider execution',
        409,
      );
    const existing = this.host.providers.existing(
      scope,
      input.adapterId,
      record.id,
      record.version,
    );
    if (existing)
      fail(
        'PROVIDER_REQUEST_EXISTS',
        'This adapter already has a request for the selected record version',
        409,
      );
    const activeRequests = this.host.providers.activeStreamRequests(
      scope,
      adapter.descriptor.providerId,
      record.quote.sourceQuote.reference,
    );
    for (const id of activeRequests) {
      const old = this.host.providers.snapshot(id)!;
      if (!this.current(old.request))
        this.host.providers.transition(
          id,
          { status: 'superseded', claim: null },
          'superseded',
          now,
          {
            code:
              old.state.attempts > 0 && !old.state.receiptHash
                ? 'STALE_RECORD_EXTERNAL_OUTCOME_UNKNOWN'
                : 'STALE_RECORD_EVIDENCE',
          },
        );
      else
        fail(
          'PROVIDER_STREAM_BUSY',
          'Resolve the existing provider request for this quote stream first',
          409,
        );
    }
    const content = {
      id: randomUUID(),
      scope,
      operation: 'quote' as const,
      purpose: 'quote_evidence' as const,
      adapter: adapter.descriptor,
      policy: adapter.policy,
      recordId: record.id,
      recordVersion: record.version,
      recordHash: record.recordHash,
      releaseId: release.id,
      releaseHash: release.hash,
      selection: {
        quoteReference: record.quote.sourceQuote.reference,
        quoteVersion: record.quote.sourceQuote.version,
        quoteHash: record.quoteHash,
        riskHash: record.decision.evaluation.inputHash,
      },
      riskIdentity: 'configured_submission_v1' as const,
      submission: record.decision.submission,
      currency: record.currency,
      quote: record.quote,
      correlationId: context.correlationId,
      actorId: context.actorId,
      outboundIdempotencyKey: randomUUID(),
      sequence: this.host.providers.nextSequence(
        scope,
        adapter.descriptor.providerId,
        record.quote.sourceQuote.reference,
      ),
      streamPosition:
        (this.host.providers.latestStreamRequest(
          scope,
          adapter.descriptor.providerId,
          record.quote.sourceQuote.reference,
        )?.streamPosition ?? 0) + 1,
      createdAt: now,
      deadlineAt: new Date(
        Math.min(Date.parse(now) + adapter.policy.deadlineMs, Date.parse(record.quote.expiresAt)),
      ).toISOString(),
    };
    const request = providerRequestSchema.parse({ ...content, requestHash: hash(content) });
    if (Date.parse(request.deadlineAt) - Date.parse(now) < request.policy.timeoutMs)
      fail(
        'PROVIDER_DEADLINE_EXCEEDED',
        'The remaining quote lifetime cannot fit the registered request timeout',
        409,
      );
    this.host.providers.create(request);
    return this.host.providers.view(scope, request.id);
  }
  private current(request: ProviderRequest): boolean {
    const record = this.host.insuranceRead(request.scope, request.recordId);
    if (!record) return false;
    return (
      record.version === request.recordVersion &&
      record.recordHash === request.recordHash &&
      record.quoteHash === request.selection.quoteHash &&
      record.runtimeReleaseId === request.releaseId &&
      record.decision?.evaluation.inputHash === request.selection.riskHash &&
      this.host.control.release(request.scope, request.releaseId)?.hash === request.releaseHash &&
      record.status !== 'cancelled'
    );
  }
  private retry(input: z.infer<typeof providerOperations.provider_retry.input>, context: Context) {
    const scope = scopeOf(context);
    this.host.providers.view(scope, input.requestId);
    const { request, state } = this.host.providers.snapshot(input.requestId)!;
    if (state.version !== input.expectedVersion)
      fail('PROVIDER_VERSION_CONFLICT', 'Provider state changed; refresh before retrying', 409);
    const adapter = this.adapter(request);
    const now = this.clock().toISOString();
    if (!this.current(request))
      fail(
        'PROVIDER_SELECTION_CONFLICT',
        'The insurance record changed after this request was pinned',
        409,
      );
    if (
      state.attempts >= request.policy.maxAttempts ||
      Date.parse(now) + request.policy.timeoutMs > Date.parse(request.deadlineAt)
    )
      fail(
        'PROVIDER_RETRY_EXHAUSTED',
        'The original attempt or deadline budget is exhausted; evidence remains available for reconciliation',
        409,
      );
    if (state.status === 'reconciliation_required') {
      if (!adapter.reconcile)
        fail(
          'PROVIDER_RECONCILIATION_UNSUPPORTED',
          'No registered reconciliation operation exists; an authenticated callback is required',
          409,
        );
    } else if (state.status !== 'retry_wait' || state.nextAttemptAt > now)
      fail(
        'PROVIDER_RETRY_UNAVAILABLE',
        'Only a due retry or supported reconciliation can be queued',
        409,
      );
    this.host.providers.transition(
      request.id,
      {
        status: 'queued',
        task: state.status === 'reconciliation_required' ? 'reconcile' : 'send',
        nextAttemptAt: now,
      },
      'retry_requested',
      now,
      { actorId: context.actorId, correlationId: context.correlationId },
    );
    return this.host.providers.view(scope, request.id);
  }
  private verify(
    adapter: ProviderExecutionAdapter,
    request: ProviderRequest,
    rawBody: Uint8Array,
    headers: ProviderHeaders,
    now: string,
  ): { envelope: ProviderEnvelope; verification: ProviderVerification; body: Uint8Array } {
    if (
      !(rawBody instanceof Uint8Array) ||
      !rawBody.byteLength ||
      rawBody.byteLength > adapter.descriptor.maxPayloadBytes
    )
      fail('INVALID_PROVIDER_PAYLOAD', 'Provider payload is empty or exceeds the registered limit');
    if (!adapter.verify)
      fail('PROVIDER_AUTH_UNAVAILABLE', 'No registered provider verifier is available', 503);
    const body = Uint8Array.from(rawBody);
    let verification: ProviderVerification;
    try {
      verification = adapter.verify(Uint8Array.from(body), headers, now);
    } catch {
      fail('PROVIDER_AUTH_UNAVAILABLE', 'Registered provider verification could not complete', 503);
    }
    if (!verification || verification.authentication?.status !== 'verified')
      fail(
        verification?.authentication?.status === 'failed'
          ? 'PROVIDER_AUTH_FAILED'
          : 'PROVIDER_AUTH_UNAVAILABLE',
        'Provider authenticity has not been established',
        verification?.authentication?.status === 'failed' ? 401 : 503,
      );
    const authentication = providerAuthenticationSchema.safeParse(verification.authentication);
    if (
      !authentication.success ||
      authentication.data.status !== 'verified' ||
      authentication.data.method !== adapter.descriptor.authenticityMethod ||
      (adapter.descriptor.mode === 'live' && !/^[a-f0-9]{64}$/.test(verification.nonceKey ?? ''))
    )
      fail(
        'PROVIDER_AUTH_FAILED',
        'Registered authentication and replay identity do not match the adapter',
        401,
      );
    let normalized: unknown;
    try {
      normalized = adapter.normalize(Uint8Array.from(body), structuredClone(request));
    } catch {
      fail(
        'INVALID_PROVIDER_RESPONSE',
        'Registered provider mapping could not normalize the payload',
      );
    }
    const parsed = providerEnvelopeSchema.safeParse(normalized);
    if (!parsed.success)
      fail(
        'INVALID_PROVIDER_RESPONSE',
        'Provider payload does not conform to the registered envelope',
      );
    return { envelope: parsed.data, verification, body };
  }
  /** Public ingress: request identity resolves scope. Synthetic fixture authentication is never accepted here. */
  acceptCallback(
    adapterId: string,
    requestId: string,
    rawBody: Uint8Array,
    headers: ProviderHeaders,
  ) {
    const request = this.host.providers.request(requestId);
    if (!request || request.adapter.adapterId !== adapterId)
      fail('PROVIDER_REQUEST_NOT_FOUND', 'Provider callback target is unavailable', 404);
    const adapter = this.adapter(request);
    if (adapter.descriptor.mode !== 'live')
      fail(
        'SYNTHETIC_CALLBACK_FORBIDDEN',
        'Synthetic training evidence is produced only by the internal registered worker',
        403,
      );
    const now = this.clock().toISOString();
    const verified = this.verify(adapter, request, rawBody, headers, now);
    return this.host.transaction(() => this.accept(request, adapter, verified, now));
  }
  private accept(
    request: ProviderRequest,
    adapter: ProviderExecutionAdapter,
    verified: { envelope: ProviderEnvelope; verification: ProviderVerification; body: Uint8Array },
    now: string,
  ) {
    const { envelope, verification, body } = verified;
    if (
      envelope.correlationId !== request.correlationId ||
      envelope.idempotencyKey !== request.outboundIdempotencyKey ||
      envelope.sequence !== request.sequence ||
      envelope.operation !== 'quote' ||
      (envelope.outcome.kind === 'quote_ready' && envelope.outcome.currency !== request.currency)
    )
      fail(
        'PROVIDER_REQUEST_CONFLICT',
        'Provider outcome does not match the exact durable request',
        409,
      );
    const isCurrent =
      this.current(request) &&
      this.host.providers.latestStreamRequest(
        request.scope,
        request.adapter.providerId,
        request.selection.quoteReference,
      )?.id === request.id;
    const result = acceptProviderDelivery({
      scope: request.scope,
      adapter: {
        descriptor: adapter.descriptor,
        verify: () => verification.authentication,
        normalize: () => envelope,
      },
      rawBody: body,
      expectedSelection: request.selection,
      now,
      history: this.host.providers.history(request.scope, envelope, !isCurrent),
    });
    if (result.disposition === 'duplicate')
      return {
        disposition: 'duplicate' as const,
        requestId: request.id,
        receiptHash: result.receipt.receiptHash,
      };
    const replayKey = verification.nonceKey
      ? hash({
          scope: request.scope,
          providerId: request.adapter.providerId,
          nonceKey: verification.nonceKey,
        })
      : undefined;
    this.host.providers.saveReceipt(
      request.id,
      result.receipt,
      isCurrent ? 'active' : 'historical',
      replayKey,
    );
    this.host.providers.transition(
      request.id,
      {
        status: isCurrent ? 'completed' : 'superseded',
        claim: null,
        receiptHash: result.receipt.receiptHash,
        lastFailure: null,
      },
      'receipt_accepted',
      now,
      {
        code: !isCurrent
          ? 'STALE_RECORD_EVIDENCE'
          : now > request.deadlineAt
            ? 'LATE_AFTER_DEADLINE'
            : undefined,
      },
    );
    return {
      disposition: 'accepted' as const,
      requestId: request.id,
      receiptHash: result.receipt.receiptHash,
    };
  }
  /** Claims and persistence are synchronous transactions; adapter I/O is awaited strictly between them. */
  async workOnce(): Promise<{ claimed: boolean; requestId?: string }> {
    const work = this.host.transaction(() => {
      const now = this.clock().toISOString();
      for (const id of this.host.providers.expiredClaims(now))
        this.host.providers.transition(
          id,
          { status: 'reconciliation_required', claim: null, lastFailure: 'timeout' },
          'claim_expired',
          now,
          { code: 'AMBIGUOUS_EXTERNAL_OUTCOME' },
        );
      const id = this.host.providers.due(now);
      if (!id) return null;
      const { request, state } = this.host.providers.snapshot(id)!;
      if (!this.current(request)) {
        this.host.providers.transition(
          id,
          { status: 'superseded', claim: null },
          'superseded',
          now,
          { code: 'STALE_RECORD_EVIDENCE' },
        );
        return null;
      }
      if (
        state.attempts >= request.policy.maxAttempts ||
        Date.parse(now) + request.policy.timeoutMs > Date.parse(request.deadlineAt)
      ) {
        this.host.providers.transition(
          id,
          {
            status: state.task === 'reconcile' ? 'reconciliation_required' : 'failed',
            claim: null,
            lastFailure: 'timeout',
          },
          'failed',
          now,
          { code: 'DEADLINE_OR_ATTEMPTS_EXHAUSTED' },
        );
        return null;
      }
      let adapter: ProviderExecutionAdapter;
      try {
        adapter = this.adapter(request);
      } catch {
        this.host.providers.transition(
          id,
          { status: 'failed', claim: null, lastFailure: 'unsupported' },
          'failed',
          now,
          { code: 'PROVIDER_ADAPTER_UNAVAILABLE' },
        );
        return null;
      }
      if (state.task === 'reconcile' && !adapter.reconcile) {
        this.host.providers.transition(
          id,
          { status: 'reconciliation_required', claim: null, lastFailure: 'unsupported' },
          'reconciliation_required',
          now,
          { code: 'PROVIDER_RECONCILIATION_UNSUPPORTED' },
        );
        return null;
      }
      const token = randomUUID();
      this.host.providers.transition(
        id,
        {
          status: 'in_flight',
          attempts: state.attempts + 1,
          claim: {
            token,
            expiresAt: new Date(Date.parse(now) + request.policy.timeoutMs + 5_000).toISOString(),
          },
        },
        'claimed',
        now,
      );
      return { request, adapter, token, task: state.task };
    });
    if (!work) return { claimed: false };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: ProviderTransportResult;
    try {
      const dispatch = work.task === 'reconcile' ? work.adapter.reconcile! : work.adapter.send;
      result = await Promise.race([
        Promise.resolve().then(() =>
          dispatch(structuredClone(work.request), { signal: controller.signal }),
        ),
        new Promise<ProviderTransportResult>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve({ kind: 'failure', code: 'timeout', deliveryState: 'sent_unknown' });
          }, work.request.policy.timeoutMs);
        }),
      ]);
    } catch {
      result = { kind: 'failure', code: 'unavailable', deliveryState: 'sent_unknown' };
    } finally {
      if (timer) clearTimeout(timer);
    }
    try {
      this.host.transaction(() => {
        const now = this.clock().toISOString();
        const snapshot = this.host.providers.snapshot(work.request.id)!;
        if (snapshot.state.claim?.token !== work.token || snapshot.state.status !== 'in_flight') {
          this.host.providers.transition(work.request.id, {}, 'late_attempt_ignored', now, {
            code: 'CLAIM_NO_LONGER_CURRENT',
          });
          return;
        }
        if (snapshot.state.claim.expiresAt <= now) {
          this.host.providers.transition(
            work.request.id,
            { status: 'reconciliation_required', claim: null, lastFailure: 'timeout' },
            'claim_expired',
            now,
            { code: 'AMBIGUOUS_EXTERNAL_OUTCOME' },
          );
          return;
        }
        if (result?.kind === 'delivery') {
          const verified = this.verify(
            work.adapter,
            work.request,
            result.rawBody,
            result.headers ?? {},
            now,
          );
          this.accept(work.request, work.adapter, verified, now);
          return;
        }
        const parsed = failureSchema.safeParse(result);
        const failure = parsed.success
          ? parsed.data
          : {
              kind: 'failure' as const,
              code: 'invalid_response' as const,
              deliveryState: 'sent_unknown' as const,
            };
        if (
          result?.kind === 'pending' ||
          failure.deliveryState === 'sent_unknown' ||
          work.task === 'reconcile'
        ) {
          this.host.providers.transition(
            work.request.id,
            {
              status: 'reconciliation_required',
              claim: null,
              lastFailure: result?.kind === 'pending' ? null : failure.code,
            },
            'reconciliation_required',
            now,
            { code: 'AMBIGUOUS_EXTERNAL_OUTCOME' },
          );
          return;
        }
        const decision = planProviderRetry({
          operation: 'quote',
          failureCode: failure.code,
          deliveryState: failure.deliveryState,
          idempotency: work.request.policy.idempotency,
          idempotencyKey: work.request.outboundIdempotencyKey,
          attempt: snapshot.state.attempts,
          maxAttempts: work.request.policy.maxAttempts,
          now,
          deadlineAt: work.request.deadlineAt,
          timeoutMs: work.request.policy.timeoutMs,
          baseDelayMs: work.request.policy.baseDelayMs,
          maxDelayMs: work.request.policy.maxDelayMs,
          ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
        });
        this.host.providers.transition(
          work.request.id,
          {
            status: decision.action === 'retry' ? 'retry_wait' : 'failed',
            claim: null,
            lastFailure: failure.code,
            ...(decision.action === 'retry' ? { nextAttemptAt: decision.notBefore } : {}),
          },
          decision.action === 'retry' ? 'retry_scheduled' : 'failed',
          now,
          { code: decision.action === 'stop' ? decision.reason : 'RETRYABLE_PROVIDER_FAILURE' },
        );
      });
    } catch (error) {
      // Receipt, nonce, state and audit either all commit or all roll back. A malformed or
      // unauthenticated response never justifies resending an operation that may have arrived.
      if (error instanceof KernelError && error.code === 'INTEGRITY_ERROR') throw error;
      const code =
        error instanceof KernelError && /^[A-Z_a-z0-9]{1,80}$/.test(error.code)
          ? error.code
          : 'PROVIDER_PERSISTENCE_OR_RESPONSE_FAILED';
      this.host.transaction(() => {
        const snapshot = this.host.providers.snapshot(work.request.id)!;
        if (snapshot.state.claim?.token === work.token)
          this.host.providers.transition(
            work.request.id,
            { status: 'reconciliation_required', claim: null, lastFailure: 'invalid_response' },
            'reconciliation_required',
            this.clock().toISOString(),
            { code },
          );
      });
    }
    return { claimed: true, requestId: work.request.id };
  }
}

/** Explicit generic training adapter. No customer endpoint, credential, carrier or payment is simulated as live. */
export function createSyntheticProviderAdapter(): ProviderExecutionAdapter {
  const descriptor: ProviderAdapterDescriptor = {
    providerId: 'synthetic_training',
    adapterId: 'synthetic_quote_evidence',
    adapterVersion: '1.0.0',
    mappingVersion: '1.0.0',
    mode: 'synthetic',
    operations: ['quote'],
    authenticityMethod: 'synthetic_fixture',
    maxPayloadBytes: 1_048_576,
    maxEventAgeMs: 86_400_000,
    maxFutureSkewMs: 30_000,
    ordering: 'strict_sequence',
  };
  return {
    descriptor,
    policy: {
      maxAttempts: 3,
      timeoutMs: 5_000,
      deadlineMs: 900_000,
      baseDelayMs: 1_000,
      maxDelayMs: 30_000,
      idempotency: 'guaranteed',
    },
    verify: (body) => ({
      authentication: {
        status: 'verified',
        method: 'synthetic_fixture',
        principalRef: 'synthetic_training',
        evidenceRef: `evidence://synthetic-training/${byteHash(body)}`,
      },
    }),
    normalize: (body) => {
      const parsed = JSON.parse(Buffer.from(body).toString('utf8')) as ProviderEnvelope;
      return { ...parsed, source: { ...parsed.source, payloadHash: byteHash(body) } };
    },
    send: async (request) => {
      const envelope = {
        schemaVersion: 'provider-envelope-v1',
        providerId: descriptor.providerId,
        adapterId: descriptor.adapterId,
        adapterVersion: descriptor.adapterVersion,
        mappingVersion: descriptor.mappingVersion,
        eventId: `synthetic-${request.id}`,
        idempotencyKey: request.outboundIdempotencyKey,
        correlationId: request.correlationId,
        operation: 'quote',
        selection: request.selection,
        sequence: request.sequence,
        occurredAt: request.createdAt,
        source: {
          submissionReference: request.id,
          riskReference: request.selection.riskHash,
          evidenceRefs: [`evidence://synthetic-training/${request.id}`],
        },
        outcome:
          request.quote.eligibility === 'quote_ready'
            ? { kind: 'quote_ready', currency: request.currency, quote: request.quote }
            : {
                kind: request.quote.eligibility,
                reasonCodes: ['synthetic_retained_quote_decision'],
              },
      };
      return { kind: 'delivery', rawBody: Buffer.from(JSON.stringify(envelope)) };
    },
  };
}
