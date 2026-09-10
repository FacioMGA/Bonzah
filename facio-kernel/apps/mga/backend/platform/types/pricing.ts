/**
 * Shared pricing trace primitives.
 *
 * Every product's premium calculator MUST emit a `CalculationTrace` describing the
 * step-by-step derivation of the total. The trace is consumed by:
 *   - BO Premium tab (human-readable explanation)
 *   - PriceCalculationAudit (immutable audit log, one row per rate event)
 *   - BDX reconciliation (every reported premium line references an audit row)
 *
 * `kind` is intentionally broader than motor's original set so every product's
 * rate model fits without losing fidelity.
 */

export type CalculationStepKind =
  | 'rate_base'    // base/reference rate before any modifier
  | 'table_lookup' // lookup in a rate table or matrix
  | 'factor'       // multiplicative factor (discount, loading)
  | 'fee'          // additive fee/charge (windscreen, stamp duty)
  | 'discount'     // explicit negative delta (promotional)
  | 'tax'          // tax/levy line (MIF, stamp duty, IPT)
  | 'subtotal'     // partial running total
  | 'total';       // final payable total

export interface CalculationStep {
  id: string;
  name: string;
  kind: CalculationStepKind;
  inputs?: Record<string, unknown>;
  factor?: number;
  amount?: number;
  output?: number;
  notes?: string;
}

export interface CalculationTrace {
  /** Ordered list of steps; order drives rendering and audit reproducibility. */
  steps: CalculationStep[];
  /**
   * Stable calculator version, bumped whenever pricing logic changes.
   * Format: `${productCode}@${semver}` — e.g. `motor@1.4.2`.
   */
  calculatorVersion: string;
  /**
   * Optional deterministic inputs snapshot — the minimal record the calculator
   * read. When populated, (calculatorVersion + inputs) MUST reproduce the same
   * steps + total if re-run against the same calculator.
   */
  inputs?: Record<string, unknown>;
}
