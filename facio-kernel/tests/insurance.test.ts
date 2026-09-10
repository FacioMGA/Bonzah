import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Kernel } from '../src/application/kernel.js';
import { Store } from '../src/storage/store.js';
import { hash, KernelError } from '../src/domain/canonical.js';
import {
  insuranceMutationResultSchema,
  insuranceOperations,
  type ExternalQuote,
  type InsuranceRecord,
  type ScopedRuntimePolicy,
} from '../src/contracts/insurance.js';
import type { Context } from '../src/contracts/configuration.js';
import {
  insuranceContext,
  scopedRuntimePolicy,
  runtimePolicy,
  externalQuote,
  testNow,
} from './fixtures/insurance.js';

function setup(
  policies: ScopedRuntimePolicy[] = [scopedRuntimePolicy],
  clock = testNow,
  path = ':memory:',
) {
  const store = new Store(path);
  return { store, kernel: new Kernel(store, [], policies, clock) };
}
const createInput = (quote: ExternalQuote = externalQuote) => ({
  idempotencyKey: randomUUID(),
  productId: runtimePolicy.id,
  productVersion: runtimePolicy.version,
  quote,
});
const mutate = (
  kernel: Kernel,
  name: keyof typeof insuranceOperations,
  input: unknown,
  context = insuranceContext,
) => insuranceMutationResultSchema.parse(kernel.execute(name, input, context));
const create = (kernel: Kernel, quote = externalQuote) =>
  mutate(kernel, 'insurance_create_quote', createInput(quote));
const bindInput = (record: InsuranceRecord) => ({
  idempotencyKey: randomUUID(),
  recordId: record.id,
  expectedVersion: record.version,
  quoteHash: record.quoteHash,
});
const serviceInput = (
  record: InsuranceRecord,
  action: 'endorsement' | 'cancellation' | 'reinstatement',
  premiumDeltaMinor: string,
) => ({
  idempotencyKey: randomUUID(),
  recordId: record.id,
  expectedVersion: record.version,
  recordHash: record.recordHash,
  action,
  premiumDeltaMinor,
  effectiveDate: '2026-09-10',
  reason: 'Explicit externally agreed manual adjustment, synthetic test only',
});
function code(expected: string) {
  return (error: unknown) => error instanceof KernelError && error.code === expected;
}

test('manual quote/revision/bind/service preserve selected source, exact allocations and complete immutable history', () => {
  const { store, kernel } = setup();
  try {
    const initial = create(kernel).record;
    const revisedQuote = structuredClone(externalQuote);
    revisedQuote.sourceQuote.version = '2';
    revisedQuote.premiumMinor = '12001';
    const revised = mutate(kernel, 'insurance_revise_quote', {
      idempotencyKey: randomUUID(),
      recordId: initial.id,
      expectedVersion: initial.version,
      recordHash: initial.recordHash,
      quote: revisedQuote,
    }).record;
    assert.notEqual(revised.quoteHash, initial.quoteHash);
    assert.throws(
      () =>
        mutate(kernel, 'insurance_revise_quote', {
          idempotencyKey: randomUUID(),
          recordId: revised.id,
          expectedVersion: revised.version,
          recordHash: revised.recordHash,
          quote: { ...externalQuote, premiumMinor: '13001' },
        }),
      code('SOURCE_VERSION_REQUIRED'),
    );
    assert.throws(
      () => mutate(kernel, 'insurance_bind', bindInput(initial)),
      code('VERSION_CONFLICT'),
    );
    const bound = mutate(kernel, 'insurance_bind', bindInput(revised)).record;
    assert.equal(bound.status, 'bound');
    assert.equal(bound.premiumMinor, '12001');
    const endorsed = mutate(
      kernel,
      'insurance_service',
      serviceInput(bound, 'endorsement', '100'),
    ).record;
    const cancelledResult = mutate(
      kernel,
      'insurance_service',
      serviceInput(endorsed, 'cancellation', '-4000'),
    );
    const reinstated = mutate(
      kernel,
      'insurance_service',
      serviceInput(cancelledResult.record, 'reinstatement', '4000'),
    ).record;
    assert.equal(reinstated.id, initial.id);
    assert.equal(reinstated.status, 'bound');
    assert.equal(reinstated.premiumMinor, '12101');
    assert.equal(reinstated.quote.premiumMinor, '12001');
    assert.equal(reinstated.quoteHash, bound.quoteHash);
    assert.equal(
      reinstated.financials.allocations.reduce((sum, row) => sum + BigInt(row.premiumMinor), 0n),
      12101n,
    );
    assert.equal(cancelledResult.event.premiumDeltaMinor, '-4000');
    const history = store.insuranceHistory(insuranceContext, initial.id);
    assert.equal(history.revisions.length, 6);
    assert.deepEqual(
      history.events.map((event) => event.type),
      ['quote_created', 'quote_revised', 'bound', 'endorsement', 'cancellation', 'reinstatement'],
    );
    assert.equal(history.revisions[0]?.quote.sourceQuote.version, '1');
    for (let i = 0; i < history.events.length; i++)
      assert.equal(
        BigInt(history.events[i]!.premiumDeltaMinor),
        BigInt(history.revisions[i]!.premiumMinor) -
          BigInt(history.revisions[i - 1]?.premiumMinor ?? '0'),
      );
    assert.equal(store.insuranceOutbox(insuranceContext).length, 6);
    assert.ok(store.insuranceOutbox(insuranceContext).every((row) => row.status === 'pending'));
  } finally {
    store.close();
  }
});

