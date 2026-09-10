import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Kernel } from '../src/application/kernel.js';
import { Store } from '../src/storage/store.js';
import { buildApp } from '../src/server/app.js';
import {
  ProviderApplication,
  createHmacSha256Verifier,
  createSyntheticProviderAdapter,
  type ProviderExecutionAdapter,
  type ProviderTransportResult,
} from '../src/application/provider.js';
import {
  providerExecutionViewSchema,
  providerOperations,
  type ProviderRequest,
} from '../src/contracts/provider-execution.js';
import {
  tenantRecordSchema,
  tenantSetupSchema,
  type Principal,
} from '../src/contracts/control-plane.js';
import { snapshotSchema, type Context } from '../src/contracts/configuration.js';
import {
  insuranceMutationResultSchema,
  type InsuranceRecord,
  type RuntimePolicy,
} from '../src/contracts/insurance.js';
import { insuranceEvaluationSchema } from '../src/contracts/insurance-definition.js';
import { hash, KernelError } from '../src/domain/canonical.js';
import {
  configuredProductConfiguration,
  configuredRuntimePolicy,
  syntheticConfiguredSubmission,
} from './fixtures/insurance-definition.js';
import { syntheticRequirementsProfile } from './fixtures/requirements.js';
import { externalQuote, testNow } from './fixtures/insurance.js';

const fails = (code: string) => (error: unknown) =>
  error instanceof KernelError && error.code === code;
