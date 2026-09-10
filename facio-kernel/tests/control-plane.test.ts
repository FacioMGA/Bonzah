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
  tenantSetupSchema,
  tenantRecordSchema,
  type Principal,
  type TenantRecord,
  type TenantSetup,
  type AccountBootstrap,
} from '../src/contracts/control-plane.js';
import { insuranceMutationResultSchema, insuranceOperations } from '../src/contracts/insurance.js';
import { snapshotSchema } from '../src/contracts/configuration.js';
import { requirementsReportSchema } from '../src/contracts/requirements.js';
import { referenceConfiguration } from '../src/fixtures/reference.js';
import { syntheticRequirementsProfile } from './fixtures/requirements.js';
import { runtimePolicy, externalQuote, testNow } from './fixtures/insurance.js';

const principal = (actorId: string): Principal => ({
  actorId,
  issuer: 'https://identity.example.test',
  subject: 'subject-' + actorId,
  correlationId: randomUUID(),
  email: actorId + '@example.test',
});
const admin = principal('administrator'),
  alice = principal('alice'),
  bob = principal('bob'),
  outsider = principal('outsider');
const bootstrap: AccountBootstrap = {
  accountId: 'account-one',
  workspaceId: 'workspace-one',
  displayName: 'Synthetic sandbox account',
  members: [
    { ...admin, role: 'admin' },
    { ...alice, role: 'builder' },
    { ...bob, role: 'builder' },
  ],
};
const fail = (code: string) => (error: unknown) =>
  error instanceof KernelError && error.code === code;
function setup(path = ':memory:') {
  const store = new Store(path);
  const kernel = new Kernel(store, [], [], testNow, {
    region: 'test-region',
    buildSha: 'a'.repeat(40),
  });
  kernel.control.bootstrapAccount(bootstrap);
  kernel.control.bootstrapAccount({
    accountId: 'account-two',
    workspaceId: 'workspace-two',
    displayName: 'Other account',
    members: [{ ...outsider, role: 'owner' }],
  });
  return { store, kernel };
}
function create(kernel: Kernel, who = alice, key = randomUUID()): TenantRecord {
  return tenantRecordSchema.parse(
    (
      kernel.control.execute(
        'control_create_tenant',
        {
          accountId: 'account-one',
          displayName: 'Training sandbox',
          environment: 'sandbox',
          region: 'test-region',
          idempotencyKey: key,
        },
        who,
      ) as { tenant: unknown }
    ).tenant,
  );
}
const inspect = (kernel: Kernel, tenant: TenantRecord, who = alice) =>
  tenantSetupSchema.parse(kernel.control.execute('control_setup', {}, who, tenant.id));
function attach(kernel: Kernel, tenant: TenantRecord, who = alice) {
  return tenantSetupSchema.parse(
    kernel.control.execute(
      'control_attach_requirements',
      { expectedVersion: 0, profile: syntheticRequirementsProfile, idempotencyKey: randomUUID() },
      who,
      tenant.id,
    ),
  );
}
function configure(kernel: Kernel, tenant: TenantRecord) {
  const config = structuredClone(referenceConfiguration);
  config.tenant!.currency = 'GBP';
  config.operatingEntities[0]!.id = tenant.scope.operatingEntityId;
  config.products[0] = {
    ...config.products[0]!,
    id: runtimePolicy.id,
    version: runtimePolicy.version,
    operatingEntityId: tenant.scope.operatingEntityId,
    requiredCapabilities: ['definition_validation', 'manual_external_quote', 'exact_money'],
  };
  kernel.executeForPrincipal(
    'configuration_update_draft',
    { expectedVersion: 1, configuration: config, idempotencyKey: randomUUID() },
    alice,
    tenant.id,
  );
  attach(kernel, tenant);
  return tenantSetupSchema.parse(
    kernel.control.execute(
      'control_update_runtime_draft',
      { expectedVersion: 1, policies: [runtimePolicy], idempotencyKey: randomUUID() },
      alice,
      tenant.id,
    ),
  );
}
function activate(
  kernel: Kernel,
  tenant: TenantRecord,
  value = inspect(kernel, tenant),
): TenantSetup {
  const { canActivate: _, blockers: __, ...candidate } = value.candidate;
  return tenantSetupSchema.parse(
    kernel.control.execute(
      'control_activate',
      { ...candidate, idempotencyKey: randomUUID() },
      alice,
      tenant.id,
    ),
  );
}
const quote = (kernel: Kernel, tenant: TenantRecord, reference = 'quote-1') =>
  insuranceMutationResultSchema.parse(
    kernel.executeForPrincipal(
      'insurance_create_quote',
      {
        idempotencyKey: randomUUID(),
        productId: runtimePolicy.id,
        productVersion: runtimePolicy.version,
        quote: { ...externalQuote, sourceQuote: { ...externalQuote.sourceQuote, reference } },
      },
      alice,
      tenant.id,
    ),
  ).record;

