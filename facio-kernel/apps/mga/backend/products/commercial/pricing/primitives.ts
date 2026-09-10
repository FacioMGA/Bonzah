/** Adapted from Symphony 74499802ee76869c923c2227a18883d06eeb7b4b:symphony-api/src/services/premiumCalculator.ts.
 * Pure source algorithm split by function boundary; tenant values are caller-supplied. */
import type { PricingOperation, CalculationAuditStep, SourceTargetBlock, PricingTiming, CalcInput, BinderDetailsLike, CalcOutput, FullCalcPrimitive, CoverageCalculation } from './types.js';
import { convertCurrencyAmount, findProposalQuestionBySourceObject, questionSourceCurrency, normalizeCurrencyCode } from './sourceCurrency.js';

export function parseTurnoverRange(
  raw: string,
): { lower: number; upper: number } | null {
  if (!raw) return null
  const normalized = raw
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, '')
    .toLowerCase()
  if (normalized.endsWith('+')) {
    const lower = parseAmount(normalized.slice(0, -1))
    if (lower === null) return null
    return { lower, upper: Number.POSITIVE_INFINITY }
  }
  const parts = normalized.split('-')
  if (parts.length !== 2) return null
  const lower = parseAmount(parts[0])
  const upper = parseAmount(parts[1])
  if (lower === null || upper === null) return null
  return { lower, upper }
}

export function parseAmount(raw: string | number | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (raw === undefined) return null
  const trimmed = String(raw).trim().toLowerCase().replace(/[$,\s]/g, '')
  if (!trimmed) return null
  const match = trimmed.match(/^(-?\d*\.?\d+)([kmb]?)$/)
  if (!match) {
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  const suffix = match[2]
  const multiplier =
    suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : suffix === 'b' ? 1e9 : 1
  return value * multiplier
}

export function parseFactor(
  raw: string | number | undefined,
): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (raw === undefined) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null
  if (trimmed.endsWith('%')) {
    const n = Number(trimmed.slice(0, -1))
    return Number.isFinite(n) ? n / 100 : null
  }
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export function parsePercentFactor(
  raw: string | number | undefined,
): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw / 100 : null
  if (raw === undefined) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null
  const body = trimmed.endsWith('%') ? trimmed.slice(0, -1) : trimmed
  const n = Number(body)
  return Number.isFinite(n) ? n / 100 : null
}

export function applyOperation(
  current: number,
  operand: number,
  operation: PricingOperation | undefined,
): number {
  switch (operation) {
    case 'add':
      return current + operand
    case 'subtract':
      return current - operand
    case 'set':
      return operand
    case 'multiply':
    default:
      return current * operand
  }
}

export function applyAuditedOperation(args: {
  current: number
  operand: number
  operation?: PricingOperation
  key: CalculationAuditStep['key']
  label: string
  source: string
  timing: CalculationAuditStep['timing']
  auditTrail: CalculationAuditStep[]
}): number {
  const operation = args.operation ?? 'multiply'
  const after = applyOperation(args.current, args.operand, operation)
  args.auditTrail.push({
    key: args.key,
    label: args.label,
    source: args.source,
    operation,
    operand: args.operand,
    timing: args.timing,
    before: args.current,
    after,
  })
  return after
}

export function applyAuditedMinimum(args: {
  current: number
  floor: number
  key?: 'minimum-premium' | 'bundle-minimum'
  source: string
  auditTrail: CalculationAuditStep[]
}): number {
  const after = Math.max(args.current, args.floor)
  const key = args.key ?? 'minimum-premium'
  args.auditTrail.push({
    key,
    label: key === 'bundle-minimum' ? 'Bundle minimum' : 'Minimum premium',
    source: args.source,
    operation: 'max',
    operand: args.floor,
    timing: key === 'bundle-minimum' ? 'bundle-minimum' : 'minimum-premium',
    before: args.current,
    after,
  })
  return after
}

export function runsAfterFloor(
  block: SourceTargetBlock | undefined,
  def: PricingTiming,
): boolean {
  return (block?.applyTiming ?? def) === 'after-all-rules'
}

export function answerToNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return parseAmount(value)
  return null
}

