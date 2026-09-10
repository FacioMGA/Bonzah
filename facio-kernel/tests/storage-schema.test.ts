import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/storage/store.js';
import { AuthStore, digest } from '../src/storage/auth-store.js';
import { approvalFixture } from './fixtures/approval.js';
import { KernelError } from '../src/domain/canonical.js';

for (const [label, table, futureVersion, open] of [
  ['kernel', 'schema_migrations', 8, (path: string) => new Store(path)],
  ['auth', 'auth_schema_migrations', 2, (path: string) => new AuthStore(path)],
] as const) {
  test(`${label} startup rejects a future schema before changing database bytes, tables or journal mode`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kernel-future-schema-'));
    const path = join(dir, 'future.sqlite');
    try {
      const future = new DatabaseSync(path);
      future.exec(
        `CREATE TABLE ${table}(version INTEGER PRIMARY KEY); INSERT INTO ${table} VALUES(${futureVersion}); CREATE TABLE future_customer_data(value TEXT NOT NULL); INSERT INTO future_customer_data VALUES('retained synthetic data');`,
      );
      future.close();
      const before = await readFile(path);
      const files = await readdir(dir);
      assert.throws(
        () => open(path),
        (error) => error instanceof KernelError && error.code === 'STORAGE_SCHEMA_TOO_NEW',
      );
      assert.deepEqual(await readFile(path), before);
      assert.deepEqual(await readdir(dir), files);
      const recovery = new DatabaseSync(path);
      try {
        assert.equal(recovery.prepare('PRAGMA journal_mode').get()!.journal_mode, 'delete');
        assert.equal(
          recovery.prepare('SELECT value FROM future_customer_data').get()!.value,
          'retained synthetic data',
        );
        assert.equal(
          recovery.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table'").get()!
            .count,
          2,
        );
        // A failed constructor releases its handle and leaves no transaction blocking recovery.
        recovery.exec("INSERT INTO future_customer_data VALUES('recovery remains available')");
      } finally {
        recovery.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test('the auth version-one marker upgrades the existing unversioned layout without changing retained entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kernel-auth-schema-'));
  const path = join(dir, 'auth.sqlite');
  try {
    const old = new DatabaseSync(path);
    old.exec(
      'CREATE TABLE auth_entries(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(kind,id));CREATE TABLE auth_grants(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,client_id TEXT NOT NULL,expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);',
    );
    old
      .prepare('INSERT INTO auth_entries VALUES(?,?,?,?,0)')
      .run(
        'session',
        digest('synthetic-retained-token'),
        JSON.stringify({ value: 'retained' }),
        Date.now() + 60000,
      );
    old.close();
    const upgraded = new AuthStore(path);
    try {
      assert.deepEqual(upgraded.read('session', 'synthetic-retained-token'), { value: 'retained' });
    } finally {
      upgraded.close();
    }
    const inspect = new DatabaseSync(path);
    try {
      assert.equal(
        inspect.prepare('SELECT MAX(version) AS version FROM auth_schema_migrations').get()!
          .version,
        1,
      );
    } finally {
      inspect.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const previousVersion of [5, 6])
  test(`synthetic schema-${previousVersion} layout upgrades additively without rewriting retained evidence`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kernel-schema-five-'));
    const path = join(dir, 'kernel.sqlite');
    const f = approvalFixture(path);
    const record = f.create();
    const history = f.store.insuranceHistory(f.context, record.id);
    if (previousVersion === 6) f.request(record);
    f.store.close();
    const old = new DatabaseSync(path);
    let tableSnapshots: { name: string; rows: unknown[] }[] = [];
    try {
      // Remove only this additive migration to reconstruct the pre-migration layout.
      old.exec('PRAGMA foreign_keys=OFF');
      const added = old
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'finance_%' OR name LIKE 'document_%' OR name LIKE 'fnol_%' OR name = 'insurance_renewal_identities' ${previousVersion === 5 ? "OR name LIKE 'approval_%' OR name LIKE 'provider_%'" : ''})`,
        )
        .all() as { name: string }[];
      for (const { name } of added) {
        assert.match(name, /^[a-z_]+$/);
        assert.equal(old.prepare(`SELECT count(*) AS count FROM "${name}"`).get()!.count, 0);
        old.exec(`DROP TABLE "${name}"`);
      }
      old.exec(`DELETE FROM schema_migrations WHERE version > ${previousVersion}`);
      assert.equal(
        old.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version,
        previousVersion,
      );
      const retained = old
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name != 'schema_migrations' ORDER BY name",
        )
        .all() as { name: string }[];
      tableSnapshots = retained.map(({ name }) => {
        assert.match(name, /^[a-z_]+$/);
        return { name, rows: old.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all() };
      });
    } finally {
      old.close();
    }
    const upgraded = new Store(path);
    try {
      assert.deepEqual(upgraded.insuranceRead(f.context, record.id), record);
      assert.deepEqual(upgraded.insuranceHistory(f.context, record.id), history);
    } finally {
      upgraded.close();
    }
    const inspect = new DatabaseSync(path);
    try {
      assert.equal(
        inspect.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version,
        7,
      );
      for (const { name, rows } of tableSnapshots)
        assert.deepEqual(
          inspect.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
          rows,
          name,
        );
      assert.equal(inspect.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
    } finally {
      inspect.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
