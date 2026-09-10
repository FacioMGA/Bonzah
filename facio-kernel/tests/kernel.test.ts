import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/storage/store.js';
import { Kernel } from '../src/application/kernel.js';
import { operations } from '../src/contracts/operations.js';
import {
  referenceScope,
  referenceConfiguration,
  incompleteScope,
  incompleteConfiguration,
} from '../src/fixtures/reference.js';
import type { Context } from '../src/contracts/configuration.js';
const context = (): Context => ({
  ...referenceScope,
  actorId: 'editor',
  permissions: ['configuration:read', 'configuration:write', 'audit:read'],
  correlationId: randomUUID(),
});
function setup() {
  const store = new Store(':memory:');
  store.seed(referenceScope, referenceConfiguration, referenceConfiguration);
  store.seed(incompleteScope, incompleteConfiguration);
  return { store, kernel: new Kernel(store) };
}

test('draft updates are durable, versioned and never change immutable published configuration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'facio-kernel-'));
  const path = join(dir, 'test.sqlite');
  try {
    let store = new Store(path);
    store.seed(referenceScope, referenceConfiguration, referenceConfiguration);
    const kernel = new Kernel(store);
    const ctx = context();
    const update = structuredClone(referenceConfiguration);
    update.tenant!.displayName = 'Changed draft';
    const result = operations.configuration_update_draft.output.parse(
      kernel.execute(
        'configuration_update_draft',
        { configuration: update, expectedVersion: 1, idempotencyKey: randomUUID() },
        ctx,
      ),
    );
    assert.equal(result.snapshot.version, 2);
    assert.equal(result.diff[0]?.path, '/tenant');
    assert.equal(
      store.read(ctx, 'published').configuration.tenant?.displayName,
      'Reference workspace',
    );
    store.close();
    store = new Store(path);
    assert.equal(store.read(ctx, 'draft').configuration.tenant?.displayName, 'Changed draft');
    store.seed(referenceScope, referenceConfiguration);
    assert.equal(store.read(ctx, 'draft').version, 2);
    store.close();
    const db = new DatabaseSync(path);
    assert.throws(() => db.exec('UPDATE releases SET version=2'), /immutable release/);
    assert.throws(() => db.exec('DELETE FROM audit'), /immutable audit/);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('retry replays one mutation; changed payload and stale versions fail without overwrite', () => {
  const { store, kernel } = setup();
  try {
    const ctx = context();
    const input = {
      configuration: referenceConfiguration,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
    };
    const first = kernel.execute('configuration_update_draft', input, ctx);
    assert.deepEqual(kernel.execute('configuration_update_draft', input, ctx), first);
    assert.throws(
      () => kernel.execute('configuration_update_draft', { ...input, expectedVersion: 2 }, ctx),
      /different input/,
    );
    assert.throws(
      () =>
        kernel.execute(
          'configuration_update_draft',
          { ...input, idempotencyKey: randomUUID() },
          ctx,
        ),
      /draft changed/,
    );
    assert.equal(store.read(ctx, 'draft').version, 2);
  } finally {
    store.close();
  }
});
test('workspace, tenant, environment, operating entity and permissions fail closed', () => {
  const { store, kernel } = setup();
  try {
    const ctx = context();
    for (const override of [
      { workspaceId: 'foreign' },
      { tenantId: 'foreign' },
      { environment: 'uat' as const },
      { operatingEntityId: 'foreign' },
    ])
      assert.throws(
        () => kernel.execute('configuration_inspect', { view: 'draft' }, { ...ctx, ...override }),
        /authorized scope/,
      );
    assert.throws(
      () => kernel.execute('configuration_inspect', { view: 'draft', tenantId: 'incomplete' }, ctx),
      /strict operation/,
    );
    assert.throws(
      () =>
        kernel.execute(
          'configuration_update_draft',
          {
            expectedVersion: 1,
            idempotencyKey: randomUUID(),
            configuration: referenceConfiguration,
          },
          { ...ctx, permissions: ['configuration:read'] },
        ),
      /credential does not grant/,
    );
    const other = { ...ctx, ...incompleteScope };
    assert.equal(store.read(other, 'draft').configuration.tenant, null);
    assert.ok(store.audits(ctx).some((row) => row.outcome === 'FORBIDDEN'));
    assert.ok(store.audits(other).every((row) => row.actorId !== 'foreign'));
  } finally {
    store.close();
  }
});
test('strict contracts reject raw secrets, opaque extension payloads and claimed connection health', () => {
  const { store, kernel } = setup();
  try {
    const ctx = context();
    const base = { expectedVersion: 1, idempotencyKey: randomUUID() };
    assert.throws(
      () =>
        kernel.execute(
          'configuration_update_draft',
          {
            ...base,
            configuration: { ...referenceConfiguration, finance: { formula: 'anything' } },
          },
          ctx,
        ),
      /strict operation/,
    );
    assert.throws(
      () =>
        kernel.execute(
          'configuration_update_draft',
          {
            ...base,
            configuration: {
              ...referenceConfiguration,
              integrations: [
                {
                  id: 'provider',
                  adapterId: 'sample',
                  connectionRef: 'connection://local/provider',
                  connectionStatus: 'unverified',
                  apiKey: 'raw-secret',
                },
              ],
            },
          },
          ctx,
        ),
      /strict operation/,
    );
    assert.throws(
      () =>
        kernel.execute(
          'configuration_update_draft',
          {
            ...base,
            configuration: {
              ...referenceConfiguration,
              integrations: [
                {
                  id: 'provider',
                  adapterId: 'sample',
                  connectionRef: 'connection://local/provider',
                  connectionStatus: 'connected',
                },
              ],
            },
          },
          ctx,
        ),
      /verified by a registered/,
    );
    assert.equal(store.read(ctx, 'draft').version, 1);
  } finally {
    store.close();
  }
});
test('corrupt stored state fails integrity checks without fallback to an empty draft', () => {
  const dir = mkdtempSync(join(tmpdir(), 'facio-integrity-'));
  const path = join(dir, 'test.sqlite');
  try {
    const store = new Store(path);
    store.seed(referenceScope, referenceConfiguration);
    const db = new DatabaseSync(path);
    db.exec("UPDATE drafts SET hash='bad'");
    assert.throws(() => store.read(referenceScope, 'draft'), /integrity check/);
    db.close();
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