function setup(
  adapters: ProviderExecutionAdapter[] = [createSyntheticProviderAdapter()],
  path = ':memory:',
  policy: RuntimePolicy = configuredRuntimePolicy,
) {
  let now = testNow().getTime();
  const clock = () => new Date(now);
  let store = new Store(path);
  let kernel = new Kernel(
    store,
    [],
    [],
    clock,
    { region: 'test', buildSha: 'a'.repeat(40) },
    adapters,
  );
  const principal: Principal = {
    actorId: 'provider-builder',
    issuer: 'https://identity.test',
    subject: 'provider-builder-subject',
    correlationId: randomUUID(),
  };
  kernel.control.bootstrapAccount({
    accountId: 'provider-account',
    workspaceId: 'provider-workspace',
    displayName: 'Synthetic provider tests',
    members: [{ ...principal, role: 'owner' }],
  });
  const tenant = tenantRecordSchema.parse(
    (
      kernel.control.execute(
        'control_create_tenant',
        {
          accountId: 'provider-account',
          displayName: 'Synthetic provider conformance',
          environment: 'sandbox',
          region: 'test',
          idempotencyKey: randomUUID(),
        },
        principal,
      ) as { tenant: unknown }
    ).tenant,
  );
  const context = kernel.control.resolveContext(principal, tenant.id);
  const execute = (name: Parameters<Kernel['execute']>[0], input: unknown) =>
    kernel.executeForPrincipal(name, input, principal, tenant.id);
  const draft = snapshotSchema.parse(execute('configuration_inspect', { view: 'draft' }));
  execute('configuration_update_draft', {
    expectedVersion: draft.version,
    configuration: configuredProductConfiguration(context),
    idempotencyKey: randomUUID(),
  });
  kernel.control.execute(
    'control_attach_requirements',
    { expectedVersion: 0, profile: syntheticRequirementsProfile, idempotencyKey: randomUUID() },
    principal,
    tenant.id,
  );
  kernel.control.execute(
    'control_update_runtime_draft',
    { expectedVersion: 1, policies: [policy], idempotencyKey: randomUUID() },
    principal,
    tenant.id,
  );
  const { canActivate, blockers, ...candidate } = tenantSetupSchema.parse(
    kernel.control.execute('control_setup', {}, principal, tenant.id),
  ).candidate;
  assert.equal(canActivate, true, blockers.join('\n'));
  const release = tenantSetupSchema.parse(
    kernel.control.execute(
      'control_activate',
      { ...candidate, idempotencyKey: randomUUID() },
      principal,
      tenant.id,
    ),
  ).activeRelease!;
  const create = (supplied = syntheticConfiguredSubmission) => {
    const submission = structuredClone(supplied);
    submission.reference = randomUUID();
    const evaluation = insuranceEvaluationSchema.parse(
      execute('insurance_evaluate_product', {
        productId: configuredRuntimePolicy.id,
        productVersion: configuredRuntimePolicy.version,
        submission,
      }),
    );
    return insuranceMutationResultSchema.parse(
      execute('insurance_create_configured_quote', {
        productId: configuredRuntimePolicy.id,
        productVersion: configuredRuntimePolicy.version,
        submission,
        participants: externalQuote.participants,
        expectedEvaluationHash: evaluation.evaluationHash,
        idempotencyKey: randomUUID(),
      }),
    ).record;
  };
  const record = create();
  const revise = (record: InsuranceRecord) => {
    const submission = structuredClone(record.decision!.submission);
    submission.version = String(Number(submission.version) + 1);
    submission.summary += ' revised';
    const evaluation = insuranceEvaluationSchema.parse(
      execute('insurance_evaluate_product', {
        productId: record.productId,
        productVersion: record.productVersion,
        recordId: record.id,
        submission,
      }),
    );
    return insuranceMutationResultSchema.parse(
      execute('insurance_revise_configured_quote', {
        recordId: record.id,
        expectedVersion: record.version,
        recordHash: record.recordHash,
        submission,
        participants: record.quote.participants,
        expectedEvaluationHash: evaluation.evaluationHash,
        idempotencyKey: randomUUID(),
      }),
    ).record;
  };
  const requestInput = (r = record) => ({
    recordId: r.id,
    expectedVersion: r.version,
    expectedRecordHash: r.recordHash,
    adapterId: adapters[0]!.descriptor.adapterId,
    idempotencyKey: randomUUID(),
  });
  const request = (r = record) =>
    providerExecutionViewSchema.parse(execute('provider_request', requestInput(r)));
  const get = (id: string) =>
    providerExecutionViewSchema.parse(execute('provider_get', { requestId: id }));
  return {
    get store() {
      return store;
    },
    get kernel() {
      return kernel;
    },
    principal,
    context,
    tenant,
    release,
    record,
    clock,
    execute,
    create,
    revise,
    requestInput,
    request,
    get,
    advance: (ms: number) => {
      now += ms;
    },
    reopen: () => {
      store.close();
      store = new Store(path);
      kernel = new Kernel(
        store,
        [],
        [],
        clock,
        { region: 'test', buildSha: 'b'.repeat(40) },
        adapters,
      );
    },
    close: () => store.close(),
  };
}
function temporary() {
  const dir = mkdtempSync(join(tmpdir(), 'kernel-provider-'));
  return {
    path: join(dir, 'kernel.sqlite'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
function liveAdapter() {
  const secret = randomBytes(32);
  const base = createSyntheticProviderAdapter();
  const adapter: ProviderExecutionAdapter = {
    ...base,
    descriptor: {
      ...base.descriptor,
      providerId: 'signed_conformance',
      adapterId: 'hmac_conformance',
      mode: 'live',
      authenticityMethod: 'hmac_sha256',
    },
    verify: createHmacSha256Verifier({ secret, principalRef: 'conformance_provider' }),
    send: async () => ({ kind: 'pending' }),
  };
  const payload = (request: ProviderRequest, now: string, change: Record<string, unknown> = {}) =>
    Buffer.from(
      JSON.stringify({
        schemaVersion: 'provider-envelope-v1',
        providerId: adapter.descriptor.providerId,
        adapterId: adapter.descriptor.adapterId,
        adapterVersion: '1.0.0',
        mappingVersion: '1.0.0',
        eventId: `event-${request.id}`,
        idempotencyKey: request.outboundIdempotencyKey,
        correlationId: request.correlationId,
        operation: 'quote',
        selection: request.selection,
        sequence: request.sequence,
        occurredAt: now,
        source: {
          submissionReference: request.id,
          riskReference: request.selection.riskHash,
          evidenceRefs: [`evidence://conformance/${request.id}`],
        },
        outcome: { kind: 'quote_ready', currency: request.currency, quote: request.quote },
        ...change,
      }),
    );
  const sign = (rawBody: Uint8Array, now: string, nonce = randomUUID()) => {
    const timestamp = String(Math.floor(Date.parse(now) / 1000));
    return {
      'x-provider-timestamp': timestamp,
      'x-provider-nonce': nonce,
      'x-provider-signature': createHmac('sha256', secret)
        .update(`${timestamp}.${nonce}.`)
        .update(rawBody)
        .digest('hex'),
    };
  };
  return { adapter, payload, sign };
}

test('canonical provider queue pins complete risk/release and records synthetic evidence without insurance mutation, surviving restart', async () => {
  const tmp = temporary();
  const f = setup(undefined, tmp.path);
  try {
    const initial = hash(f.store.insuranceHistory(f.context, f.record.id));
    const outbox = hash(f.store.insuranceOutbox(f.context));
    const view = f.request();
    assert.equal(view.request.selection.riskHash, f.record.decision!.evaluation.inputHash);
    assert.equal(view.request.releaseHash, f.release.hash);
    assert.equal(view.request.recordHash, f.record.recordHash);
    assert.equal(view.state.status, 'queued');
    assert.equal('claim' in view.state, false);
    assert.equal((await f.kernel.providers.workOnce()).claimed, true);
    const completed = f.get(view.request.id);
    assert.equal(completed.state.status, 'completed');
    assert.equal(completed.receipts[0]!.mode, 'synthetic');
    assert.deepEqual(
      completed.audit.map((a) => a.kind),
      ['requested', 'claimed', 'receipt_accepted'],
    );
    assert.equal(hash(f.store.insuranceHistory(f.context, f.record.id)), initial);
    assert.equal(hash(f.store.insuranceOutbox(f.context)), outbox);
    f.reopen();
    assert.deepEqual(f.get(view.request.id), completed);
    assert.equal((f.execute('provider_list', {}) as { hasMore: boolean }).hasMore, false);
    assert.equal(providerOperations.provider_request.mcp, false);
    assert.equal(providerOperations.provider_retry.mcp, false);
  } finally {
    f.close();
    tmp.cleanup();
  }
});

test('strict commands, cross-actor dedup, business identity, full scope and synthetic public ingress are fail closed', () => {
  const f = setup();
  try {
    const input = f.requestInput();
    const first = providerExecutionViewSchema.parse(f.execute('provider_request', input));
    const another = { ...f.context, actorId: 'another-builder', correlationId: randomUUID() };
    assert.deepEqual(f.kernel.execute('provider_request', input, another), first);
    assert.throws(
      () => f.execute('provider_request', { ...input, expectedVersion: 2 }),
      fails('IDEMPOTENCY_CONFLICT'),
    );
    assert.throws(() => f.request(), fails('PROVIDER_REQUEST_EXISTS'));
    assert.throws(() =>
      f.execute('provider_request', { ...input, url: 'https://operator-url.invalid' }),
    );
    assert.throws(
      () =>
        f.kernel.providers.acceptCallback(
          first.request.adapter.adapterId,
          first.request.id,
          Buffer.from('{}'),
          {},
        ),
      fails('SYNTHETIC_CALLBACK_FORBIDDEN'),
    );
    for (const field of ['workspaceId', 'tenantId', 'operatingEntityId', 'environment'] as const) {
      const scope = {
        ...f.context,
        [field]: field === 'environment' ? 'development' : 'other',
      } as Context;
      assert.throws(
        () => f.kernel.execute('provider_get', { requestId: first.request.id }, scope),
        fails('PROVIDER_REQUEST_NOT_FOUND'),
      );
      assert.deepEqual(f.kernel.execute('provider_list', {}, scope), {
        requests: [],
        hasMore: false,
      });
    }
    assert.throws(
      () =>
        f.kernel.execute('provider_request', f.requestInput(), {
          ...f.context,
          permissions: ['provider:read'],
        }),
      fails('FORBIDDEN'),
    );
    assert.throws(
      () =>
        f.kernel.execute('provider_request', f.requestInput(), {
          ...f.context,
          environment: 'production',
        }),
      fails('PROVIDER_ENVIRONMENT_UNSUPPORTED'),
    );
  } finally {
    f.close();
  }
});

test('dispatch awaits outside SQLite transaction and simultaneous workers cannot claim one job twice', async () => {
  let finish!: (r: ProviderTransportResult) => void;
  let sends = 0;
  const adapter = createSyntheticProviderAdapter();
  const original = adapter.send;
  adapter.send = async () => {
    sends++;
    return new Promise((r) => {
      finish = r;
    });
  };
  const tmp = temporary();
  const f = setup([adapter], tmp.path);
  let second: Store | undefined;
  try {
    const request = f.request().request;
    const pending = f.kernel.providers.workOnce();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(sends, 1);
    assert.equal(
      f.store.transaction(() => 42),
      42,
    );
    second = new Store(tmp.path);
    const other = new ProviderApplication(second, [adapter], f.clock);
    assert.equal((await other.workOnce()).claimed, false);
    finish(await original(request, { signal: new AbortController().signal }));
    await pending;
    assert.equal(f.get(request.id).state.status, 'completed');
    assert.equal(sends, 1);
  } finally {
    second?.close();
    f.close();
    tmp.cleanup();
  }
});

test('known not-sent failures obey backoff, reuse outbound identity, and exhaust the fixed attempt budget', async () => {
  const keys: string[] = [];
  const adapter = createSyntheticProviderAdapter();
  adapter.policy = {
    ...adapter.policy,
    baseDelayMs: 10,
    maxDelayMs: 20,
    timeoutMs: 20,
    deadlineMs: 1000,
  };
  adapter.send = async (r) => {
    keys.push(r.outboundIdempotencyKey);
    return { kind: 'failure', code: 'unavailable', deliveryState: 'not_sent' };
  };
  const f = setup([adapter]);
  try {
    const r = f.request().request;
    await f.kernel.providers.workOnce();
    assert.equal(f.get(r.id).state.status, 'retry_wait');
    assert.equal((await f.kernel.providers.workOnce()).claimed, false);
    assert.throws(
      () =>
        f.execute('provider_retry', {
          requestId: r.id,
          expectedVersion: f.get(r.id).state.version,
          idempotencyKey: randomUUID(),
        }),
      fails('PROVIDER_RETRY_UNAVAILABLE'),
    );
    f.advance(10);
    await f.kernel.providers.workOnce();
    f.advance(20);
    await f.kernel.providers.workOnce();
    assert.equal(f.get(r.id).state.status, 'failed');
    assert.equal(f.get(r.id).state.attempts, 3);
    assert.equal(new Set(keys).size, 1);
    assert.equal((await f.kernel.providers.workOnce()).claimed, false);
  } finally {
    f.close();
  }
});

test('timeouts abort dispatch and require reconciliation without automatically resending an ambiguous request', async () => {
  let aborted = false;
  let sends = 0;
  const adapter = createSyntheticProviderAdapter();
  adapter.policy = { ...adapter.policy, timeoutMs: 10 };
  adapter.send = async (_r, { signal }) => {
    sends++;
    signal.addEventListener('abort', () => {
      aborted = true;
    });
    return new Promise(() => {});
  };
  const f = setup([adapter]);
  try {
    const r = f.request().request;
    await f.kernel.providers.workOnce();
    assert.equal(aborted, true);
    assert.equal(f.get(r.id).state.status, 'reconciliation_required');
    assert.equal((await f.kernel.providers.workOnce()).claimed, false);
    assert.equal(sends, 1);
    assert.throws(
      () =>
        f.execute('provider_retry', {
          requestId: r.id,
          expectedVersion: f.get(r.id).state.version,
          idempotencyKey: randomUUID(),
        }),
      fails('PROVIDER_RECONCILIATION_UNSUPPORTED'),
    );
  } finally {
    f.close();
  }
});

test('registered reconciliation resolves ambiguity using the original request; operator cannot force a fresh send', async () => {
  let sends = 0;
  let reconciles = 0;
  const adapter = createSyntheticProviderAdapter();
  const original = adapter.send;
  adapter.send = async () => {
    sends++;
    return { kind: 'pending' };
  };
  adapter.reconcile = async (r, o) => {
    reconciles++;
    return original(r, o);
  };
  const f = setup([adapter]);
  try {
    const r = f.request().request;
    await f.kernel.providers.workOnce();
    const input = {
      requestId: r.id,
      expectedVersion: f.get(r.id).state.version,
      idempotencyKey: randomUUID(),
    };
    const queued = f.execute('provider_retry', input);
    assert.deepEqual(f.execute('provider_retry', input), queued);
    await f.kernel.providers.workOnce();
    assert.equal(f.get(r.id).state.status, 'completed');
    assert.equal(sends, 1);
    assert.equal(reconciles, 1);
  } finally {
    f.close();
  }
});

test('expired leases survive reopening and late worker completion cannot overwrite newer reconciliation state', async () => {
  let finish!: (r: ProviderTransportResult) => void;
  const adapter = createSyntheticProviderAdapter();
  const original = adapter.send;
  adapter.send = async () =>
    new Promise((r) => {
      finish = r;
    });
  const tmp = temporary();
  const f = setup([adapter], tmp.path);
  let second: Store | undefined;
  try {
    const r = f.request().request;
    const pending = f.kernel.providers.workOnce();
    await Promise.resolve();
    await Promise.resolve();
    f.advance(adapter.policy.timeoutMs + 5_001);
    second = new Store(tmp.path);
    const other = new ProviderApplication(second, [adapter], f.clock);
    assert.equal((await other.workOnce()).claimed, false);
    assert.equal(f.get(r.id).state.status, 'reconciliation_required');
    finish(await original(r, { signal: new AbortController().signal }));
    await pending;
    const state = f.get(r.id);
    assert.equal(state.state.status, 'reconciliation_required');
    assert.equal(state.receipts.length, 0);
    assert.deepEqual(
      state.audit.map((a) => a.kind),
      ['requested', 'claimed', 'claim_expired', 'late_attempt_ignored'],
    );
  } finally {
    second?.close();
    f.close();
    tmp.cleanup();
  }
});

test('real raw-byte HMAC ingress authenticates before mapping, rejects forgery/freshness violations, and persists exact duplicates across restart', async () => {
  const live = liveAdapter();
  let normalized = 0;
  const normalize = live.adapter.normalize;
  live.adapter.normalize = (b, r) => {
    normalized++;
    return normalize(b, r);
  };
  const tmp = temporary();
  const f = setup([live.adapter], tmp.path);
  try {
    const request = f.request().request;
    await f.kernel.providers.workOnce();
    const raw = live.payload(request, f.clock().toISOString());
    const headers = live.sign(raw, f.clock().toISOString());
    assert.throws(
      () =>
        f.kernel.providers.acceptCallback(
          live.adapter.descriptor.adapterId,
          request.id,
          Buffer.concat([raw, Buffer.from(' ')]),
          headers,
        ),
      fails('PROVIDER_AUTH_FAILED'),
    );
    const old = live.sign(raw, new Date(f.clock().getTime() - 300_001).toISOString());
    assert.throws(
      () =>
        f.kernel.providers.acceptCallback(live.adapter.descriptor.adapterId, request.id, raw, old),
      fails('PROVIDER_AUTH_FAILED'),
    );
    assert.equal(normalized, 0);
    const accepted = f.kernel.providers.acceptCallback(
      live.adapter.descriptor.adapterId,
      request.id,
      raw,
      headers,
    );
    assert.equal(accepted.disposition, 'accepted');
    const completed = f.get(request.id);
    assert.equal(completed.receipts[0]!.authentication.method, 'hmac_sha256');
    assert.equal(
      completed.receipts[0]!.envelope.source.payloadHash,
      createHash('sha256').update(raw).digest('hex'),
    );
    f.reopen();
    assert.equal(
      f.kernel.providers.acceptCallback(live.adapter.descriptor.adapterId, request.id, raw, headers)
        .disposition,
      'duplicate',
    );
    assert.deepEqual(f.get(request.id), completed);
    const changed = live.payload(request, f.clock().toISOString(), {
      outcome: { kind: 'declined', reasonCodes: ['synthetic_decline'] },
    });
    assert.throws(
      () =>
        f.kernel.providers.acceptCallback(
          live.adapter.descriptor.adapterId,
          request.id,
          changed,
          live.sign(changed, f.clock().toISOString()),
        ),
      fails('PROVIDER_REPLAY_CONFLICT'),
    );
    assert.equal(f.get(request.id).receipts.length, 1);
  } finally {
    f.close();
    tmp.cleanup();
  }
});

test('nonce reuse across requests is rejected atomically and authenticated wrong request/order/selection cannot attach evidence', async () => {
  const live = liveAdapter();
  const f = setup([live.adapter]);
  try {
    const first = f.request().request;
    const second = f.request(f.create()).request;
    const nonce = randomUUID();
    const now = f.clock().toISOString();
    const raw = live.payload(first, now);
    f.kernel.providers.acceptCallback(
      live.adapter.descriptor.adapterId,
      first.id,
      raw,
      live.sign(raw, now, nonce),
    );
    const other = live.payload(second, now);
    assert.throws(
      () =>
        f.kernel.providers.acceptCallback(
          live.adapter.descriptor.adapterId,
          second.id,
          other,
          live.sign(other, now, nonce),
        ),
      fails('PROVIDER_REPLAY_CONFLICT'),
    );
    assert.equal(f.get(second.id).receipts.length, 0);
    assert.equal(f.get(second.id).state.status, 'queued');
    for (const change of [
      { sequence: 2 },
      { correlationId: randomUUID() },
      { idempotencyKey: randomUUID() },
      { selection: { ...second.selection, riskHash: 'f'.repeat(64) } },
      { outcome: { kind: 'quote_ready', currency: 'USD', quote: second.quote } },
    ]) {
      const invalid = live.payload(second, now, change);
      assert.throws(
        () =>
          f.kernel.providers.acceptCallback(
            live.adapter.descriptor.adapterId,
            second.id,
            invalid,
            live.sign(invalid, now),
          ),
        (error) => error instanceof KernelError && error.status === 409,
      );
    }
    assert.equal(f.get(second.id).receipts.length, 0);
  } finally {
    f.close();
  }
});

test('late authenticated callback retains exact historical evidence after insurance version changes, without restoring old bind authority', async () => {
  const live = liveAdapter();
  const f = setup([live.adapter]);
  try {
    const request = f.request().request;
    await f.kernel.providers.workOnce();
    const bound = insuranceMutationResultSchema.parse(
      f.execute('insurance_bind', {
        recordId: f.record.id,
        expectedVersion: f.record.version,
        quoteHash: f.record.quoteHash,
        idempotencyKey: randomUUID(),
      }),
    ).record;
    const before = hash(f.store.insuranceHistory(f.context, bound.id));
    const now = f.clock().toISOString();
    const raw = live.payload(request, now);
    f.kernel.providers.acceptCallback(
      live.adapter.descriptor.adapterId,
      request.id,
      raw,
      live.sign(raw, now),
    );
    const result = f.get(request.id);
    assert.equal(result.state.status, 'superseded');
    assert.equal(result.audit.at(-1)!.code, 'STALE_RECORD_EVIDENCE');
    assert.equal(result.receipts[0]!.envelope.selection.quoteHash, request.selection.quoteHash);
    assert.equal(hash(f.store.insuranceHistory(f.context, bound.id)), before);
  } finally {
    f.close();
  }
});

test('late callback after request deadline is explicit evidence, while expired queued work is never dispatched', async () => {
  const live = liveAdapter();
  live.adapter.policy = { ...live.adapter.policy, timeoutMs: 10, deadlineMs: 50 };
  let sends = 0;
  live.adapter.send = async () => {
    sends++;
    return { kind: 'pending' };
  };
  const f = setup([live.adapter]);
  try {
    const first = f.request().request;
    await f.kernel.providers.workOnce();
    const second = f.request(f.create()).request;
    f.advance(51);
    await f.kernel.providers.workOnce();
    assert.equal(f.get(second.id).state.status, 'failed');
    assert.equal(sends, 1);
    const now = f.clock().toISOString();
    const raw = live.payload(first, now);
    f.kernel.providers.acceptCallback(
      live.adapter.descriptor.adapterId,
      first.id,
      raw,
      live.sign(raw, now),
    );
    assert.equal(f.get(first.id).audit.at(-1)!.code, 'LATE_AFTER_DEADLINE');
    assert.equal(f.get(first.id).state.status, 'completed');
  } finally {
    f.close();
  }
});

test('receipt, nonce, state and immutable audit roll back together on persistence failure', async () => {
  const live = liveAdapter();
  const tmp = temporary();
  const f = setup([live.adapter], tmp.path);
  const db = new DatabaseSync(tmp.path);
  try {
    const request = f.request().request;
    await f.kernel.providers.workOnce();
    const before = f.get(request.id);
    const now = f.clock().toISOString();
    const raw = live.payload(request, now);
    const headers = live.sign(raw, now);
    db.exec(
      "CREATE TRIGGER conformance_provider_fail BEFORE INSERT ON provider_audit WHEN json_extract(NEW.event_json,'$.kind')='receipt_accepted' BEGIN SELECT RAISE(ABORT,'conformance persistence failure'); END;",
    );
    assert.throws(() =>
      f.kernel.providers.acceptCallback(
        live.adapter.descriptor.adapterId,
        request.id,
        raw,
        headers,
      ),
    );
    assert.deepEqual(f.get(request.id), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM provider_nonces').get()!.n, 0);
    db.exec('DROP TRIGGER conformance_provider_fail');
    assert.equal(
      f.kernel.providers.acceptCallback(live.adapter.descriptor.adapterId, request.id, raw, headers)
        .disposition,
      'accepted',
    );
    assert.throws(() => db.exec('DELETE FROM provider_receipts'), /immutable provider evidence/);
    assert.throws(
      () => db.exec('UPDATE provider_audit SET event_hash=event_hash'),
      /immutable provider evidence/,
    );
    assert.throws(() => db.exec('DELETE FROM provider_requests'), /immutable provider evidence/);
  } finally {
    db.close();
    f.close();
    tmp.cleanup();
  }
});

test('malformed or unauthenticated worker response is ambiguous, never delivered or silently retried', async () => {
  const adapter = createSyntheticProviderAdapter();
  adapter.send = async () => ({ kind: 'delivery', rawBody: Buffer.from('{malformed') });
  const f = setup([adapter]);
  try {
    const request = f.request().request;
    await f.kernel.providers.workOnce();
    const result = f.get(request.id);
    assert.equal(result.state.status, 'reconciliation_required');
    assert.equal(result.receipts.length, 0);
    assert.equal(result.audit.at(-1)!.code, 'INVALID_PROVIDER_RESPONSE');
    assert.equal((await f.kernel.providers.workOnce()).claimed, false);
  } finally {
    f.close();
  }
});

test('pinned registration changes or absent verifier fail closed without approving provider/payment gates', async () => {
  const adapter = createSyntheticProviderAdapter();
  delete adapter.verify;
  const f = setup([adapter]);
  try {
    const request = f.request().request;
    await f.kernel.providers.workOnce();
    assert.equal(f.get(request.id).state.status, 'reconciliation_required');
    assert.equal(f.get(request.id).audit.at(-1)!.code, 'PROVIDER_AUTH_UNAVAILABLE');
    assert.equal(f.store.insuranceRead(f.context, f.record.id)!.recordHash, f.record.recordHash);
  } finally {
    f.close();
  }
});

test('synthetic training preserves referred and declined decisions rather than manufacturing eligible quotes', async () => {
  const f = setup();
  try {
    for (const eligibility of ['referred', 'declined']) {
      const submission = structuredClone(syntheticConfiguredSubmission);
      if (eligibility === 'referred') submission.answers.age = 18;
      else submission.answers.prohibited = true;
      const record = f.create(submission);
      const request = f.request(record).request;
      await f.kernel.providers.workOnce();
      const result = f.get(request.id);
      assert.equal(result.state.status, 'completed');
      assert.equal(result.receipts[0]!.envelope.outcome.kind, eligibility);
      assert.equal(result.receipts[0]!.mode, 'synthetic');
      assert.equal(f.store.insuranceRead(f.context, record.id)!.recordHash, record.recordHash);
    }
  } finally {
    f.close();
  }
});

test('stale ambiguous request is durably superseded and its late receipt never consumes the revised request active sequence', async () => {
  for (const lateFirst of [true, false]) {
    const live = liveAdapter();
    const f = setup([live.adapter]);
    try {
      const a = f.request().request;
      await f.kernel.providers.workOnce();
      const revised = f.revise(f.record);
      const b = f.request(revised).request;
      await f.kernel.providers.workOnce();
      assert.equal(f.get(a.id).state.status, 'superseded');
      assert.equal(f.get(a.id).audit.at(-1)!.code, 'STALE_RECORD_EXTERNAL_OUTCOME_UNKNOWN');
      assert.equal(a.sequence, 1);
      assert.equal(b.sequence, 1);
      assert.equal(b.streamPosition, 2);
      for (const request of lateFirst ? [a, b] : [b, a]) {
        const now = f.clock().toISOString();
        const raw = live.payload(request, now);
        assert.equal(
          f.kernel.providers.acceptCallback(
            live.adapter.descriptor.adapterId,
            request.id,
            raw,
            live.sign(raw, now),
          ).disposition,
          'accepted',
        );
      }
      assert.equal(f.get(a.id).state.status, 'superseded');
      assert.equal(f.get(a.id).receipts.length, 1);
      assert.equal(f.get(b.id).state.status, 'completed');
      assert.equal(f.get(b.id).receipts.length, 1);
      const c = f.request(f.revise(revised)).request;
      assert.equal(c.sequence, 2);
      assert.equal(c.streamPosition, 3);
    } finally {
      f.close();
    }
  }
});

test('new adapter request for the same unchanged quote owns the stream; failed older request can only add historical evidence', async () => {
  const live = liveAdapter();
  const second = {
    ...live.adapter,
    descriptor: { ...live.adapter.descriptor, adapterId: 'hmac_second' },
  };
  live.adapter.send = async () => ({
    kind: 'failure',
    code: 'rejected',
    deliveryState: 'confirmed_failed',
  });
  const f = setup([live.adapter, second]);
  try {
    const a = f.request().request;
    await f.kernel.providers.workOnce();
    assert.equal(f.get(a.id).state.status, 'failed');
    const b = providerExecutionViewSchema.parse(
      f.execute('provider_request', {
        ...f.requestInput(),
        adapterId: second.descriptor.adapterId,
      }),
    ).request;
    await f.kernel.providers.workOnce();
    const now = f.clock().toISOString();
    const rawA = live.payload(a, now);
    f.kernel.providers.acceptCallback(
      live.adapter.descriptor.adapterId,
      a.id,
      rawA,
      live.sign(rawA, now),
    );
    const rawB = live.payload(b, now, { adapterId: second.descriptor.adapterId });
    f.kernel.providers.acceptCallback(
      second.descriptor.adapterId,
      b.id,
      rawB,
      live.sign(rawB, now),
    );
    assert.equal(f.get(a.id).state.status, 'superseded');
    assert.equal(f.get(b.id).state.status, 'completed');
  } finally {
    f.close();
  }
});

test('completed provider evidence cannot make an unsupported provider or payment policy activatable', async () => {
  for (const gate of ['providerVerification', 'payment'] as const) {
    const policy = {
      ...configuredRuntimePolicy,
      requirements: {
        ...configuredRuntimePolicy.requirements,
        [gate]: 'required_unsupported' as const,
      },
    };
    const f = setup();
    try {
      const r = f.request().request;
      await f.kernel.providers.workOnce();
      assert.equal(f.get(r.id).state.status, 'completed');
      const before = tenantSetupSchema.parse(
        f.kernel.control.execute('control_setup', {}, f.principal, f.tenant.id),
      );
      const updated = tenantSetupSchema.parse(
        f.kernel.control.execute(
          'control_update_runtime_draft',
          {
            expectedVersion: before.runtimeDraft.version,
            policies: [policy],
            idempotencyKey: randomUUID(),
          },
          f.principal,
          f.tenant.id,
        ),
      );
      assert.equal(updated.candidate.canActivate, false);
      assert.ok(
        updated.candidate.blockers.some((b) =>
          b.includes('unsupported approval, payment or provider'),
        ),
      );
      assert.equal(updated.activeRelease!.hash, f.release.hash);
      assert.equal(f.store.insuranceRead(f.context, f.record.id)!.status, 'quoted');
    } finally {
      f.close();
    }
  }
});

test('real HTTP callback parser preserves the signed bytes and returns only acknowledgement after authenticated persistence', async () => {
  const live = liveAdapter();
  const f = setup([live.adapter]);
  const { correlationId: _correlation, ...credentialContext } = f.context;
  const app = buildApp({
    kernel: f.kernel,
    credentials: [{ token: randomBytes(32).toString('hex'), context: credentialContext }],
  });
  try {
    const request = f.request().request;
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const payload = JSON.parse(live.payload(request, f.clock().toISOString()).toString('utf8'));
    const raw = Buffer.from('\n ' + JSON.stringify(payload, null, 2) + '\n');
    const headers = {
      'content-type': 'application/json',
      ...live.sign(raw, f.clock().toISOString()),
    };
    const url = `${address}/provider-callbacks/${live.adapter.descriptor.adapterId}/${request.id}`;
    const forged = await fetch(url, { method: 'POST', headers, body: raw.toString('utf8').trim() });
    assert.equal(forged.status, 401);
    assert.equal(f.get(request.id).receipts.length, 0);
    const accepted = await fetch(url, { method: 'POST', headers, body: raw.toString('utf8') });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { received: true });
    const view = f.get(request.id);
    assert.equal(
      view.receipts[0]!.envelope.source.payloadHash,
      createHash('sha256').update(raw).digest('hex'),
    );
    const duplicate = await fetch(url, { method: 'POST', headers, body: raw.toString('utf8') });
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await duplicate.json(), { received: true });
    assert.deepEqual(f.get(request.id), view);
  } finally {
    await app.close();
    f.close();
  }
});

test('partial request creation rolls back its identity and job; corrupted job lookup indexes fail integrity checks', () => {
  const tmp = temporary();
  const f = setup(undefined, tmp.path);
  const db = new DatabaseSync(tmp.path);
  try {
    db.exec(
      "CREATE TRIGGER conformance_request_fail BEFORE INSERT ON provider_commands BEGIN SELECT RAISE(ABORT,'conformance command failure'); END;",
    );
    assert.throws(() => f.request());
    for (const table of [
      'provider_requests',
      'provider_job_heads',
      'provider_revisions',
      'provider_audit',
    ])
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0);
    db.exec('DROP TRIGGER conformance_request_fail');
    const request = f.request().request;
    db.prepare("UPDATE provider_job_heads SET status='completed' WHERE request_id=?").run(
      request.id,
    );
    assert.throws(() => f.get(request.id), fails('INTEGRITY_ERROR'));
  } finally {
    db.close();
    f.close();
    tmp.cleanup();
  }
});