test('domain idempotency replays across authorized actors and stale/double binds cannot produce duplicate effects', () => {
  const { store, kernel } = setup();
  try {
    const input = createInput();
    const created = mutate(kernel, 'insurance_create_quote', input);
    const secondActor: Context = {
      ...insuranceContext,
      actorId: 'other-operator',
      correlationId: randomUUID(),
    };
    assert.deepEqual(mutate(kernel, 'insurance_create_quote', input, secondActor), created);
    assert.throws(
      () =>
        mutate(kernel, 'insurance_create_quote', {
          ...input,
          quote: { ...externalQuote, premiumMinor: '10002' },
        }),
      code('IDEMPOTENCY_CONFLICT'),
    );
    const binding = bindInput(created.record);
    const bound = mutate(kernel, 'insurance_bind', binding);
    assert.deepEqual(mutate(kernel, 'insurance_bind', binding, secondActor), bound);
    assert.throws(
      () =>
        mutate(kernel, 'insurance_bind', { ...binding, idempotencyKey: randomUUID() }, secondActor),
      code('VERSION_CONFLICT'),
    );
    assert.throws(
      () => mutate(kernel, 'insurance_bind', bindInput(bound.record)),
      code('INVALID_TRANSITION'),
    );
    assert.throws(
      () =>
        mutate(kernel, 'insurance_bind', binding, {
          ...secondActor,
          permissions: ['insurance:read'],
        }),
      code('FORBIDDEN'),
    );
    assert.equal(store.insuranceList(insuranceContext).records.length, 1);
    assert.equal(store.insuranceOutbox(insuranceContext).length, 2);
  } finally {
    store.close();
  }
});

