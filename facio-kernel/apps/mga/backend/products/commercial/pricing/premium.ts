/** Adapted from Symphony 74499802ee76869c923c2227a18883d06eeb7b4b:symphony-api/src/services/premiumCalculator.ts.
 * Pure source algorithm split by function boundary; tenant values are caller-supplied. */
import type { CalcInput, BinderDetailsLike, CalcOutput, CalculationAuditStep } from './types.js';
import { tryPipelineFullCalc, resolveCoverageCalc, riderScalingFactor, applyAuditedOperation, applyAuditedMinimum, baseRateSourceCoverage, resolveSourceValue, runsAfterFloor, parseFactor } from './primitives.js';
import { calculateProductLinePremium } from './productLines.js';
import { floorOnly, resolveFloor, resolveBaseRate, lookupTurnoverBandMultiplier, applyLoadings, lookupIlfFactor } from './factors.js';

export function calculatePremium(
  input: CalcInput,
  binder: BinderDetailsLike,
): CalcOutput {
  // Tier 0b pipeline hook — give registered primitives a chance to
  // own the full calculation BEFORE the legacy code paths run. Used
  // today by G1's `segmentCalculationPrimitive` to bypass the
  // risk-code matrix when the profession says "to be defined later".
  // The hook is a no-op when no primitive returns a non-null result,
  // so existing behaviour is preserved.
  const piped = tryPipelineFullCalc(input, binder)
  if (piped !== null) {
    return piped
  }

  // Tier-3 segment-triggered routing. Take the FIRST matching product
  // line; admins can use template duplication if multiple lines need
  // to fire on the same segment.
  if (input.segmentId) {
    const line = (binder.productLines ?? []).find(
      (l) =>
        l.status === 'Ready' &&
        l.triggerSegmentId === input.segmentId &&
        l.linkedCoverages.includes(input.coverage),
    )
    if (line) {
      return calculateProductLinePremium(input, line, binder)
    }
  }

  const { calc, lenient } = resolveCoverageCalc(binder, input.coverage)

  // 1 / 2 — Eligibility gate. Per-coverage `isStandalone` overrides
  // the binder-level flag (Tier-2 doc S9). When the coverage is
  // marked non-standalone OR the binder forbids it, the quote MUST
  // include the binder's primary coverage or the explicitly-named
  // `requiresBaseCoverage` value.
  const coverageStandalone =
    calc?.isStandalone !== undefined
      ? calc.isStandalone
      : binder.allowOtherCoveragesStandalone !== false
  if (!coverageStandalone && !input.isPrimary) {
    const requiresBase = calc?.requiresBaseCoverage?.trim() || null
    const bundleSatisfiesBase = requiresBase
      ? input.bundleCoverages.includes(requiresBase)
      : input.bundleCoverages.length > 0
    if (!bundleSatisfiesBase) {
      return {
        basePremium: null,
        selectedPremium: null,
        floorApplied: false,
        bundleSplit: null,
        reason: 'eligibility-failed',
      }
    }
  }

  if (!calc) {
    return floorOnly(0, calc, input.riskCode, 'no-matrix')
  }

  // Rider path — when the coverage's ILF Sum source is "Premium", it is
  // sold as a percentage of the PRIMARY coverage's premium (e.g. PI =
  // 20% of Third Party). It does NOT use the risk-code / turnover / ILF
  // path at all. `calculateQuote` prices the base coverages first and
  // injects `riderSourcePremium` so this branch can resolve.
  const riderFactor = riderScalingFactor(calc)
  if (riderFactor !== null) {
    const source = input.riderSourcePremium
    if (source == null || !Number.isFinite(source)) {
      return floorOnly(0, calc, input.riskCode, 'no-source')
    }
    const floor = resolveFloor(calc, input.riskCode)
    const enforce = !!calc.enforceMinimumPremium
    const auditTrail: CalculationAuditStep[] = []
    const riderPremium = applyAuditedOperation({
      current: source,
      operand: riderFactor,
      operation: 'multiply',
      key: 'rider-source',
      label: 'Rider source premium',
      source: 'configured-source-coverage-premium',
      timing: 'base-rate',
      auditTrail,
    })
    const enforced =
      enforce && floor > riderPremium
        ? applyAuditedMinimum({
            current: riderPremium,
            floor,
            source: 'coverage-or-risk-code-floor',
            auditTrail,
          })
        : riderPremium
    return {
      basePremium: riderPremium,
      selectedPremium: enforced,
      floorApplied: enforce && floor > riderPremium,
      bundleSplit: null,
      reason: 'ok',
      breakdown: {
        baseRate: null,
        turnoverBandFactor: null,
        ilfSumFactor: riderFactor,
        ilfExcessFactor: null,
        floor,
        initialPremium: riderPremium,
        auditTrail,
      },
    }
  }

  // 5 — Base rate lookup. Try the new flat Risk Code Table first
  // (Tier-2 doc Card 1); fall back to the legacy 2D matrix when the
  // flat schema isn't populated. This keeps pre-Tier-2 binders
  // working unchanged.
  const linkedPremiumSource = baseRateSourceCoverage(calc)
  const rateResolution = resolveBaseRate(
    calc,
    input,
    lenient,
    linkedPremiumSource.enabled ? 'multiplier' : 'percentage',
  )
  if (rateResolution.rate === null) {
    return floorOnly(0, calc, input.riskCode, rateResolution.reason)
  }

  // Turnover-based rates are percentages. A Base Premium card sourced from
  // Coverage / Premium uses the configured value as a direct multiplier of
  // the selected coverage's already-computed premium.
  const ratingBasis = linkedPremiumSource.enabled
    ? input.sourceCoveragePremium
    : input.turnover
  if (ratingBasis == null || !Number.isFinite(ratingBasis)) {
    return floorOnly(0, calc, input.riskCode, 'no-source')
  }
  const auditTrail: CalculationAuditStep[] = []
  const initialPremium = rateResolution.rate * ratingBasis
  let premium = applyAuditedOperation({
    current: ratingBasis,
    operand: rateResolution.rate,
    operation: 'multiply',
    key: 'base-rate',
    label: 'Rating basis × base rate',
    source: linkedPremiumSource.enabled
      ? `configured-source-coverage-premium:${linkedPremiumSource.coverage ?? 'primary'}`
      : `${rateResolution.source}-rate:${input.riskCode ?? 'unresolved-risk-code'}`,
    timing: 'base-rate',
    auditTrail,
  })

  // 5 (config) — Source-driven Base Premium adjustment. Only fires when
  // the operator configured a non-multiply operation against a
  // resolvable source on the Base Premium card (e.g. "set base premium
  // from questionnaire 'flatBase'" or "add coverage limit"). A missing
  // block, the default `multiply`, or an unresolvable source leaves the
  // matrix result untouched — so legacy binders are unchanged.
  const sc = calc.sourceConfig
  const baseBlock = sc?.basePremiumMatrix
  if (baseBlock && baseBlock.operation && baseBlock.operation !== 'multiply') {
    const operand = resolveSourceValue(baseBlock, input, binder)
    if (operand === null) throw new Error(`Configured base source could not resolve ${baseBlock.sourceType}:${baseBlock.sourceObject}.`)
    if (operand !== null) {
      premium = applyAuditedOperation({
        current: premium,
        operand,
        operation: baseBlock.operation,
        key: 'base-source',
        label: 'Base premium source adjustment',
        source: `${baseBlock.sourceType ?? 'unresolved'}:${baseBlock.sourceObject ?? 'unresolved'}`,
        timing: baseBlock.applyTiming ?? 'after-base-premium',
        auditTrail,
      })
    }
  }

  // 5a — Turnover Bands (Tier-2 doc Card 2). Only consulted when the
  // base rate came from the flat Risk Code Table; the legacy 2D
  // matrix's columns already encode turnover sensitivity. Applied at
  // its configured timing slot (default: before the floor, multiply).
  let bandFactor: number | null = null
  if (rateResolution.source === 'flat') {
    bandFactor = lookupTurnoverBandMultiplier(
      calc.turnoverBands ?? [],
      input.turnover,
    )
    if (calc.turnoverBands?.length && bandFactor === null) throw new Error(`No configured turnover band matches ${input.turnover}.`)
    if (bandFactor !== null && !runsAfterFloor(sc?.turnoverBands, 'after-base-premium')) {
      premium = applyAuditedOperation({
        current: premium,
        operand: bandFactor,
        operation: sc?.turnoverBands?.operation,
        key: 'turnover-band',
        label: 'Turnover band',
        source: 'configured-turnover-band',
        timing: sc?.turnoverBands?.applyTiming ?? 'after-base-premium',
        auditTrail,
      })
    }
  }

  // 5b — Risk Code Discount (legacy multiplier, kept for back-compat).
  const discount = calc.riskCodeDiscounts?.find(
    (r) => r.riskCode === input.riskCode,
  )
  if (discount) {
    const f = parseFactor(discount.factor)
    if (f !== null) {
      premium = applyAuditedOperation({
        current: premium,
        operand: f,
        operation: 'multiply',
        key: 'risk-code-discount',
        label: 'Risk code discount',
        source: `risk-code:${input.riskCode ?? 'unresolved'}`,
        timing: 'after-base-premium',
        auditTrail,
      })
    }
  }

  // 5c — Loading & Extensions, "after-base-premium" timing slot.
  premium = applyLoadings(
    premium,
    calc.loadingsExtensions ?? [],
    'after-base-premium',
    input.answers,
    auditTrail,
  )

  // 6 — ILF Sum. Applied at its configured timing slot.
  const ilfSumFactor = lookupIlfFactor(
    calc.ilfSumMatrix ?? [],
    'coverageLimit',
    input.limit,
    input.coverage,
  )
  if (calc.ilfSumMatrix?.length && ilfSumFactor === null) throw new Error(`No configured limit factor matches ${input.coverage} / ${input.limit}.`)
  if (ilfSumFactor !== null && !runsAfterFloor(sc?.ilfSum, 'before-min-premium')) {
    premium = applyAuditedOperation({
      current: premium,
      operand: ilfSumFactor,
      operation: sc?.ilfSum?.operation,
      key: 'limit-ilf',
      label: 'Coverage limit factor',
      source: `coverage-limit:${input.limit ?? 'unresolved'}`,
      timing: sc?.ilfSum?.applyTiming ?? 'before-min-premium',
      auditTrail,
    })
  }

  // 7 — ILF Excess. Applied at its configured timing slot.
  const ilfExcessFactor = lookupIlfFactor(
    calc.ilfExcessMatrix ?? [],
    'deductible',
    input.excess,
    input.coverage,
  )
  if (calc.ilfExcessMatrix?.length && ilfExcessFactor === null) throw new Error(`No configured deductible factor matches ${input.coverage} / ${input.excess}.`)
  if (ilfExcessFactor !== null && !runsAfterFloor(sc?.ilfExcess, 'before-min-premium')) {
    premium = applyAuditedOperation({
      current: premium,
      operand: ilfExcessFactor,
      operation: sc?.ilfExcess?.operation,
      key: 'deductible-ilf',
      label: 'Deductible factor',
      source: `deductible:${input.excess ?? 'unresolved'}`,
      timing: sc?.ilfExcess?.applyTiming ?? 'before-min-premium',
      auditTrail,
    })
  }

  // 7b — Loading & Extensions, "before-min-premium" timing slot.
  premium = applyLoadings(
    premium,
    calc.loadingsExtensions ?? [],
    'before-min-premium',
    input.answers,
    auditTrail,
  )

  const calculated = premium

  // 9 — Floor.
  const floor = resolveFloor(calc, input.riskCode)

  // 10 — Selected premium = max(calculated, floor) when the floor
  // is enforced; otherwise the raw calculated value.
  const enforceFloor = floor > 0 && (calc.enforceMinimumPremium ?? floor > 0)
  let enforced = enforceFloor
    ? applyAuditedMinimum({
        current: calculated,
        floor,
        source: 'coverage-or-risk-code-floor',
        auditTrail,
      })
    : calculated

  // 10a — Card effects explicitly configured to run AFTER the minimum
  // floor (e.g. an ILF factor the operator moved past the minimum, or
  // a post-floor deduction). Default timings keep these before the
  // floor, so legacy output is unchanged.
  if (bandFactor !== null && runsAfterFloor(sc?.turnoverBands, 'after-base-premium')) {
    enforced = applyAuditedOperation({
      current: enforced,
      operand: bandFactor,
      operation: sc?.turnoverBands?.operation,
      key: 'turnover-band',
      label: 'Turnover band',
      source: 'configured-turnover-band',
      timing: 'after-all-rules',
      auditTrail,
    })
  }
  if (ilfSumFactor !== null && runsAfterFloor(sc?.ilfSum, 'before-min-premium')) {
    enforced = applyAuditedOperation({
      current: enforced,
      operand: ilfSumFactor,
      operation: sc?.ilfSum?.operation,
      key: 'limit-ilf',
      label: 'Coverage limit factor',
      source: `coverage-limit:${input.limit ?? 'unresolved'}`,
      timing: 'after-all-rules',
      auditTrail,
    })
  }
  if (ilfExcessFactor !== null && runsAfterFloor(sc?.ilfExcess, 'before-min-premium')) {
    enforced = applyAuditedOperation({
      current: enforced,
      operand: ilfExcessFactor,
      operation: sc?.ilfExcess?.operation,
      key: 'deductible-ilf',
      label: 'Deductible factor',
      source: `deductible:${input.excess ?? 'unresolved'}`,
      timing: 'after-all-rules',
      auditTrail,
    })
  }

  // 10b — Loading & Extensions, "after-all-rules" timing slot
  // (applied AFTER the floor so post-floor rules like sales tax
  // still scale the final value).
  enforced = applyLoadings(
    enforced,
    calc.loadingsExtensions ?? [],
    'after-all-rules',
    input.answers,
    auditTrail,
  )

  return {
    basePremium: calculated,
    selectedPremium: enforced,
    floorApplied: enforceFloor && floor > calculated,
    bundleSplit: null,
    reason: 'ok',
    breakdown: {
      baseRate: rateResolution.rate,
      turnoverBandFactor: bandFactor,
      ilfSumFactor,
      ilfExcessFactor,
      floor,
      initialPremium,
      auditTrail,
    },
  }
}
