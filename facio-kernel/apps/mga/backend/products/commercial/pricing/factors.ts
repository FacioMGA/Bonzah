/** Adapted from Symphony 74499802ee76869c923c2227a18883d06eeb7b4b:symphony-api/src/services/premiumCalculator.ts.
 * Pure source algorithm split by function boundary; tenant values are caller-supplied. */
import type { CoverageCalculation, CalcInput, CalcReason, TurnoverBandRow, LoadingExtensionRow, CalculationAuditStep, ILFSumRow, ILFExcessRow, CalcOutput } from './types.js';
import { parseFactor, parsePercentFactor, parseTurnoverRange, parseAmount, applyAuditedOperation, applyAuditedMinimum } from './primitives.js';

export function resolveBaseRate(
  calc: CoverageCalculation,
  input: CalcInput,
  /** When the calc bag was resolved via a shared / primary-coverage
   *  fallback (see `resolveCoverageCalc`), the coverage's own risk code
   *  may not be a row in the shared table. In that case, as long as the
   *  coverage HAS a (numeric) risk code, apply the shared table's first
   *  row so every coverage prices off the single configured rule. A
   *  coverage with no risk code (e.g. PI marked DECLINE/REFER) still
   *  refers to $0. */
  lenient = false,
  rateSemantics: 'percentage' | 'multiplier' = 'percentage',
): { rate: number | null; reason: CalcReason; source: 'flat' | 'legacy' } {
  // Prefer the flat schema when populated.
  const flat = calc.riskCodeTable ?? []
  if (flat.length > 0) {
    const row =
      flat.find((r) => r.code === input.riskCode) ??
      (lenient && input.riskCode !== null ? flat[0] : undefined)
    if (!row) {
      const reason: CalcReason =
        input.riskCode === null ? 'no-risk-code' : 'no-matrix'
      return { rate: null, reason, source: 'flat' }
    }
    // A turnover basis uses a percentage ("1.2" -> 0.012). When the Base
    // Premium source is Coverage / Premium, the same configured cell is a
    // direct multiplier ("1.2" -> 1.2). Explicit percent signs remain
    // explicit, so legacy values such as "1.2%" still resolve to 0.012.
    const rate =
      rateSemantics === 'multiplier'
        ? parseFactor(row.baseRate)
        : parsePercentFactor(row.baseRate)
    if (rate === null) {
      return { rate: null, reason: 'no-matrix', source: 'flat' }
    }
    return { rate, reason: 'ok', source: 'flat' }
  }

  // Legacy 2D matrix path. Walk every version (newest last); first
  // matching (risk code × turnover range) cell wins.
  const matrix = calc.basePremiumMatrix ?? []
  for (let i = matrix.length - 1; i >= 0; i--) {
    const version = matrix[i]
    if (!version) continue
    for (const row of version.rows) {
      if (row.riskCode !== input.riskCode) continue
      const range = parseTurnoverRange(row.turnoverRange)
      if (!range) continue
      if (input.turnover >= range.lower && input.turnover < range.upper) {
        const cell = parseFactor(row.rate)
        if (cell !== null) return { rate: cell, reason: 'ok', source: 'legacy' }
      }
    }
  }
  const reason: CalcReason =
    input.riskCode === null ? 'no-risk-code' : 'no-matrix'
  return { rate: null, reason, source: 'legacy' }
}

export function lookupTurnoverBandMultiplier(
  bands: TurnoverBandRow[],
  turnover: number,
): number | null {
  for (const band of bands) {
    const from = parseAmount(band.from)
    if (from === null) continue
    const toRaw = band.to
    const to =
      toRaw === undefined || toRaw === null || String(toRaw).trim() === ''
        ? Number.POSITIVE_INFINITY
        : parseAmount(toRaw)
    if (to === null) continue
    if (turnover >= from && turnover < to) {
      return parseFactor(band.multiplier)
    }
  }
  return null
}