test('one business record owns each scoped product and external quote reference across actors and versions', () => {
  const later = { ...runtimePolicy, version: '2.0.0' };
  const scopeVariants = [
    { workspaceId: 'another-workspace' },
    { tenantId: 'another-tenant' },
    { environment: 'sandbox' as const },
    { operatingEntityId: 'another-entity' },
  ];
  const policies: ScopedRuntimePolicy[] = [
    scopedRuntimePolicy,
    { ...scopedRuntimePolicy, policy: later, policyHash: hash(later) },
    ...scopeVariants.map((change) => ({
      ...scopedRuntimePolicy,
      scope: { ...scopedRuntimePolicy.scope, ...change },
    })),
  ];
  const { store, kernel } = setup(policies);
  try {
    const created = create(kernel).record;
    const anotherActor = { ...insuranceContext, actorId: 'second-operator' };
    assert.throws(
      () => mutate(kernel, 'insurance_create_quote', createInput(), anotherActor),
      code('SOURCE_QUOTE_EXISTS'),
    );
    assert.throws(
      () =>
        mutate(
          kernel,
          'insurance_create_quote',
          {
            ...createInput(),
            productVersion: '2.0.0',
            quote: {
              ...externalQuote,
              sourceQuote: { ...externalQuote.sourceQuote, version: '2' },
            },
          },
          anotherActor,
        ),
      code('SOURCE_QUOTE_EXISTS'),
    );
    mutate(kernel, 'insurance_bind', bindInput(created));
    assert.throws(
      () => mutate(kernel, 'insurance_create_quote', createInput(), anotherActor),
      code('SOURCE_QUOTE_EXISTS'),
    );
    const ids = new Set([created.id]);
    for (const change of scopeVariants) {
      const context = { ...insuranceContext, ...change };
      const isolated = mutate(kernel, 'insurance_create_quote', createInput(), context).record;
      ids.add(isolated.id);
      assert.equal(store.insuranceList(context).records.length, 1);
    }
    assert.equal(ids.size, 5);
    assert.equal(store.insuranceList(insuranceContext).records.length, 1);
    assert.equal(store.insuranceOutbox(insuranceContext).length, 2);
  } finally {
    store.close();
  }
});

test('binding blocks expired, referred/declined, prerequisite-required and drifted policy quotes', () => {
  let currentTime = testNow();
  const { store, kernel } = setup([scopedRuntimePolicy], () => currentTime);
  try {
    for (const eligibility of ['referred', 'declined'] as const) {
      const record = create(kernel, {
        ...externalQuote,
        eligibility,
        sourceQuote: { ...externalQuote.sourceQuote, reference: 'external-' + eligibility },
      }).record;
      assert.throws(
        () => mutate(kernel, 'insurance_bind', bindInput(record)),
        code('QUOTE_NOT_READY'),
      );
    }
    const expiring = create(kernel).record;
    currentTime = new Date('2026-09-16T12:00:00.000Z');
    assert.throws(
      () => mutate(kernel, 'insurance_bind', bindInput(expiring)),
      code('QUOTE_EXPIRED'),
    );
    const changedPolicy = { ...runtimePolicy, name: 'Changed under the same version' };
    const drift = new Kernel(
      store,
      [],
      [{ ...scopedRuntimePolicy, policy: changedPolicy, policyHash: hash(changedPolicy) }],
      testNow,
    );
    assert.throws(
      () => mutate(drift, 'insurance_bind', bindInput(expiring)),
      code('POLICY_VERSION_CONFLICT'),
    );
  } finally {
    store.close();
  }
  for (const gate of ['payment', 'approval', 'providerVerification'] as const) {
    const policy = {
      ...runtimePolicy,
      requirements: { ...runtimePolicy.requirements, [gate]: 'required_unsupported' as const },
    };
    const gated = setup([{ ...scopedRuntimePolicy, policy, policyHash: hash(policy) }]);
    try {
      const record = create(gated.kernel).record;
      assert.throws(
        () => mutate(gated.kernel, 'insurance_bind', bindInput(record)),
        code('PREREQUISITE_UNSUPPORTED'),
      );
      assert.equal(gated.store.insuranceOutbox(insuranceContext).length, 1);
    } finally {
      gated.store.close();
    }
  }
});