test('account authorization, tenant ownership and explicit target isolate all draft/runtime reads', () => {
  const { store, kernel } = setup();
  try {
    const a = create(kernel);
    const b = create(kernel, bob);
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.scope.operatingEntityId, b.scope.operatingEntityId);
    assert.deepEqual(
      kernel.control.session(alice).tenants.map((t) => t.id),
      [a.id],
    );
    assert.equal(kernel.control.session(admin).tenants.length, 2);
    assert.throws(() => inspect(kernel, a, bob), fail('FORBIDDEN'));
    assert.throws(() => inspect(kernel, a, outsider), fail('FORBIDDEN'));
    assert.throws(
      () => kernel.executeForPrincipal('configuration_inspect', { view: 'draft' }, bob, a.id),
      fail('FORBIDDEN'),
    );
    assert.throws(
      () => kernel.control.execute('control_setup', {}, alice),
      fail('TENANT_TARGET_REQUIRED'),
    );
    assert.throws(
      () => kernel.control.session({ ...alice, subject: bob.subject }),
      fail('FORBIDDEN'),
    );
    configure(kernel, a);
    const untouched = snapshotSchema.parse(
      kernel.executeForPrincipal('configuration_inspect', { view: 'draft' }, bob, b.id),
    );
    assert.equal(untouched.version, 1);
    assert.equal(untouched.configuration.products.length, 0);
    assert.equal(
      insuranceOperations.insurance_catalog.output.parse(
        kernel.executeForPrincipal('insurance_catalog', {}, alice, a.id),
      ).policies.length,
      0,
    );
  } finally {
    store.close();
  }
});

test('create persists requested identity across failure and retries the same tenant without resets', () => {
  const { store, kernel } = setup();
  try {
    const original = store.provisionScope.bind(store);
    store.provisionScope = () => {
      throw new KernelError('TEST_DISK_FAILURE', 'Synthetic local write failure', 500);
    };
    const key = randomUUID();
    assert.throws(() => create(kernel, alice, key), fail('TEST_DISK_FAILURE'));
    const failed = kernel.control.session(alice).tenants[0]!;
    assert.equal(failed.provisioningState, 'Failed');
    assert.equal(failed.failureCode, 'TEST_DISK_FAILURE');
    store.provisionScope = original;
    const retry = tenantRecordSchema.parse(
      (
        kernel.control.execute(
          'control_retry_tenant',
          { operationId: failed.operationId, idempotencyKey: randomUUID() },
          alice,
        ) as { tenant: unknown }
      ).tenant,
    );
    assert.equal(retry.id, failed.id);
    assert.equal(retry.provisioningState, 'Provisioning');
    assert.equal(retry.setupStatus, 'awaiting_requirements');
    const replay = create(kernel, alice, key);
    assert.equal(replay.id, failed.id);
    assert.equal(kernel.control.session(alice).tenants.length, 1);
    assert.throws(() => create(kernel, bob, key), fail('FORBIDDEN'));
    assert.throws(
      () =>
        kernel.control.execute(
          'control_create_tenant',
          {
            accountId: 'account-one',
            displayName: 'Other payload',
            environment: 'sandbox',
            region: 'test-region',
            idempotencyKey: key,
          },
          alice,
        ),
      fail('IDEMPOTENCY_CONFLICT'),
    );
    assert.throws(
      () =>
        kernel.control.execute(
          'control_create_tenant',
          {
            accountId: 'account-one',
            displayName: 'Wrong host',
            environment: 'sandbox',
            region: 'other',
            idempotencyKey: randomUUID(),
          },
          alice,
        ),
      fail('REGION_UNAVAILABLE'),
    );
  } finally {
    store.close();
  }
});

