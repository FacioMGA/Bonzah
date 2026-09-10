/** Adapted from Symphony 74499802ee76869c923c2227a18883d06eeb7b4b:symphony-api/src/services/premiumCalculator.ts.
 * Pure source algorithm split by function boundary; tenant values are caller-supplied. */

export type BasePremiumMatrixRow = {
  riskCode: string
  turnoverRange: string
  rate: string | number
}

export type BasePremiumMatrixVersion = {
  coverage?: string
  version?: string
  rows: BasePremiumMatrixRow[]
}

export type RiskCodeDiscountRow = {
  riskCode: string
  factor: string | number
  /** Optional per-risk-code minimum-premium floor. */
  floor?: string | number
}

export type ILFSumRow = {
  coverageLimit: string | number
  /** Either a single factor (preferred) or a per-coverage map. */
  factor?: string | number
  factorsByCoverage?: Record<string, string | number>
}

export type ILFExcessRow = {
  deductible: string | number
  factor: string | number
}

export type RiskCodeTableRow = {
  code: string
  description?: string
  /** Base rate as a percentage of turnover (e.g. "1.25" or "1.25%"),
   *  or as a direct multiplier when Base Premium is sourced from another
   *  coverage's premium. */
  baseRate: string | number
  /** Optional per-risk-code minimum-premium floor. */
  minimumPremium?: string | number
}

export type TurnoverBandRow = {
  from: string | number
  to: string | number | null | undefined
  multiplier: string | number
}

export type LoadingExtensionRow = {
  id?: string
  name?: string
  factor: string | number
  appliedAlways?: boolean
  questionnaireKey?: string
  applyTiming?: 'before-min-premium' | 'after-base-premium' | 'after-all-rules'
}

export type PricingOperation = 'multiply' | 'add' | 'set' | 'subtract'

export type PricingTiming =
  | 'before-min-premium'
  | 'after-base-premium'
  | 'after-all-rules'

export type SourceTargetBlock = {
  sourceType?: string
  sourceObject?: string
  /** When `sourceType = 'coverage'` and `sourceObject = 'Premium'`, the
   *  label of the coverage whose premium feeds this card (rider model).
   *  Empty/undefined falls back to the binder's primary coverage. */
  sourceCoverage?: string
  /** Currency for engine evaluation when the questionnaire source is currency-typed. */
  calculationCurrency?: string
  applyTo?: 'base-premium' | 'final-coverage-premium' | 'final-product-line-premium'
  operation?: PricingOperation
  applyTiming?: PricingTiming
}

export type CoverageCalculation = {
  basePremiumMatrix?: BasePremiumMatrixVersion[]
  ilfSumMatrix?: ILFSumRow[]
  ilfExcessMatrix?: ILFExcessRow[]
  riskCodeDiscounts?: RiskCodeDiscountRow[]
  /** Per-card Source/Operation/Timing config. Missing entries (and
   *  entries left at the historical default of `multiply` + a
   *  before-floor timing) reproduce the legacy fixed pipeline exactly. */
  sourceConfig?: {
    basePremiumMatrix?: SourceTargetBlock
    turnoverBands?: SourceTargetBlock
    ilfSum?: SourceTargetBlock
    ilfExcess?: SourceTargetBlock
    loadingsExtensions?: SourceTargetBlock
  }
  /** General floor applied across the whole coverage. */
  minimumPremiumFloor?: number
  /** Whether to apply the floor when the calculated premium is below.
   *  When false / undefined, the calculator skips the floor lift
   *  (UI checkbox controls this — engine respects it). */
  enforceMinimumPremium?: boolean

  // ── Tier-2 additions ─────────────────────────────────────────────
  /** Flat Risk Code table. Engine prefers this over the 2D matrix
   *  when populated. */
  riskCodeTable?: RiskCodeTableRow[]
  /** Turnover band multipliers. Applied after the Risk Code Table
   *  base-rate lookup. Only consulted when `riskCodeTable` is used as
   *  the rate source. */
  turnoverBands?: TurnoverBandRow[]
  /** Loading & Extensions rules (doc S5). Applied at the configured
   *  timing slot. */
  loadingsExtensions?: LoadingExtensionRow[]
  /** Per-coverage Stand-Alone override (doc S9). When `undefined` the
   *  binder-level `allowOtherCoveragesStandalone` flag wins. */
  isStandalone?: boolean
  /** Coverage name required as a precondition when this coverage is
   *  non-standalone. When set, the eligibility gate also passes if
   *  the named coverage is on the quote (in addition to the binder's
   *  primary coverage). */
  requiresBaseCoverage?: string
}

