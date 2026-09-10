/**
 * G1 (Tier 1) — segmentCalculation primitive.
 *
 * The doc spec (Phase 5 / Calculations, Card 1 "Risk Code") notes
 * that some professions cannot be priced from a Risk Code matrix
 * because the carrier hasn't yet defined one. For those rows the
 * admin marks `calcMethod: 'to_be_defined_later'` and authors a
 * segment-level calculation via the "Define Calculation" drawer:
 *
 *   - `basis`        : what the rate scales against (turnover /
 *                      headcount / flat)
 *   - `ladder`       : optional progressive bands of `{ upTo, rate }`
 *   - `fallbackRate` : rate used when no ladder band matches
 *
 * The pre-G1 engine ignored this field entirely — quotes for such
 * professions fell into `reason: 'no-matrix'`. This primitive
 * implements the calculation as a full-calc owner (see
 * `FullCalcPrimitive` in `premiumCalculator.ts`):
 *
 *   1. Look up the matching profession by riskCode + coverage
 *   2. If `calcMethod !== 'to_be_defined_later'`, decline (return null)
 *   3. Compute `basisValue × rate` where `rate` is the first ladder
 *      band the `basisValue` fits inside, or `fallbackRate` otherwise
 *   4. Return a complete CalcOutput with `basePremium` and
 *      `selectedPremium` populated; floor and ILF steps are
 *      intentionally skipped because the segment calc is a
 *      self-contained rate.
 *
 * Why "full-calc" (own the whole pipeline): the segment calc isn't
 * a *modifier* of the matrix path — it REPLACES it. Trying to splice
 * it into the existing step sequence would force every downstream
 * step (ILF Sum, ILF Excess, floor) to special-case its presence.
 * Owning the calc end-to-end keeps the steps small.
 *
 * Registration: this module side-effect-registers itself at import
 * time so any consumer that imports `premiumCalculator.js` (which
 * imports this file) gets the primitive enabled by default.
 */

import { registerFullCalcPrimitive } from './primitives.js';
import type { BinderDetailsLike, CalcInput, CalcOutput, ProfessionRow } from './types.js';

function findProfessionForInput(
  binder: BinderDetailsLike,
  input: CalcInput,
): ProfessionRow | undefined {
  const rows = binder.professions ?? []
  if (rows.length === 0 || !input.riskCode) return undefined
  return rows.find((row) => {
    const codes = row.riskCodesByCoverage ?? {}
    return codes[input.coverage] === input.riskCode
  })
}

function resolveBasisValue(
  basis: 'turnover' | 'headcount' | 'flat',
  input: CalcInput,
): number {
  if (basis === 'turnover') return input.turnover
  if (basis === 'flat') return 1
  // headcount
  const fromAnswer = input.answers?.headcount
  if (typeof fromAnswer === 'number' && Number.isFinite(fromAnswer)) {
    return fromAnswer
  }
  if (typeof fromAnswer === 'string') {
    const parsed = Number(fromAnswer.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function resolveRate(
  ladder: { upTo: number; rate: number }[] | undefined,
  fallbackRate: number,
  basisValue: number,
): number {
  if (!ladder || ladder.length === 0) return fallbackRate
  // Sort ascending so the lowest band wins for small basis values.
  const sorted = [...ladder].sort((a, b) => a.upTo - b.upTo)
  for (const band of sorted) {
    if (basisValue <= band.upTo) return band.rate
  }
  return fallbackRate
}

export const segmentCalculationPrimitive = {
  key: 'segment-calculation',
  description:
    "G1 — replaces the riskCode matrix lookup when the matching profession declares calcMethod='to_be_defined_later'.",
  fullCalc(input: CalcInput, binder: BinderDetailsLike): CalcOutput | null {
    const profession = findProfessionForInput(binder, input)
    if (!profession) return null
    const calcMethod = (profession.calcMethod ?? '').toLowerCase()
    // Accept either the new DB key 'to_be_defined_later' or the
    // legacy string 'To Be Defined Later' so the primitive works
    // before all professions migrate to the new CalcMethod enum
    // (Tier 6 G6 cosmetic rename).
    if (
      calcMethod !== 'to_be_defined_later' &&
      calcMethod !== 'to be defined later'
    ) {
      return null
    }
    const calc = profession.segmentCalculation
    if (!calc) return null
    const basisValue = resolveBasisValue(calc.basis, input)
    const rate = resolveRate(calc.ladder, calc.fallbackRate, basisValue)
    const basePremium = basisValue * rate
    return {
      basePremium,
      // Selected premium = base for now; future composition could
      // run a per-row minimum from `profession.minExcess` here.
      selectedPremium: basePremium,
      floorApplied: false,
      bundleSplit: null,
      reason: 'ok',
    }
  },
}

// Self-register at module-load time so any test or route that
// imports the engine gets the primitive enabled by default. Tests
// that need to disable it can call `unregisterFullCalcPrimitive`.
registerFullCalcPrimitive(segmentCalculationPrimitive)