test('persisted revocation is immediate and bootstrap/repeated verified login never regrants it', () => {
  const { store, kernel } = setup();
  try {
    const tenant = create(kernel);
    store.control.revoke('account-one', alice.actorId);
    assert.throws(() => inspect(kernel, tenant), fail('FORBIDDEN'));
    assert.throws(
      () => kernel.executeForPrincipal('insurance_list', {}, alice, tenant.id),
      fail('FORBIDDEN'),
    );
    kernel.control.bootstrapAccount(bootstrap);
    assert.equal(kernel.control.session(alice).accounts.length, 0);
    const invited = {
      issuer: 'https://accounts.google.com',
      email: 'invited@example.test',
      role: 'builder' as const,
    };
    kernel.control.bootstrapAccount({ ...bootstrap, members: [invited] });
    const google = { ...principal('google-user'), issuer: invited.issuer, email: invited.email };
    kernel.control.acceptVerifiedInvitation(google);
    assert.equal(kernel.control.session(google).accounts.length, 1);
    store.control.revoke('account-one', google.actorId);
    kernel.control.bootstrapAccount({ ...bootstrap, members: [invited] });
    kernel.control.acceptVerifiedInvitation(google);
    assert.equal(kernel.control.session(google).accounts.length, 0);
    const impersonator = {
      ...principal('other-user'),
      issuer: invited.issuer,
      email: invited.email,
    };
    kernel.control.acceptVerifiedInvitation(impersonator);
    assert.throws(() => kernel.control.session(impersonator), fail('FORBIDDEN'));
  } finally {
    store.close();
  }
});

test('source attachments retain canonical bytes and provenance boundaries without customer acceptance claims', () => {
  const { store, kernel } = setup();
  try {
    const tenant = create(kernel);
    const before = inspect(kernel, tenant);
    assert.equal(before.requirements, null);
    assert.equal(before.candidate.canActivate, false);
    const result = attach(kernel, tenant);
    assert.equal(result.tenant.provisioningState, 'Ready');
    assert.equal(result.requirements?.sourceClaimsStatus, 'unverified');
    assert.equal(result.requirements?.sourceProfileHash, hash(syntheticRequirementsProfile));
    assert.equal(result.candidate.canActivate, false);
    const report = requirementsReportSchema.parse(
      kernel.executeForPrincipal('configuration_requirements', {}, alice, tenant.id),
    );
    assert.equal(report.runtimeStatus, 'pending_evidence');
    assert.equal(report.acceptanceStatus, 'not_recorded');
    assert.throws(() => attach(kernel, tenant), fail('VERSION_CONFLICT'));
    const invalid = structuredClone(syntheticRequirementsProfile);
    invalid.requirements[0]!.sourceRefs[0]!.sourceId = 'missing';
    assert.throws(
      () =>
        kernel.control.execute(
          'control_attach_requirements',
          { expectedVersion: 1, profile: invalid, idempotencyKey: randomUUID() },
          alice,
          tenant.id,
        ),
      fail('INVALID_REQUIREMENTS_PROFILE'),
    );
    assert.equal(inspect(kernel, tenant).requirements?.version, 1);
  } finally {
    store.close();
  }
});

