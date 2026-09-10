import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRustMoneyEngine } from '../src/domain/rust-money.js';
import { allocateFinancialsReference } from '../src/domain/money-reference.js';
import {
  financialAllocationResultSchema,
  type FinancialAllocationInput,
} from '../src/contracts/money.js';
import { KernelError, hash } from '../src/domain/canonical.js';
import { moneyCases } from './fixtures/rust-money.js';

const engine = createRustMoneyEngine();
test('Rust exact-money-v1 matches every field and hash across 12000 deterministic synthetic cases', () => {
  for (const input of moneyCases(12000)) {
    const reference = allocateFinancialsReference(input);
    const actual = engine.allocateFinancials(input);
    assert.deepEqual(actual, reference);
    assert.equal(hash(actual), hash(reference));
    assert.equal(
      actual.allocations.reduce((sum, p) => sum + BigInt(p.premiumMinor), 0n),
      BigInt(input.premiumMinor),
    );
    assert.equal(financialAllocationResultSchema.safeParse(actual).success, true);
  }
});
test('source illustrative split, deterministic ties, currencies, signed mirrors and half rounding retain exact behavior', () => {
  const base = moneyCases(1, 4)[0]!;
  base.commission.rateBps = 750;
  base.participants = [
    { id: 'a', role: 'lead', shareBps: 5000 },
    { id: 'b', role: 'follow', shareBps: 1000 },
    { id: 'c', role: 'follow', shareBps: 1500 },
    { id: 'd', role: 'follow', shareBps: 2500 },
  ];
  for (const premiumMinor of ['50000000', '10000000', '-50000000', '-10000000', '0']) {
    base.premiumMinor = premiumMinor;
    const value = engine.allocateFinancials(base);
    assert.deepEqual(value, allocateFinancialsReference(base));
    if (premiumMinor === '50000000') {
      assert.deepEqual(
        value.allocations.map((p) => p.premiumMinor),
        ['25000000', '5000000', '7500000', '12500000'],
      );
      assert.equal(value.commission.amountMinor, '3750000');
    }
    assert.deepEqual(
      value,
      engine.allocateFinancials({ ...base, participants: [...base.participants].reverse() }),
    );
  }
  for (const magnitude of [1n, 3n, 999999999999999999n]) {
    const positive = engine.calculate(magnitude, [5000, 5000], 5000);
    const negative = engine.calculate(-magnitude, [5000, 5000], 5000);
    assert.deepEqual(
      negative.allocations,
      positive.allocations.map((p) => -p),
    );
    assert.equal(negative.commission, -positive.commission);
  }
  assert.deepEqual(engine.calculate(1n, [5000, 5000], 5000), {
    allocations: [1n, 0n],
    commission: 1n,
  });
});
test('canonical invalid inputs reject with the same error code, status and message before any integer wrapping', () => {
  const base = moneyCases(1, 2)[0]!;
  const invalid: unknown[] = [
    null,
    {},
    { ...base, currency: 'ZZZ' },
    ...['-0', '01', '1.00', '+1', '1e4', ' 1', '1000000000000000000', '-1000000000000000000'].map(
      (p) => ({ ...base, premiumMinor: p }),
    ),
    { ...base, premiumMinor: 1 },
    { ...base, commission: { ...base.commission, rateBps: 0.5 } },
    { ...base, participants: [] },
    { ...base, participants: [{ id: 'a', role: 'follow', shareBps: 10000 }] },
    {
      ...base,
      participants: [
        { id: 'a', role: 'lead', shareBps: 5000 },
        { id: 'a', role: 'follow', shareBps: 5000 },
      ],
    },
    { ...base, participants: [{ id: 'a', role: 'lead', shareBps: 9999 }] },
    { ...base, participants: [{ id: 'a', role: 'lead', shareBps: 10001 }] },
  ];
  const failure = (operation: () => unknown) => {
    try {
      operation();
      assert.fail('Expected rejection');
    } catch (error) {
      assert.ok(error instanceof KernelError);
      return { code: error.code, status: error.status, message: error.message };
    }
  };
  for (const input of invalid)
    assert.deepEqual(
      failure(() => engine.allocateFinancials(input as FinancialAllocationInput)),
      failure(() => allocateFinancialsReference(input as FinancialAllocationInput)),
    );
  for (const [premium, shares, rate] of [
    [1n, [], 0],
    [1n, [5000, 5000], 10001],
    [1n, [0, 10000], 0],
    [1n, [5000, 4999], 0],
    [1n, [10000.5], 0],
    [1n, [10000], 2 ** 32],
    [2n ** 64n, [10000], 0],
    [-(2n ** 63n), [10000], 0],
    [1000000000000000000n, [10000], 0],
  ] as [bigint, number[], number][]) {
    assert.throws(
      () => engine.calculate(premium, shares, rate),
      (e) =>
        e instanceof KernelError && e.code === 'INVALID_FINANCIAL_ALLOCATION' && e.status === 422,
    );
  }
});
test('required Rust artifact is fixed-memory, has a content fingerprint, and fails closed on missing or mismatched bytes', () => {
  assert.equal(engine.status.memoryBytes, 131072);
  assert.match(engine.status.wasmSha256, /^[a-f0-9]{64}$/);
  const dir = mkdtempSync(join(tmpdir(), 'rust-money-'));
  try {
    assert.throws(
      () => createRustMoneyEngine(dir),
      (e) => e instanceof KernelError && e.code === 'RUST_MONEY_UNAVAILABLE',
    );
    copyFileSync('rust/money.manifest.json', join(dir, 'money.manifest.json'));
    const bytes = readFileSync('rust/money.wasm');
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    writeFileSync(join(dir, 'money.wasm'), bytes);
    assert.throws(
      () => createRustMoneyEngine(dir),
      (e) => e instanceof KernelError && e.code === 'RUST_MONEY_UNAVAILABLE',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
