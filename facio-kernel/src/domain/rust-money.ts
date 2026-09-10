import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  financialAllocationInputSchema,
  type FinancialAllocationInput,
  type FinancialAllocationResult,
} from '../contracts/money.js';
import { KernelError } from './canonical.js';

const manifestSchema = z.strictObject({
  engine: z.literal('rust-wasm'),
  engineVersion: z.literal('1.0.0'),
  abiVersion: z.literal(1),
  calculationVersion: z.literal('exact-money-v1'),
  compiler: z.string().startsWith('rustc 1.97.1 '),
  target: z.literal('wasm32-unknown-unknown'),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  wasmSha256: z.string().regex(/^[a-f0-9]{64}$/),
  wasmBytes: z.number().int().positive(),
  memoryBytes: z.literal(131072),
});
export type RustMoneyStatus = z.infer<typeof manifestSchema>;
type WasmMoneyExports = {
  memory: WebAssembly.Memory;
  abi_version: () => number;
  shares_ptr: () => number;
  amounts_ptr: () => number;
  commission_ptr: () => number;
  allocate: (premium: bigint, rate: number, count: number) => number;
};
const invalid = (message: string): never => {
  throw new KernelError('INVALID_FINANCIAL_ALLOCATION', message, 422);
};
function moduleFailure(): never {
  throw new KernelError(
    'RUST_MONEY_UNAVAILABLE',
    'The required exact-money Rust module is missing, invalid or incompatible',
    500,
  );
}

/** No implicit fallback. Missing/corrupt artifacts or an ABI failure are fatal to this engine. */
export function createRustMoneyEngine(directory = resolve(process.cwd(), 'rust')) {
  let exports: WasmMoneyExports, manifest: RustMoneyStatus;
  try {
    manifest = manifestSchema.parse(
      JSON.parse(readFileSync(resolve(directory, 'money.manifest.json'), 'utf8')),
    );
    const bytes = readFileSync(resolve(directory, 'money.wasm'));
    if (
      bytes.length !== manifest.wasmBytes ||
      createHash('sha256').update(bytes).digest('hex') !== manifest.wasmSha256
    )
      moduleFailure();
    const module = new WebAssembly.Module(bytes);
    if (WebAssembly.Module.imports(module).length) moduleFailure();
    exports = new WebAssembly.Instance(module, {}).exports as unknown as WasmMoneyExports;
    if (
      !(exports.memory instanceof WebAssembly.Memory) ||
      exports.memory.buffer.byteLength !== manifest.memoryBytes ||
      typeof exports.abi_version !== 'function' ||
      exports.abi_version() !== 1 ||
      typeof exports.allocate !== 'function'
    )
      moduleFailure();
  } catch {
    moduleFailure();
  }
  const memory = exports.memory;
  let input: Uint32Array, output: BigInt64Array, commission: BigInt64Array;
  try {
    input = new Uint32Array(memory.buffer, exports.shares_ptr(), 100);
    output = new BigInt64Array(memory.buffer, exports.amounts_ptr(), 100);
    commission = new BigInt64Array(memory.buffer, exports.commission_ptr(), 1);
  } catch {
    moduleFailure();
  }
  let busy = false;
  function calculate(
    premium: bigint,
    shares: readonly number[],
    rate: number,
  ): { allocations: bigint[]; commission: bigint } {
    // Validate before the ABI conversion: i64/i32 conversions otherwise wrap out-of-range values.
    if (
      typeof premium !== 'bigint' ||
      premium > 999999999999999999n ||
      premium < -999999999999999999n ||
      !Array.isArray(shares) ||
      shares.length < 1 ||
      shares.length > 100 ||
      !Number.isInteger(rate) ||
      rate < 0 ||
      rate > 10000 ||
      shares.some((value) => !Number.isInteger(value) || value < 1 || value > 10000)
    )
      invalid('Invalid exact-money Rust boundary input');
    runValidated(premium, shares, rate);
    return {
      allocations: Array.from(output.subarray(0, shares.length)),
      commission: commission[0]!,
    };
  }
  /** Private: caller has already passed the strict shared schema or the direct ABI guard. */
  function runValidated(premium: bigint, shares: readonly number[], rate: number): void {
    if (busy) moduleFailure();
    busy = true;
    try {
      input.set(shares);
      const code = exports.allocate(premium, rate, shares.length);
      if (code !== 0) invalid('Invalid exact-money Rust boundary input');
    } catch (error) {
      if (error instanceof KernelError) throw error;
      moduleFailure();
    } finally {
      busy = false;
    }
  }
  function allocateFinancials(input: FinancialAllocationInput): FinancialAllocationResult {
    const parsed = financialAllocationInputSchema.safeParse(input);
    if (!parsed.success)
      throw new KernelError(
        'INVALID_FINANCIAL_ALLOCATION',
        'Invalid financial allocation: ' +
          parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        422,
      );
    const value = parsed.data;
    const participants = [...value.participants].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    runValidated(
      BigInt(value.premiumMinor),
      participants.map((p) => p.shareBps),
      value.commission.rateBps,
    );
    return {
      currency: value.currency,
      premiumMinor: value.premiumMinor,
      allocations: participants.map((p, index) => ({
        participantId: p.id,
        role: p.role,
        shareBps: p.shareBps,
        premiumMinor: output[index]!.toString(),
      })),
      commission: { ...value.commission, amountMinor: commission[0]!.toString() },
      calculationVersion: 'exact-money-v1',
      rounding: 'half-away-from-zero',
      allocationMethod: 'largest-remainder-id-order',
    };
  }
  // Startup proves the signed i64 ABI, residual ties and half-away commission before any use.
  const probe = calculate(-1n, [5000, 5000], 5000);
  if (probe.allocations[0] !== -1n || probe.allocations[1] !== 0n || probe.commission !== -1n)
    moduleFailure();
  return { allocateFinancials, calculate, status: Object.freeze({ ...manifest }) };
}
let singleton: ReturnType<typeof createRustMoneyEngine> | undefined;
export function initializeRustMoney(directory?: string): RustMoneyStatus {
  if (!singleton) singleton = createRustMoneyEngine(directory);
  return singleton.status;
}
export function rustMoneyStatus(): RustMoneyStatus {
  return initializeRustMoney();
}
export function allocateFinancialsRust(input: FinancialAllocationInput): FinancialAllocationResult {
  initializeRustMoney();
  return singleton!.allocateFinancials(input);
}
