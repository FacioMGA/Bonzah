/** Adapted from Symphony 74499802ee76869c923c2227a18883d06eeb7b4b:symphony-api/src/services/premiumCalculator.ts.
 * Pure source algorithm split by function boundary; tenant values are caller-supplied. */
import type { CalcOutput, BinderDetailsLike, CalcInput } from './types.js';
import { applyAuditedOperation, resolveCoverageCalc, riderScalingFactor, baseRateSourceCoverage, riderSourceCoverage, parseAmount, parseTurnoverRange } from './primitives.js';
import { calculatePremium } from './premium.js';

export function applyBundleMinimum(
  results: { coverage: string; output: CalcOutput }[],
  binder: BinderDetailsLike,
): { coverage: string; output: CalcOutput }[] {
  const bundleAmount = binder.bundleMinimum?.amount ?? 0
  if (bundleAmount <= 0 || results.length < 2) {
    return results.map(({ coverage, output }) => ({
      coverage,
      output: { ...output, bundleSplit: null },
    }))
  }
  const totalSelected = results.reduce(
    (acc, r) => acc + (r.output.selectedPremium ?? 0),
    0,
  )
  if (totalSelected >= bundleAmount) {
    return results.map(({ coverage, output }) => ({
      coverage,
      output: { ...output, bundleSplit: null },
    }))
  }
  // Split proportionally to each coverage's calculated share. When
  // the calculated total is zero (every row hit a floor), fall back
  // to equal shares so the lift is still meaningful.
  const totalCalculated = results.reduce(
    (acc, r) => acc + (r.output.basePremium ?? 0),
    0,
  )
  const lift = bundleAmount - totalSelected
  const split = results.map((r) => {
    const share =
      totalCalculated > 0
        ? ((r.output.basePremium ?? 0) / totalCalculated) * lift
        : lift / results.length
    return { coverage: r.coverage, share }
  })
  return results.map(({ coverage, output }, i) => {
    const auditTrail = [...(output.breakdown?.auditTrail ?? [])]
    const lifted = applyAuditedOperation({
      current: output.selectedPremium ?? 0,
      operand: split[i]?.share ?? 0,
      operation: 'add',
      key: 'bundle-minimum',
      label: 'Bundle minimum allocation',
      source: `bundle-minimum:${bundleAmount}`,
      timing: 'bundle-minimum',
      auditTrail,
    })
    return {
      coverage,
      output: {
        ...output,
        selectedPremium: lifted,
        floorApplied: true,
        bundleSplit: split,
        breakdown: output.breakdown
          ? { ...output.breakdown, auditTrail }
          : output.breakdown,
      },
    }
  })
}