export function applyLoadings(
  premium: number,
  rules: LoadingExtensionRow[],
  slot: 'before-min-premium' | 'after-base-premium' | 'after-all-rules',
  answers: Record<string, unknown> | undefined,
  auditTrail?: CalculationAuditStep[],
): number {
  if (rules.length === 0) return premium
  let out = premium
  for (const rule of rules) {
    const ruleSlot = rule.applyTiming ?? 'after-base-premium'
    if (ruleSlot !== slot) continue
    const fires = rule.appliedAlways
      ? true
      : !!(
          rule.questionnaireKey &&
          answers &&
          isTruthyAnswer(answers[rule.questionnaireKey])
        )
    if (!fires) continue
    const factor = parseFactor(rule.factor)
    if (factor === null || !Number.isFinite(factor)) throw new Error(`Loading ${rule.name || rule.id} requires a valid factor.`)
    if (auditTrail) {
      out = applyAuditedOperation({
        current: out,
        operand: factor,
        operation: 'multiply',
        key: 'loading',
        label: rule.name?.trim() || 'Loading / extension',
        source: rule.appliedAlways
          ? 'always-applied'
          : `questionnaire:${rule.questionnaireKey ?? 'unresolved'}`,
        timing: slot,
        auditTrail,
      })
    } else {
      out *= factor
    }
  }
  return out
}

export function isTruthyAnswer(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === '' || v === 'no' || v === 'false' || v === '0') return false
    return true
  }
  return value !== null && value !== undefined
}

export function lookupIlfFactor(
  rows: Array<ILFSumRow | ILFExcessRow>,
  key: 'coverageLimit' | 'deductible',
  needle: number | null | undefined,
  coverage: string,
): number | null {
  if (needle === null || needle === undefined) return null
  for (const row of rows) {
    const r = row as ILFSumRow & ILFExcessRow
    const raw =
      key === 'coverageLimit' ? r.coverageLimit : r.deductible
    const value = parseAmount(raw)
    if (value === null) continue
    if (Math.abs(value - needle) <= 0.5) {
      if (typeof r.factor !== 'undefined') return parseFactor(r.factor)
      const perCov = r.factorsByCoverage?.[coverage]
      if (perCov !== undefined) return parseFactor(perCov)
    }
  }
  return null
}

export function resolveFloor(
  calc: CoverageCalculation | null,
  riskCode: string | null,
): number {
  if (!calc) return 0
  const perRisk =
    calc.riskCodeDiscounts?.find((r) => r.riskCode === riskCode)?.floor
  const perRiskAmount = perRisk !== undefined ? parseAmount(perRisk) : null
  const configuredFloor = perRiskAmount !== null && perRiskAmount > 0 ? perRiskAmount : calc.minimumPremiumFloor ?? 0
  const tableMinimum = calc.riskCodeTable?.find((row) => row.code === riskCode)?.minimumPremium
  const tableFloor = tableMinimum !== undefined ? parseAmount(tableMinimum) : null
  if (tableMinimum !== undefined && tableFloor === null) throw new Error(`Risk ${riskCode} requires a valid minimum premium.`)
  return Math.max(configuredFloor, tableFloor ?? 0)
}

export function floorOnly(
  base: number,
  calc: CoverageCalculation | null,
  riskCode: string | null,
  reason: CalcReason,
): CalcOutput {
  const floor = resolveFloor(calc, riskCode)
  const enforce = !!calc?.enforceMinimumPremium
  const auditTrail: CalculationAuditStep[] = []
  const selected =
    enforce && floor > 0
      ? applyAuditedMinimum({
          current: base,
          floor,
          source: `fallback-floor:${reason}`,
          auditTrail,
        })
      : null
  return {
    basePremium: null,
    selectedPremium: selected,
    floorApplied: enforce && floor > 0,
    bundleSplit: null,
    reason,
    breakdown: {
      baseRate: null,
      turnoverBandFactor: null,
      ilfSumFactor: null,
      ilfExcessFactor: null,
      floor,
      initialPremium: null,
      auditTrail,
    },
  }
}
