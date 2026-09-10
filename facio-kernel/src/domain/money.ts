import type { FinancialAllocationInput, FinancialAllocationResult } from '../contracts/money.js';
import { allocateFinancialsRust } from './rust-money.js';

/** Required Rust execution; the strict shared input/output contract remains exact-money-v1. */
export function allocateFinancials(input: FinancialAllocationInput): FinancialAllocationResult {
  return allocateFinancialsRust(input);
}