export type ProductLineQuantityBand = {
  quantityFrom: string | number
  quantityTo: string | number
  fullPremium?: string | number
  perUnit?: string | number
}

export type ProductLineLoading = {
  id?: string
  label?: string
  factor: string | number
  appliedAlways?: boolean
  questionKey?: string
  applyTiming?: 'before-min-premium' | 'after-base-premium' | 'after-all-rules'
}

export type ProductLineMinimum = {
  id?: string
  type?: 'Per Occurrence' | 'Annual Aggregate'
  perCoverage: Record<string, number>
  currency?: 'USD' | 'GBP' | 'EUR' | 'ILS'
}

export type ProductLine = {
  id: string
  name?: string
  triggerSegmentId: string
  linkedCoverages: string[]
  isStandalone?: boolean
  requiresBaseCoverage?: string
  templateId?: string
  basePremiumTable: ProductLineQuantityBand[]
  loadings: ProductLineLoading[]
  minimumPremium: ProductLineMinimum[]
  status?: 'Draft' | 'Ready'
}

export type ProfessionRow = {
  profession: string
  /** Canonical Segment row linked by the Product professions editor. */
  segmentId?: string
  section?: string
  branch?: string
  subBranch?: string
  minExcess?: string
  calcMethod?: string
  riskCodesByCoverage?: Record<string, string>
  segmentCalculation?: {
    basis: 'turnover' | 'headcount' | 'flat'
    ladder?: { upTo: number; rate: number }[]
    fallbackRate: number
  }
}

export type BinderDetailsLike = {
  currency?: string;
  /** Toggle that gates the eligibility / Apply Logic step. When
   *  `false`, only the primary coverage can be quoted standalone;
   *  non-primary coverages return an eligibility error unless the
   *  primary is also on the quote. */
  allowOtherCoveragesStandalone?: boolean
  /** Binder-level bundle minimum — applied to multi-coverage quotes.
   *  The engine raises the quote total to `amount` and splits the
   *  lift proportionally across coverages. */
  bundleMinimum?: {
    amount: number
    splitRule: 'proportional'
  }
  /** Per-coverage calc bag. The engine reads each coverage's bag by
   *  its label (e.g. `Third Party Liability`). The caller is
   *  responsible for resolving label aliases (binderProductId vs
   *  label) before invoking the engine. */
  calculationsByCoverage?: Record<string, CoverageCalculation>
  /** The binder/product's primary coverage. When a requested coverage
   *  has no calc bag of its own, the engine falls back to the shared
   *  "All Coverages" slot, then to this primary coverage's bag, so a
   *  single configured calculation prices every coverage. */
  primaryCoverage?: { kind?: string; customLabel?: string }
  /** Tier-3 segment-triggered product lines. When the quote's
   *  selected segment matches a line's `triggerSegmentId`, the
   *  engine routes pricing through that line for every coverage in
   *  `linkedCoverages` INSTEAD of the per-coverage risk-code path. */
  productLines?: ProductLine[]
  /** G1 — profession rows imported via the Professions sub-tab.
   *  Used by the segment-calculation primitive (registered via
   *  `calcPipeline`) to bypass the riskCode matrix when the
   *  profession is marked `calcMethod: 'to_be_defined_later'`. */
  professions?: ProfessionRow[]
  /** Proposal-form questions — currency metadata for questionnaire sources (SYM-343). */
  proposalQuestionGroups?: Array<{
    questions?: Array<{
      id?: string
      dataSlug?: string
      libraryId?: string
      field?: string
      slug?: string
      answerType?: string
      settings?: { currency?: string }
    }>
  }>
}

export type CalcInput = {
  coverage: string
  riskCode: string | null
  turnover: number
  /** Coverage limit (sum insured). Optional — defaults to ILF factor
   *  1.0 when missing. */
  limit?: number | null
  /** Excess / deductible. Optional — defaults to ILF factor 1.0 when
   *  missing. */
  excess?: number | null
  /** Whether this coverage is the binder's primary. Drives the
   *  eligibility gate alongside `bundleCoverages`. */
  isPrimary: boolean
  /** Other coverages on the same quote (excluding the current one).
   *  Used by both the eligibility gate and the bundle-minimum
   *  resolver. */
  bundleCoverages: string[]
  /** Optional quote answer map keyed by question identifier. Used
   *  by Loading & Extensions rules with a `questionnaireKey` — a rule
   *  fires when `answers[key]` is truthy. Engine treats `undefined`
   *  / empty objects as "no answers". */
  answers?: Record<string, unknown>
  /** Selected segment for this quote. When set, the engine looks up
   *  a matching `productLines` entry on the binder before falling
   *  back to the per-coverage path. Drives Tier-3 routing. */
  segmentId?: string
  /** Quantity for segment-triggered pricing (e.g. number of Safety
   *  Officers). Used to look up the matching quantity band on the
   *  product line's base premium table. */
  quantity?: number
  /** Injected by `calculateQuote` for rider coverages (e.g. PI sold as
   *  a % of the primary coverage). Holds the already-computed primary
   *  coverage premium so the rider can price as `source × factor`. Not
   *  set on a normal single-coverage call. */
  riderSourcePremium?: number | null
  /** Injected by `calculateQuote` when the Base Premium card is configured
   *  with Source = Coverage / Premium. Holds the already-computed premium
   *  of `sourceCoverage` (or the binder primary coverage when omitted). */
  sourceCoveragePremium?: number | null
  /** Optional FX table keyed `FROM->TO` for currency source conversion. */
  fxRates?: Record<string, number>
}

