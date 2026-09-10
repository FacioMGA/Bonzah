/** Adapted from Symphony 74499802ee76869c923c2227a18883d06eeb7b4b:symphony-api/src/services/premiumCalculator.ts.
 * Pure source algorithm split by function boundary; tenant values are caller-supplied. */
import type { CalcInput, ProductLine, BinderDetailsLike, CalcOutput, PricingOperation, CalculationAuditStep, LoadingExtensionRow } from './types.js';
import { parseAmount, applyAuditedOperation, applyAuditedMinimum } from './primitives.js';
import { applyLoadings } from './factors.js';

export function calculateProductLinePremium(
  input: CalcInput,
  line: ProductLine,
  binder: BinderDetailsLike,
): CalcOutput {
  // Eligibility — per-line `isStandalone` overrides the binder-level
  // flag. When the line is non-standalone, the quote must include
  // either the binder's primary coverage or the explicitly-named
  // base coverage.
  const lineStandalone =
    line.isStandalone !== undefined
      ? line.isStandalone
      : binder.allowOtherCoveragesStandalone !== false
  if (!lineStandalone && !input.isPrimary) {
    const requiresBase = line.requiresBaseCoverage?.trim() || null
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

  const quantity = input.quantity ?? 0
  // Find the matching quantity band — first row whose
  // `quantityFrom..quantityTo` bracket contains the quote quantity.
  // Blank/null `quantityTo` means "no upper limit".
  const band = line.basePremiumTable.find((b) => {
    const from = parseAmount(b.quantityFrom)
    if (from === null) return false
    const toRaw = b.quantityTo
    const to =
      toRaw === undefined || toRaw === null || String(toRaw).trim() === ''
        ? Number.POSITIVE_INFINITY
        : parseAmount(toRaw)
    if (to === null) return false
    return quantity >= from && quantity <= to
  })
  if (!band) {
    return {
      basePremium: null,
      selectedPremium: null,
      floorApplied: false,
      bundleSplit: null,
      reason: 'no-matrix',
    }
  }

  // Resolve the base premium for this band. `fullPremium` wins when
  // present (banded flat rate); otherwise multiply `perUnit` by the
  // quantity. Half-configured rows that yield NaN fall through to
  // `no-matrix` so the caller knows the line isn't pricing-ready.
  const full = parseAmount(band.fullPremium)
  const perUnit = parseAmount(band.perUnit)
  let premium: number | null = null
  let productLineBaseOperation: PricingOperation = 'set'
  let productLineBaseOperand: number | null = null
  if (full !== null) {
    premium = full
    productLineBaseOperand = full
  } else if (perUnit !== null) {
    premium = perUnit * quantity
    productLineBaseOperation = 'multiply'
    productLineBaseOperand = perUnit
  }
  if (premium === null || !Number.isFinite(premium)) {
    return {
      basePremium: null,
      selectedPremium: null,
      floorApplied: false,
      bundleSplit: null,
      reason: 'no-matrix',
    }
  }

  const auditTrail: CalculationAuditStep[] = []
  const initialPremium = applyAuditedOperation({
    current: quantity,
    operand: productLineBaseOperand as number,
    operation: productLineBaseOperation,
    key: 'product-line-base',
    label: 'Product line quantity band',
    source: `product-line:${line.name?.trim() || line.id}`,
    timing: 'base-rate',
    auditTrail,
  })
  premium = initialPremium

  // Apply loadings in their configured timing slots. Reusing the
  // per-coverage Loading shape so the questionnaire-gated logic is
  // identical.
  const loadingRows: LoadingExtensionRow[] = line.loadings.map((l) => ({
    id: l.id,
    name: l.label,
    factor: l.factor,
    appliedAlways: l.appliedAlways,
    questionnaireKey: l.questionKey,
    applyTiming: l.applyTiming,
  }))
  premium = applyLoadings(
    premium,
    loadingRows,
    'after-base-premium',
    input.answers,
    auditTrail,
  )
  premium = applyLoadings(
    premium,
    loadingRows,
    'before-min-premium',
    input.answers,
    auditTrail,
  )
  const calculated = premium

  // Multi-coverage minimum floor — the highest per-coverage value
  // across rows wins. Coverages not present in the map fall through
  // to whatever the per-coverage `minimumPremiumFloor` configures
  // (resolved against `calculationsByCoverage`).
  let floor = 0
  for (const row of line.minimumPremium) {
    const v = row.perCoverage?.[input.coverage]
    if (typeof v === 'number' && Number.isFinite(v) && v > floor) {
      floor = v
    }
  }
  if (floor === 0) {
    const fallback =
      binder.calculationsByCoverage?.[input.coverage]?.minimumPremiumFloor ?? 0
    if (fallback > 0) floor = fallback
  }

  let enforced =
    floor > 0
      ? applyAuditedMinimum({
          current: calculated,
          floor,
          source: 'product-line-or-coverage-floor',
          auditTrail,
        })
      : calculated
  // After-all-rules loadings apply AFTER the floor lift.
  enforced = applyLoadings(
    enforced,
    loadingRows,
    'after-all-rules',
    input.answers,
    auditTrail,
  )

  return {
    basePremium: calculated,
    selectedPremium: enforced,
    floorApplied: floor > calculated,
    bundleSplit: null,
    reason: 'ok',
    breakdown: {
      baseRate: null,
      turnoverBandFactor: null,
      ilfSumFactor: null,
      ilfExcessFactor: null,
      floor,
      initialPremium,
      auditTrail,
    },
  }
}
