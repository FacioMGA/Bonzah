import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { allocateFinancials } from '../src/domain/money.js';
import { allocateFinancialsReference } from '../src/domain/money-reference.js';
import { rustMoneyStatus } from '../src/domain/rust-money.js';
import { Store } from '../src/storage/store.js';
import { Kernel } from '../src/application/kernel.js';
import { buildApp } from '../src/server/app.js';
import { moneyCases } from './fixtures/rust-money.js';
import { referenceScope } from '../src/fixtures/reference.js';

test('canonical allocator uses the required Rust engine and health identifies the loaded artifact', async () => {
  for (const value of moneyCases(500))
    assert.deepEqual(allocateFinancials(value), allocateFinancialsReference(value));
  const store = new Store(':memory:');
  const app = buildApp({
    kernel: new Kernel(store),
    credentials: [
      {
        token: 'synthetic-health-test-only-token-0000',
        context: { ...referenceScope, actorId: 'test-editor', permissions: ['configuration:read'] },
      },
    ],
  });
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { host: 'localhost' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().moneyEngine, rustMoneyStatus());
    assert.equal(response.json().moneyEngine.engine, 'rust-wasm');
    assert.equal(response.json().moneyEngine.calculationVersion, 'exact-money-v1');
  } finally {
    await app.close();
    store.close();
  }
});

test('hosted startup without the required Rust artifact fails before creating either database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kernel-rust-startup-'));
  const require = createRequire(import.meta.url);
  try {
    const child = spawnSync(
      process.execPath,
      ['--import', require.resolve('tsx'), resolve('src/hosted.ts')],
      {
        cwd: directory,
        encoding: 'utf8',
        timeout: 20_000,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'production',
          KERNEL_PUBLIC_URL: 'https://sandbox.invalid',
          KERNEL_REGION: 'westeurope',
          KERNEL_BUILD_SHA: '1'.repeat(40),
          KERNEL_DB_PATH: join(directory, 'kernel.sqlite'),
          KERNEL_AUTH_DB_PATH: join(directory, 'auth.sqlite'),
          KERNEL_BOOTSTRAP_FILE: join(directory, 'bootstrap.json'),
          KERNEL_GOOGLE_CLIENT_ID: 'synthetic-only',
          KERNEL_GOOGLE_CLIENT_SECRET: 'synthetic-only',
        },
      },
    );
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /RUST_MONEY_UNAVAILABLE/);
    assert.equal(existsSync(join(directory, 'kernel.sqlite')), false);
    assert.equal(existsSync(join(directory, 'auth.sqlite')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
