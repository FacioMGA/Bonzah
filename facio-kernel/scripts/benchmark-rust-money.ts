import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { createRustMoneyEngine } from '../src/domain/rust-money.js';
import { allocateFinancialsReference } from '../src/domain/money-reference.js';
import {
  financialAllocationInputSchema,
  type FinancialAllocationInput,
  type FinancialAllocationResult,
} from '../src/contracts/money.js';
import { moneyCases } from '../tests/fixtures/rust-money.js';
import { hash } from '../src/domain/canonical.js';

// This deliberately optimized TS control uses the same validation/sort/output shape as the Rust
// bridge, without the legacy allocator's object spreading or redundant output string validation.
// It prevents attributing surrounding TS improvements solely to Rust arithmetic.
export function optimizedTypeScriptAllocation(
  input: FinancialAllocationInput,
): FinancialAllocationResult {
  const value = financialAllocationInputSchema.parse(input);
  const participants = [...value.participants].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const premium = BigInt(value.premiumMinor),
    sign = premium < 0n ? -1n : 1n,
    magnitude = premium * sign;
  const amounts: bigint[] = [],
    remainders: bigint[] = [];
  let total = 0n;
  for (const participant of participants) {
    const numerator = magnitude * BigInt(participant.shareBps);
    const amount = numerator / 10000n;
    amounts.push(amount);
    total += amount;
    remainders.push(numerator % 10000n);
  }
  let remaining = magnitude - total;
  if (remaining) {
    const order = amounts
      .map((_, i) => i)
      .sort((a, b) =>
        remainders[a] === remainders[b] ? a - b : remainders[a]! > remainders[b]! ? -1 : 1,
      );
    for (const i of order) {
      if (!remaining) break;
      amounts[i] = amounts[i]! + 1n;
      remaining--;
    }
  }
  const numerator = magnitude * BigInt(value.commission.rateBps);
  const commission = (numerator / 10000n + ((numerator % 10000n) * 2n >= 10000n ? 1n : 0n)) * sign;
  return {
    currency: value.currency,
    premiumMinor: value.premiumMinor,
    allocations: participants.map((p, i) => ({
      participantId: p.id,
      role: p.role,
      shareBps: p.shareBps,
      premiumMinor: (amounts[i]! * sign).toString(),
    })),
    commission: { ...value.commission, amountMinor: commission.toString() },
    calculationVersion: 'exact-money-v1',
    rounding: 'half-away-from-zero',
    allocationMethod: 'largest-remainder-id-order',
  };
}
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
if (process.argv[2] === '--worker') {
  const name = process.argv[3]!,
    participantCount = Number(process.argv[4]);
  const rust = name === 'rust' ? createRustMoneyEngine() : null;
  const operation =
    name === 'reference'
      ? allocateFinancialsReference
      : name === 'optimized'
        ? optimizedTypeScriptAllocation
        : rust!.allocateFinancials;
  const inputs = moneyCases(256, participantCount);
  const calls = Math.max(10000, Math.floor(750000 / participantCount));
  for (let i = 0; i < 50000; i++) operation(inputs[i % inputs.length]!);
  const rounds = [];
  let checksum = 0;
  global.gc?.();
  const measuredCpu = process.cpuUsage();
  const measuredStart = performance.now();
  for (let round = 0; round < 7; round++) {
    const cpu = process.cpuUsage(),
      start = performance.now();
    for (let i = 0; i < calls; i++) {
      const result = operation(inputs[i % inputs.length]!);
      checksum += result.commission.amountMinor.length + result.allocations[0]!.premiumMinor.length;
    }
    const wallMs = performance.now() - start,
      used = process.cpuUsage(cpu);
    rounds.push({ wallMs, cpuMs: (used.user + used.system) / 1000 });
  }
  global.gc?.();
  const totalCpu = process.cpuUsage(measuredCpu);
  const totalWallMs = performance.now() - measuredStart;
  const wallMs = median(rounds.map((r) => r.wallMs)),
    cpuMs = median(rounds.map((r) => r.cpuMs));
  console.log(
    JSON.stringify({
      engine: name,
      participantCount,
      callsPerRound: calls,
      rounds,
      medianWallMs: wallMs,
      medianCpuMs: cpuMs,
      operationsPerSecond: (calls / wallMs) * 1000,
      cpuMicrosecondsPerCall: (cpuMs / calls) * 1000,
      amortizedCpuMicrosecondsPerCall: (totalCpu.user + totalCpu.system) / (calls * 7),
      totalMeasuredWallMs: totalWallMs,
      maxRssKiB: process.resourceUsage().maxRSS,
      endingMemory: process.memoryUsage(),
      checksum,
      module: rust?.status ?? null,
    }),
  );
} else {
  const rust = createRustMoneyEngine();
  let cases = 0;
  for (const input of moneyCases(12000)) {
    const expected = hash(allocateFinancialsReference(input));
    if (
      hash(rust.allocateFinancials(input)) !== expected ||
      hash(optimizedTypeScriptAllocation(input)) !== expected
    )
      throw new Error('Parity failure: benchmark must not compare different behavior');
    cases++;
  }
  const results: Array<{
    engine: string;
    participantCount: number;
    medianWallMs: number;
    medianCpuMs: number;
    amortizedCpuMicrosecondsPerCall: number;
    [key: string]: unknown;
  }> = [];
  for (const n of [1, 4, 10, 100])
    for (const engine of ['optimized', 'rust', 'reference']) {
      const child = spawnSync(
        process.execPath,
        ['--expose-gc', '--import', 'tsx', import.meta.filename, '--worker', engine, String(n)],
        { encoding: 'utf8', maxBuffer: 1024 * 1024 },
      );
      if (child.status !== 0) throw new Error('Isolated benchmark failed: ' + child.stderr);
      results.push(JSON.parse(child.stdout));
    }
  const comparisons = [1, 4, 10, 100].map((participants) => {
    const rust = results.find((r) => r.participantCount === participants && r.engine === 'rust');
    const reference = results.find(
      (r) => r.participantCount === participants && r.engine === 'reference',
    );
    const optimized = results.find(
      (r) => r.participantCount === participants && r.engine === 'optimized',
    );
    if (!rust || !reference || !optimized) throw new Error('Missing benchmark result');
    return {
      participants,
      rustVersusRetainedTs: reference.medianWallMs / rust.medianWallMs,
      rustVersusOptimizedTs: optimized.medianWallMs / rust.medianWallMs,
      cpuReductionVsOptimizedPercent: (1 - rust.medianCpuMs / optimized.medianCpuMs) * 100,
      amortizedCpuReductionVsOptimizedPercent:
        (1 - rust.amortizedCpuMicrosecondsPerCall / optimized.amortizedCpuMicrosecondsPerCall) *
        100,
      amortizedCpuReductionVsRetainedPercent:
        (1 - rust.amortizedCpuMicrosecondsPerCall / reference.amortizedCpuMicrosecondsPerCall) *
        100,
    };
  });
  const report = {
    schemaVersion: 'rust-money-benchmark-v1',
    capturedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    parityCases: cases,
    module: rust.status,
    scope:
      'Full allocation function: strict schema validation, stable-ID sorting, JS/WASM memory copies and BigInt ABI, exact arithmetic, result assembly. Excludes HTTP/database/insurance persistence and billable cloud cost.',
    method:
      'Separate Node22 process for each engine/workload; 50000 warmups, 7 consecutive measured rounds; full GC before all measured work and after the final round. Amortized CPU includes final GC; median round metrics include normal in-loop GC. Fixed deterministic inputs. Peak RSS includes process/JIT baseline and is not per-operation memory.',
    results,
    comparisons,
  };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/rust-money-benchmark.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ parityCases: cases, module: rust.status, comparisons }, null, 2));
}