export type CalcReason =
  | 'ok'
  | 'no-risk-code'
  | 'eligibility-failed'
  | 'no-matrix'
  /** Rejected before pricing: the requested coverage is not in the
   *  binder's authorized coverage list. Set by the
   *  `partitionInputsByAuthorization` filter in `binderAllowlist.ts`,
   *  never by the pure engine. Hotfix G22 — replaced by FK-based
   *  enforcement once Tier 0b's Coverage entity lands. */
  | 'not-authorized'
  /** Rejected before pricing: the requested policy is not in the
   *  binder's selected-policies list. Reserved for future use — the
   *  request payload doesn't yet carry a separate `policy` field, so
   *  the allowlist filter currently only enforces the coverage gate. */
  | 'policy-not-selected'
  /** A coverage-premium dependency couldn't resolve its source — e.g. the
   *  selected source coverage did not price, so there is no rating basis. */
  | 'no-source'

export type CalcOutput = {
  /** Premium before any floor / bundle adjustments. `null` when the
   *  engine couldn't resolve a matrix / risk code. */
  basePremium: number | null
  /** Final premium after the floor + bundle adjustments. `null` when
   *  `basePremium` is null and no floor is configured (the caller
   *  must fall back to manual entry). */
  selectedPremium: number | null
  /** True when the floor (general / per-risk-code) lifted the
   *  premium above the calculated value. */
  floorApplied: boolean
  /** Populated by `applyBundleMinimum` when the binder-level bundle
   *  floor binds. Each entry names the coverage and its share of the
   *  lift. */
  bundleSplit: { coverage: string; share: number }[] | null
  reason: CalcReason
  /** Per-coverage factor breakdown of the priced result, surfaced so
   *  callers (e.g. the product pricing bridge / Premium tab) can show
   *  the real rate / ILF / minimum-premium values instead of
   *  placeholders. Only populated on the standard per-coverage `ok`
   *  path; `undefined` for eligibility / no-matrix / product-line
   *  results. All factors are the multipliers the engine actually
   *  applied (1 = "no factor"). */
  breakdown?: {
    /** Base rate as a fraction of turnover (e.g. 0.001 = 0.1% = 1‰). */
    baseRate: number | null
    /** Turnover-band multiplier, when the flat risk-code path used one. */
    turnoverBandFactor: number | null
    /** ILF Sum (coverage-limit) multiplier. */
    ilfSumFactor: number | null
    /** ILF Excess (deductible) multiplier. */
    ilfExcessFactor: number | null
    /** Minimum-premium floor resolved for this coverage / risk code. */
    floor: number
    /** Premium produced by the initial rating-basis x base-rate lookup. */
    initialPremium?: number | null
    /**
     * Ordered, lossless mutations applied by the engine. This is the
     * authoritative explanation of the result; consumers must not try to
     * reconstruct a formula from a subset of the configured factors.
     */
    auditTrail?: CalculationAuditStep[]
  }
}

export type CalculationAuditStep = {
  key:
    | 'base-rate'
    | 'base-source'
    | 'turnover-band'
    | 'risk-code-discount'
    | 'loading'
    | 'limit-ilf'
    | 'deductible-ilf'
    | 'minimum-premium'
    | 'bundle-minimum'
    | 'rider-source'
    | 'product-line-base'
  label: string
  source: string
  operation: PricingOperation | 'max'
  operand: number
  timing: PricingTiming | 'base-rate' | 'minimum-premium' | 'bundle-minimum'
  before: number
  after: number
}

export type FullCalcPrimitive = {
  key: string
  description?: string
  fullCalc: (input: CalcInput, binder: BinderDetailsLike) => CalcOutput | null
}