test('activation requires exact candidate and supported policies; records retain old release for bind after reactivation', () => {
  const { store, kernel } = setup();
  try {
    const tenant = create(kernel);
    const ready = configure(kernel, tenant);
    assert.equal(ready.candidate.canActivate, true, JSON.stringify(ready.candidate.blockers));
    const activated = activate(kernel, tenant, ready);
    const first = activated.activeRelease!;
    assert.equal(first.acceptanceStatus, 'not_recorded');
    assert.equal(first.runtimeStatus, 'manual_external_quote_only');
    const record = quote(kernel, tenant);
    assert.equal(record.runtimeReleaseId, first.id);
    const changedPolicy = {
      ...runtimePolicy,
      commission: { ...runtimePolicy.commission, rateBps: 2000 },
    };
    const newer = tenantSetupSchema.parse(
      kernel.control.execute(
        'control_update_runtime_draft',
        { expectedVersion: 2, policies: [changedPolicy], idempotencyKey: randomUUID() },
        alice,
        tenant.id,
      ),
    );
    assert.throws(() => activate(kernel, tenant, ready), fail('VERSION_CONFLICT'));
    const second = activate(kernel, tenant, newer).activeRelease!;
    assert.notEqual(first.id, second.id);
    assert.equal(second.version, 2);
    assert.equal(
      store.control.release(tenant.scope, first.id)?.runtimeDraft.policies[0]?.commission.rateBps,
      1000,
    );
    const bound = insuranceMutationResultSchema.parse(
      kernel.executeForPrincipal(
        'insurance_bind',
        {
          recordId: record.id,
          expectedVersion: record.version,
          quoteHash: record.quoteHash,
          idempotencyKey: randomUUID(),
        },
        alice,
        tenant.id,
      ),
    ).record;
    assert.equal(bound.runtimeReleaseId, first.id);
    assert.equal(bound.financials.commission.rateBps, 1000);
    assert.equal(quote(kernel, tenant, 'quote-2').financials.commission.rateBps, 2000);
    const published = snapshotSchema.parse(
      kernel.executeForPrincipal('configuration_inspect', { view: 'published' }, alice, tenant.id),
    );
    assert.equal(published.releaseId, second.id);
    const blocked = tenantSetupSchema.parse(
      kernel.control.execute(
        'control_update_runtime_draft',
        {
          expectedVersion: 3,
          policies: [
            {
              ...runtimePolicy,
              requirements: { ...runtimePolicy.requirements, payment: 'required_unsupported' },
            },
          ],
          idempotencyKey: randomUUID(),
        },
        alice,
        tenant.id,
      ),
    );
    assert.equal(blocked.candidate.canActivate, false);
    assert.throws(() => activate(kernel, tenant, blocked), fail('ACTIVATION_BLOCKED'));
    assert.equal(inspect(kernel, tenant).activeRelease?.id, second.id);
  } finally {
    store.close();
  }
});