test('quote validation rejects invalid dates, money, capacity, bounds, source-version claims and asserted approval', () => {
  const limited = { ...runtimePolicy, maximumPremiumMinor: '20000', maximumParticipants: 2 };
  const { store, kernel } = setup([
    { ...scopedRuntimePolicy, policy: limited, policyHash: hash(limited) },
  ]);
  try {
    for (const quote of [
      { ...externalQuote, premiumMinor: '-1' },
      { ...externalQuote, premiumMinor: '1.01' },
      { ...externalQuote, premiumMinor: '001' },
      { ...externalQuote, term: { startDate: '2026-02-30', endDate: '2026-09-30' } },
      { ...externalQuote, term: { startDate: '2026-09-30', endDate: '2026-09-01' } },
      { ...externalQuote, premiumMinor: '20001' },
      { ...externalQuote, approved: true },
      { ...externalQuote, participants: [{ id: 'lead-market', role: 'lead', shareBps: 9000 }] },
      {
        ...externalQuote,
        participants: [
          { id: 'lead-market', role: 'lead', shareBps: 5000 },
          { id: 'lead-market', role: 'follow', shareBps: 5000 },
        ],
      },
      {
        ...externalQuote,
        participants: [
          { id: 'a', role: 'lead', shareBps: 4000 },
          { id: 'b', role: 'follow', shareBps: 3000 },
          { id: 'c', role: 'follow', shareBps: 3000 },
        ],
      },
    ])
      assert.throws(() =>
        kernel.execute(
          'insurance_create_quote',
          createInput(quote as ExternalQuote),
          insuranceContext,
        ),
      );
    assert.equal(store.insuranceList(insuranceContext).records.length, 0);
    for (const premiumMinor of ['abc', '1.01', '', 'NaN', '1e5'])
      assert.throws(
        () =>
          kernel.execute(
            'insurance_create_quote',
            createInput({ ...externalQuote, premiumMinor }),
            insuranceContext,
          ),
        code('VALIDATION_ERROR'),
      );
    const record = create(kernel).record;
    assert.throws(
      () =>
        mutate(kernel, 'insurance_revise_quote', {
          idempotencyKey: randomUUID(),
          recordId: record.id,
          expectedVersion: record.version,
          recordHash: record.recordHash,
          quote: { ...externalQuote, premiumMinor: '10002' },
        }),
      code('SOURCE_VERSION_REQUIRED'),
    );
    assert.throws(
      () =>
        mutate(kernel, 'insurance_bind', {
          ...bindInput(record),
          premiumMinor: '1',
          providerVerified: true,
        }),
      code('VALIDATION_ERROR'),
    );
  } finally {
    store.close();
  }
});

test('servicing enforces state, sign, date, concurrency, total bounds and immutable currency/term', () => {
  const { store, kernel } = setup();
  try {
    const quote = create(kernel).record;
    assert.throws(
      () => mutate(kernel, 'insurance_service', serviceInput(quote, 'endorsement', '1')),
      code('INVALID_TRANSITION'),
    );
    const bound = mutate(kernel, 'insurance_bind', bindInput(quote)).record;
    for (const command of [
      serviceInput(bound, 'cancellation', '1'),
      serviceInput(bound, 'endorsement', '-10002'),
      serviceInput(bound, 'reinstatement', '1'),
      { ...serviceInput(bound, 'endorsement', '1'), effectiveDate: '2026-10-01' },
      { ...serviceInput(bound, 'endorsement', '1'), effectiveDate: '2026-08-31' },
      { ...serviceInput(bound, 'endorsement', '1'), effectiveDate: '2026-09-11' },
      { ...serviceInput(bound, 'endorsement', '1'), currency: 'USD' },
      {
        ...serviceInput(bound, 'endorsement', '1'),
        term: { startDate: '2026-09-01', endDate: '2026-10-01' },
      },
    ])
      assert.throws(() => mutate(kernel, 'insurance_service', command));
    assert.throws(
      () =>
        mutate(kernel, 'insurance_revise_quote', {
          idempotencyKey: randomUUID(),
          recordId: bound.id,
          expectedVersion: bound.version,
          recordHash: bound.recordHash,
          quote: { ...externalQuote, sourceQuote: { ...externalQuote.sourceQuote, version: '2' } },
        }),
      code('INVALID_TRANSITION'),
    );
    const cancelled = mutate(
      kernel,
      'insurance_service',
      serviceInput(bound, 'cancellation', '-10001'),
    ).record;
    assert.equal(cancelled.premiumMinor, '0');
    assert.throws(
      () => mutate(kernel, 'insurance_service', serviceInput(cancelled, 'endorsement', '1')),
      code('INVALID_TRANSITION'),
    );
    assert.throws(
      () => mutate(kernel, 'insurance_service', serviceInput(cancelled, 'reinstatement', '-1')),
      code('INVALID_FINANCIAL_DELTA'),
    );
    assert.throws(
      () => mutate(kernel, 'insurance_service', serviceInput(cancelled, 'reinstatement', '0')),
      code('INVALID_FINANCIAL_DELTA'),
    );
    assert.throws(
      () =>
        mutate(kernel, 'insurance_service', {
          ...serviceInput(cancelled, 'reinstatement', '1'),
          effectiveDate: '2026-09-09',
        }),
      code('INVALID_EFFECTIVE_DATE'),
    );
    assert.equal(store.insuranceHistory(insuranceContext, quote.id).revisions.length, 3);
  } finally {
    store.close();
  }
});