export function resolveSourceValue(
  block: SourceTargetBlock | undefined,
  input: CalcInput,
  binder?: BinderDetailsLike,
): number | null {
  if (!block) return null
  const sourceBlock = block
  const type = (sourceBlock.sourceType ?? '').toLowerCase()
  const obj = (sourceBlock.sourceObject ?? '').trim()
  const objLower = obj.toLowerCase()

  function applyCurrencyConversion(raw: number | null): number | null {
    if (raw === null) return null
    const calcCurrency = normalizeCurrencyCode(sourceBlock.calculationCurrency, '')
    if (!calcCurrency) return raw
    const question = findProposalQuestionBySourceObject(
      binder?.proposalQuestionGroups,
      obj,
    )
    const sourceCurrency = questionSourceCurrency(question, binder?.currency)
    if (sourceCurrency === calcCurrency) return raw
    const converted = convertCurrencyAmount(
      raw,
      sourceCurrency,
      calcCurrency,
      input.fxRates,
    )
    if (converted === null) throw new Error('Commercial currency conversion requires an explicit matching rate.')
    return converted
  }

  // Coverage axis lookups (limit / excess) — shared by the legacy
  // questionnaire-question defaults and the new `Coverage` type.
  const coverageAxis = (): number | null => {
    if (objLower === 'premium') return input.sourceCoveragePremium ?? null
    if (objLower === 'limit' || objLower === 'coveragelimit' || objLower === 'aggregate')
      return input.limit ?? null
    if (
      objLower === 'excess' ||
      objLower === 'standardexcess' ||
      objLower === 'excess / deductible' ||
      objLower === 'deductible'
    )
      return input.excess ?? null
    return null
  }

  if (type === 'coverage') return coverageAxis()
  if (type === 'annual-turnover') return input.turnover
  if (type === 'questionnaire' || type === 'questionnaire-question') {
    const axis = coverageAxis()
    if (axis !== null) return axis
    if (!obj) return null
    return applyCurrencyConversion(answerToNumber(input.answers?.[obj]))
  }
  if (type === 'constant-value') {
    // Legacy default carried the axis key in `sourceObject`; map the
    // well-known ones, otherwise treat the object as a literal amount.
    const axis = coverageAxis()
    if (axis !== null) return axis
    if (objLower === 'annualturnover') return input.turnover
    return parseAmount(obj)
  }
  // `Premium Component` / `External Table` operands are supplied by the
  // card pipeline itself (running premium / looked-up factor), not by
  // this resolver.
  return null
}

export function tryPipelineFullCalc(
  input: CalcInput,
  binder: BinderDetailsLike,
): CalcOutput | null {
  for (const primitive of fullCalcPrimitives) {
    try {
      const result = primitive.fullCalc(input, binder)
      if (result !== null) return result
    } catch (err) {
      throw err
    }
  }
  return null
}

export const fullCalcPrimitives: FullCalcPrimitive[] = []

export function registerFullCalcPrimitive(p: FullCalcPrimitive): void {
  const idx = fullCalcPrimitives.findIndex((x) => x.key === p.key)
  if (idx >= 0) fullCalcPrimitives[idx] = p
  else fullCalcPrimitives.push(p)
}

export function unregisterFullCalcPrimitive(key: string): void {
  const idx = fullCalcPrimitives.findIndex((x) => x.key === key)
  if (idx >= 0) fullCalcPrimitives.splice(idx, 1)
}

export function listFullCalcPrimitives(): FullCalcPrimitive[] {
  return [...fullCalcPrimitives]
}

export const SHARED_CALC_KEY = '__all__'

export function findCalcByLabel(
  bag: Record<string, CoverageCalculation>,
  label: string | undefined | null,
): CoverageCalculation | null {
  if (!label) return null
  if (bag[label]) return bag[label]
  const lower = label.trim().toLowerCase()
  for (const [k, v] of Object.entries(bag)) {
    if (k.trim().toLowerCase() === lower) return v
  }
  return null
}

export function resolveCoverageCalc(
  binder: BinderDetailsLike,
  coverageName: string,
): { calc: CoverageCalculation | null; lenient: boolean } {
  const bag = binder.calculationsByCoverage ?? {}
  const direct = findCalcByLabel(bag, coverageName)
  if (direct) return { calc: direct, lenient: false }
  const shared = bag[SHARED_CALC_KEY]
  if (shared) return { calc: shared, lenient: true }
  const primary = findCalcByLabel(bag, binder.primaryCoverage?.kind)
  if (primary) return { calc: primary, lenient: true }
  return { calc: null, lenient: false }
}

export function riderScalingFactor(calc: CoverageCalculation): number | null {
  const obj = (calc.sourceConfig?.ilfSum?.sourceObject ?? '').trim().toLowerCase()
  if (obj !== 'premium') return null
  const rows = calc.ilfSumMatrix ?? []
  const factor = parseFactor(rows[0]?.factor)
  return factor !== null && Number.isFinite(factor) ? factor : null
}

export function riderSourceCoverage(calc: CoverageCalculation): string | null {
  const label = (calc.sourceConfig?.ilfSum?.sourceCoverage ?? '').trim()
  return label.length > 0 ? label : null
}

export function baseRateSourceCoverage(calc: CoverageCalculation): {
  enabled: boolean
  coverage: string | null
} {
  const block = calc.sourceConfig?.basePremiumMatrix
  const enabled =
    (block?.sourceType ?? '').trim().toLowerCase() === 'coverage' &&
    (block?.sourceObject ?? '').trim().toLowerCase() === 'premium' &&
    (!block?.operation || block.operation === 'multiply')
  const coverage = (block?.sourceCoverage ?? '').trim()
  return { enabled, coverage: coverage || null }
}