test('activation and requirements audit failures roll back pointers and immutable writes atomically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kernel-control-'));
  const path = join(dir, 'test.sqlite');
  const { store, kernel } = setup(path);
  const direct = new DatabaseSync(path);
  try {
    const tenant = create(kernel);
    configure(kernel, tenant);
    direct.exec(
      "CREATE TRIGGER test_activation_failure BEFORE INSERT ON control_audit WHEN NEW.operation='control_activate' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END;",
    );
    assert.throws(() => activate(kernel, tenant), /injected audit failure/);
    assert.equal(inspect(kernel, tenant).activeRelease, null);
    assert.equal(
      direct.prepare('SELECT count(*) AS count FROM control_sandbox_releases').get()!.count,
      0,
    );
    direct.exec('DROP TRIGGER test_activation_failure');
    activate(kernel, tenant);
    assert.throws(
      () => direct.exec("UPDATE control_sandbox_releases SET bundle_json='{}'"),
      /immutable sandbox evidence/,
    );
    assert.throws(
      () => direct.exec('DELETE FROM control_requirements'),
      /immutable sandbox evidence/,
    );
  } finally {
    direct.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('restart preserves scope, memberships, attachments and active policies without fixture fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kernel-control-reopen-'));
  const path = join(dir, 'test.sqlite');
  let current = setup(path);
  let closed = false;
  try {
    const tenant = create(current.kernel);
    configure(current.kernel, tenant);
    const released = activate(current.kernel, tenant).activeRelease!;
    const record = quote(current.kernel, tenant);
    current.store.close();
    closed = true;
    current = setup(path);
    closed = false;
    assert.equal(inspect(current.kernel, tenant).activeRelease?.hash, released.hash);
    assert.equal(
      inspect(current.kernel, tenant).requirements?.sourceProfileHash,
      hash(syntheticRequirementsProfile),
    );
    const result = insuranceMutationResultSchema.parse(
      current.kernel.executeForPrincipal(
        'insurance_bind',
        {
          recordId: record.id,
          expectedVersion: record.version,
          quoteHash: record.quoteHash,
          idempotencyKey: randomUUID(),
        },
        alice,
        tenant.id,
      ),
    );
    assert.equal(result.record.status, 'bound');
    assert.equal(result.record.runtimeReleaseId, released.id);
    assert.equal(current.store.insuranceOutbox(tenant.scope).length, 2);
  } finally {
    if (!closed) current.store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('rollback selects retained compatible releases, preserves pinned records and never reuses release sequence numbers', () => {
  const { store, kernel } = setup();
  try {
    const tenant = create(kernel);
    configure(kernel, tenant);
    const first = activate(kernel, tenant).activeRelease!;
    const second = activate(kernel, tenant).activeRelease!;
    const pinned = quote(kernel, tenant, 'before-rollback');
    assert.equal(pinned.runtimeReleaseId, second.id);
    const command = {
      releaseId: first.id,
      expectedActiveReleaseId: second.id,
      idempotencyKey: randomUUID(),
    };
    const rollback = tenantSetupSchema.parse(
      kernel.control.execute('control_rollback', command, alice, tenant.id),
    );
    assert.equal(rollback.activeRelease?.id, first.id);
    assert.equal(quote(kernel, tenant, 'after-rollback').runtimeReleaseId, first.id);
    assert.deepEqual(
      kernel.control.execute('control_rollback', command, alice, tenant.id),
      rollback,
    );
    assert.throws(
      () =>
        kernel.control.execute(
          'control_rollback',
          { ...command, idempotencyKey: randomUUID() },
          alice,
          tenant.id,
        ),
      fail('VERSION_CONFLICT'),
    );
    const third = activate(kernel, tenant).activeRelease!;
    assert.equal(third.version, 3);
    assert.equal(store.insuranceRead(tenant.scope, pinned.id).runtimeReleaseId, second.id);
    const other = create(kernel, bob);
    assert.throws(
      () =>
        kernel.control.execute(
          'control_rollback',
          { releaseId: first.id, expectedActiveReleaseId: third.id, idempotencyKey: randomUUID() },
          bob,
          other.id,
        ),
      fail('VERSION_CONFLICT'),
    );
  } finally {
    store.close();
  }
});

test('only account administrators revoke memberships and fresh in-transaction authorization closes stale context access', () => {
  const { store, kernel } = setup();
  try {
    const tenant = create(kernel);
    const input = {
      accountId: 'account-one',
      actorId: alice.actorId,
      membershipTenantId: tenant.id,
      idempotencyKey: randomUUID(),
    };
    assert.throws(
      () => kernel.control.execute('control_revoke_membership', input, bob),
      fail('FORBIDDEN'),
    );
    assert.throws(
      () => kernel.control.execute('control_revoke_membership', input, outsider),
      fail('FORBIDDEN'),
    );
    kernel.control.execute('control_revoke_membership', input, admin);
    assert.equal(kernel.control.session(alice).accounts.length, 1);
    assert.throws(() => inspect(kernel, tenant), fail('FORBIDDEN'));
    assert.throws(
      () =>
        kernel.control.execute(
          'control_revoke_membership',
          { accountId: 'account-one', actorId: admin.actorId, idempotencyKey: randomUUID() },
          admin,
        ),
      fail('LAST_ADMIN_REQUIRED'),
    );
    const bobTenant = create(kernel, bob);
    const transaction = store.transaction.bind(store);
    let first = true;
    store.transaction = <T>(fn: () => T): T => {
      if (first) {
        first = false;
        store.control.revoke('account-one', bob.actorId);
      }
      return transaction(fn);
    };
    assert.throws(
      () =>
        kernel.executeForPrincipal('configuration_inspect', { view: 'draft' }, bob, bobTenant.id),
      fail('FORBIDDEN'),
    );
  } finally {
    store.close();
  }
});

test('unknown executable capability remains an activation blocker even when its metadata shape is valid', () => {
  const { store, kernel } = setup();
  try {
    const tenant = create(kernel);
    configure(kernel, tenant);
    const draft = snapshotSchema.parse(
      kernel.executeForPrincipal('configuration_inspect', { view: 'draft' }, alice, tenant.id),
    );
    draft.configuration.products[0]!.requiredCapabilities.push('automatic_rating');
    kernel.executeForPrincipal(
      'configuration_update_draft',
      {
        expectedVersion: draft.version,
        configuration: draft.configuration,
        idempotencyKey: randomUUID(),
      },
      alice,
      tenant.id,
    );
    const candidate = inspect(kernel, tenant);
    assert.equal(candidate.candidate.canActivate, false);
    assert.ok(candidate.candidate.blockers.some((b) => b.includes('automatic_rating')));
    assert.throws(() => activate(kernel, tenant, candidate), fail('ACTIVATION_BLOCKED'));
  } finally {
    store.close();
  }
});

test('the approved hosted region blocks contradictory tenant residency at activation', () => {
  const store = new Store(':memory:');
  const kernel = new Kernel(store, [], [], testNow, {
    region: 'westeurope',
    buildSha: 'a'.repeat(40),
  });
  kernel.control.bootstrapAccount(bootstrap);
  try {
    const tenant = tenantRecordSchema.parse(
      (
        kernel.control.execute(
          'control_create_tenant',
          {
            accountId: 'account-one',
            displayName: 'EU hosted sandbox',
            environment: 'sandbox',
            region: 'westeurope',
            idempotencyKey: randomUUID(),
          },
          alice,
        ) as { tenant: unknown }
      ).tenant,
    );
    configure(kernel, tenant);
    const before = inspect(kernel, tenant);
    assert.equal(before.candidate.canActivate, true);
    const snapshot = snapshotSchema.parse(
      kernel.executeForPrincipal('configuration_inspect', { view: 'draft' }, alice, tenant.id),
    );
    snapshot.configuration.tenant!.residency = 'us';
    kernel.executeForPrincipal(
      'configuration_update_draft',
      {
        expectedVersion: snapshot.version,
        configuration: snapshot.configuration,
        idempotencyKey: randomUUID(),
      },
      alice,
      tenant.id,
    );
    const candidate = inspect(kernel, tenant);
    assert.equal(candidate.candidate.canActivate, false);
    assert.ok(candidate.candidate.blockers.some((blocker) => blocker.includes('westeurope (eu)')));
    assert.throws(() => activate(kernel, tenant, candidate), fail('ACTIVATION_BLOCKED'));
    assert.equal(inspect(kernel, tenant).activeRelease, null);
  } finally {
    store.close();
  }
});