test('runtime isolation enforces all scope dimensions, permissions and production prohibition', () => {
  const { store, kernel } = setup();
  try {
    const record = create(kernel).record;
    for (const scope of [
      { workspaceId: 'other' },
      { tenantId: 'other' },
      { environment: 'sandbox' as const },
      { operatingEntityId: 'other' },
    ]) {
      const context = { ...insuranceContext, ...scope };
      assert.deepEqual(kernel.execute('insurance_catalog', {}, context), { policies: [] });
      assert.deepEqual(kernel.execute('insurance_list', {}, context), {
        records: [],
        hasMore: false,
      });
      assert.throws(
        () => kernel.execute('insurance_get', { recordId: record.id }, context),
        code('NOT_FOUND'),
      );
      assert.throws(
        () => mutate(kernel, 'insurance_bind', bindInput(record), context),
        code('NOT_FOUND'),
      );
      assert.throws(
        () => kernel.execute('insurance_create_quote', createInput(), context),
        code('POLICY_NOT_AVAILABLE'),
      );
    }
    for (const name of Object.keys(insuranceOperations) as (keyof typeof insuranceOperations)[])
      assert.throws(
        () => kernel.execute(name, {}, { ...insuranceContext, permissions: [] }),
        code('FORBIDDEN'),
      );
    assert.throws(
      () =>
        kernel.execute('insurance_list', {}, { ...insuranceContext, environment: 'production' }),
      code('RUNTIME_ENVIRONMENT_UNSUPPORTED'),
    );
    assert.throws(
      () => kernel.execute('insurance_catalog', { tenantId: 'other' }, insuranceContext),
      code('VALIDATION_ERROR'),
    );
    assert.throws(
      () => new Kernel(store, [], [{ ...scopedRuntimePolicy, policyHash: '0'.repeat(64) }]),
      code('INTEGRITY_ERROR'),
    );
    assert.throws(
      () => new Kernel(store, [], [scopedRuntimePolicy, scopedRuntimePolicy]),
      code('INTEGRITY_ERROR'),
    );
    assert.throws(
      () =>
        new Kernel(
          store,
          [],
          [{ ...scopedRuntimePolicy, scope: { ...insuranceContext, environment: 'production' } }],
        ),
      /./,
    );
  } finally {
    store.close();
  }
});