export function calculateQuote(
  inputs: CalcInput[],
  binder: BinderDetailsLike,
): { coverage: string; output: CalcOutput }[] {
  // Coverage-premium dependencies must run after their source coverage. This
  // includes both ILF riders and Base Premium cards configured to use another
  // coverage's premium as their rating basis.
  const resolved = inputs.map((input) => {
    const { calc } = resolveCoverageCalc(binder, input.coverage)
    const isRider = calc ? riderScalingFactor(calc) !== null : false
    const baseSource = calc
      ? baseRateSourceCoverage(calc)
      : { enabled: false, coverage: null }
    return {
      input,
      calc,
      dependency: isRider
        ? ({ kind: 'rider', coverage: riderSourceCoverage(calc!) } as const)
        : baseSource.enabled
          ? ({ kind: 'base', coverage: baseSource.coverage } as const)
          : null,
    }
  })

  const outputs: Array<CalcOutput | null> = resolved.map((r) =>
    r.dependency ? null : calculatePremium(r.input, binder),
  )
  const premiumByCoverage = new Map<string, number>()
  const recordPremium = (index: number) => {
    const output = outputs[index]
    if (output && typeof output.selectedPremium === 'number') {
      premiumByCoverage.set(
        resolved[index].input.coverage.trim().toLowerCase(),
        output.selectedPremium,
      )
    }
  }
  outputs.forEach((_output, index) => recordPremium(index))

  // Prefer the binder's named primary, then the input explicitly marked as
  // primary. Only fall back to the first priced coverage when neither exists.
  const primaryName = binder.primaryCoverage?.kind?.trim().toLowerCase()
  const defaultSourcePremium = (): number | undefined => {
    const namedPrimary = resolved.findIndex((r) =>
      primaryName
        ? r.input.coverage.trim().toLowerCase() === primaryName
        : r.input.isPrimary,
    )
    if (namedPrimary >= 0) {
      const value = outputs[namedPrimary]?.selectedPremium
      return typeof value === 'number' ? value : undefined
    }
    return premiumByCoverage.values().next().value
  }

  // Resolve dependency chains iteratively so A may depend on B even when B
  // itself depends on C. Cycles and missing sources remain unresolved and
  // deterministically return `no-source` below.
  const pending = new Set(
    resolved.flatMap((r, index) => (r.dependency ? [index] : [])),
  )
  let progressed = true
  while (pending.size > 0 && progressed) {
    progressed = false
    for (const index of [...pending]) {
      const dependency = resolved[index].dependency!
      const sourcePremium = dependency.coverage
        ? premiumByCoverage.get(dependency.coverage.trim().toLowerCase())
        : defaultSourcePremium()
      if (sourcePremium === undefined) continue
      const injected =
        dependency.kind === 'rider'
          ? { riderSourcePremium: sourcePremium }
          : { sourceCoveragePremium: sourcePremium }
      outputs[index] = calculatePremium(
        { ...resolved[index].input, ...injected },
        binder,
      )
      recordPremium(index)
      pending.delete(index)
      progressed = true
    }
  }
  for (const index of pending) {
    const dependency = resolved[index].dependency!
    const injected =
      dependency.kind === 'rider'
        ? { riderSourcePremium: null }
        : { sourceCoveragePremium: null }
    outputs[index] = calculatePremium(
      { ...resolved[index].input, ...injected },
      binder,
    )
  }

  const perCoverage = resolved.map((r, index) => ({
    coverage: r.input.coverage,
    output: outputs[index] as CalcOutput,
  }))
  return applyBundleMinimum(perCoverage, binder)
}

export function isPricingReady(binder: BinderDetailsLike): {
  ready: boolean
  reason: 'ok' | 'no-coverages' | 'no-matrices' | 'all-floors-only'
} {
  const bag = binder.calculationsByCoverage ?? {}
  const coverages = Object.keys(bag)
  if (coverages.length === 0) {
    return { ready: false, reason: 'no-coverages' }
  }
  let sawMatrix = false
  let sawCalc = false
  for (const coverage of coverages) {
    const calc = bag[coverage]
    if (!calc) continue
    // Prefer the flat Risk Code Table for the synthetic probe; fall
    // back to the legacy 2D matrix when the flat schema isn't
    // populated. Either path satisfies "matrix is present" for the
    // pricing-ready gate.
    const flat = calc.riskCodeTable ?? []
    let probeRiskCode: string | null = null
    let probeTurnover: number = 1_000_000
    if (flat.length > 0) {
      sawMatrix = true
      probeRiskCode = flat[0]?.code ?? null
      const bands = calc.turnoverBands ?? []
      if (bands[0]) {
        const from = parseAmount(bands[0].from)
        if (from !== null) probeTurnover = from + 1
      }
    } else {
      const matrix = calc.basePremiumMatrix?.[0]
      if (!matrix || matrix.rows.length === 0) continue
      sawMatrix = true
      const firstRow = matrix.rows[0]
      if (!firstRow) continue
      const range = parseTurnoverRange(firstRow.turnoverRange)
      probeRiskCode = firstRow.riskCode
      probeTurnover = range ? range.lower + 1 : 1_000_000
    }
    const out = calculatePremium(
      {
        coverage,
        riskCode: probeRiskCode,
        turnover: probeTurnover,
        isPrimary: true,
        bundleCoverages: [],
      },
      binder,
    )
    if (out.selectedPremium !== null && out.basePremium !== null) {
      sawCalc = true
      break
    }
  }
  if (!sawMatrix) return { ready: false, reason: 'no-matrices' }
  if (!sawCalc) return { ready: false, reason: 'all-floors-only' }
  return { ready: true, reason: 'ok' }
}