test('revision, event, head, retry and outbox writes roll back atomically and survive reopening', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kernel-insurance-'));
  const path = join(dir, 'store.sqlite');
  let { store, kernel } = setup([scopedRuntimePolicy], testNow, path);
  const db = new DatabaseSync(path);
  try {
    const record = create(kernel).record;
    const input = bindInput(record);
    db.exec(
      "CREATE TRIGGER test_reject_outbox BEFORE INSERT ON insurance_outbox BEGIN SELECT RAISE(ABORT,'synthetic outbox failure'); END;",
    );
    assert.throws(() => mutate(kernel, 'insurance_bind', input), /synthetic outbox failure/);
    const retryQuote = {
      ...externalQuote,
      sourceQuote: { ...externalQuote.sourceQuote, reference: 'atomic-source' },
    };
    assert.throws(() => create(kernel, retryQuote), /synthetic outbox failure/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM insurance_quote_identities').get()?.n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM insurance_records').get()?.n, 1);
    assert.equal(store.insuranceRead(insuranceContext, record.id).status, 'quoted');
    assert.equal(store.insuranceHistory(insuranceContext, record.id).events.length, 1);
    assert.equal(store.insuranceOutbox(insuranceContext).length, 1);
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM insurance_idempotency WHERE operation='insurance_bind'")
        .get()?.n,
      0,
    );
    db.exec('DROP TRIGGER test_reject_outbox');
    const bound = mutate(kernel, 'insurance_bind', input);
    assert.throws(
      () => db.exec("UPDATE insurance_revisions SET record_json='{}'"),
      /immutable insurance revision/,
    );
    assert.throws(() => db.exec('DELETE FROM insurance_events'), /immutable insurance event/);
    assert.throws(() => db.exec('DELETE FROM insurance_outbox'), /immutable pending outbox/);
    store.close();
    db.exec(
      'DROP TABLE insurance_quote_identities; DELETE FROM schema_migrations WHERE version=3;',
    );
    ({ store, kernel } = setup([scopedRuntimePolicy], testNow, path));
    assert.deepEqual(
      mutate(kernel, 'insurance_bind', input, {
        ...insuranceContext,
        actorId: 'restarted-operator',
      }),
      bound,
    );
    assert.equal(store.insuranceHistory(insuranceContext, record.id).revisions.length, 2);
    assert.equal(store.insuranceOutbox(insuranceContext).length, 2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM insurance_quote_identities').get()?.n, 1);
    assert.throws(() => create(kernel), code('SOURCE_QUOTE_EXISTS'));
    create(kernel, retryQuote);
    assert.equal(store.insuranceList(insuranceContext).records.length, 2);
    db.exec("UPDATE insurance_records SET record_hash='tampered'");
    assert.throws(
      () => kernel.execute('insurance_get', { recordId: record.id }, insuranceContext),
      code('INTEGRITY_ERROR'),
    );
  } finally {
    db.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('conflicting legacy quote identities fail migration without retaining a database lock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kernel-legacy-identity-'));
  const path = join(dir, 'store.sqlite');
  const original = setup([scopedRuntimePolicy], testNow, path);
  const first = create(original.kernel, {
    ...externalQuote,
    sourceQuote: { ...externalQuote.sourceQuote, reference: 'legacy-first' },
  }).record;
  const second = create(original.kernel, {
    ...externalQuote,
    sourceQuote: { ...externalQuote.sourceQuote, reference: 'legacy-second' },
  }).record;
  original.store.close();
  const db = new DatabaseSync(path);
  let recovered: Store | undefined;
  try {
    // Model a legacy v2 store whose records predate the durable business identity constraint.
    db.exec(
      'DROP TABLE insurance_quote_identities; DELETE FROM schema_migrations WHERE version=3; DROP TRIGGER insurance_revisions_no_update;',
    );
    db.prepare(
      "UPDATE insurance_revisions SET record_json=json_set(record_json,'$.quote.sourceQuote.reference',?) WHERE record_id=?",
    ).run('legacy-first', second.id);
    assert.throws(() => new Store(path), code('STORAGE_MIGRATION_FAILED'));
    // A failed startup must release its hidden connection, so a recovery owner can acquire the write lock.
    db.exec('BEGIN IMMEDIATE; ROLLBACK;');
    assert.equal(db.prepare('SELECT count(*) AS n FROM insurance_records').get()?.n, 2);
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM schema_migrations WHERE version=3').get()?.n,
      0,
    );
    db.prepare(
      "UPDATE insurance_revisions SET record_json=json_set(record_json,'$.quote.sourceQuote.reference',?) WHERE record_id=?",
    ).run('legacy-second', second.id);
    recovered = new Store(path);
    assert.equal(
      recovered.insuranceRead(insuranceContext, first.id).quote.sourceQuote.reference,
      'legacy-first',
    );
    assert.equal(
      recovered.insuranceRead(insuranceContext, second.id).quote.sourceQuote.reference,
      'legacy-second',
    );
  } finally {
    recovered?.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
