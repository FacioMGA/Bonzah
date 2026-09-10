import type { BdxRowDto } from '../../../reporting/app/bdxImport/types.js';

/**
 * Declared-premium alignment — the bordereau is the financial source of truth
 * for historical BDX imports (ADR-0056).
 *
 * The product calculator still rates every imported row (validation +
 * breakdown provenance), but the PERSISTED premium must equal the premium the
 * coverholder declared, collected and reported to Lloyd's. Any calculator gap
 * is applied on top as an explicit loading/discount adjustment line and
 * recorded in a `bdxPremiumAlignment` audit block.
 *
 * This module intentionally writes the exact same structure as the
 * 2026-07-30 production remediation (`align_bdx_declared_premiums_2026-07-30`)
 * so the whole book — remediated and newly imported — carries one canonical
 * alignment shape.
 */

/** The subset of the BDX row the alignment actually reads. */
export type DeclaredPremiumAlignmentEvaluation = {
  dto: Pick<BdxRowDto, 'premiumPayable' | 'entry' | 'policyRef' | 'sourceRowNumber' | 'sourceSheetName' | 'sourceFile'>;
};

export type BdxPremiumAlignmentAudit = {
  appliedAt: string;
  origin: 'bdx-import';
  runId: string;
  adjustmentType: 'loading' | 'discount';
  adjustmentAmount: number;
  calculatorPremium: number;
  declaredPremium: number;
  source: {
    file: string | null;
    sheet: string;
    row: number;
    ref: string;
    txType: string | null;
  };
};

type AlignableBreakdownLine = {
  code?: string;
  kind?: string;
  label?: string;
  amount?: number;
};

/**
 * Structural view over the adapter quoteResponse fields this module reads and
 * mutates. All numeric reads still go through `toFiniteNumber`, so a field
 * holding a non-numeric value degrades to "no premium found" rather than NaN.
 */
export type AlignableQuoteResponse = {
  primaryOption?: {
    annualPremium?: number | null;
    totalPremium?: number | null;
    noAddonGrossPremium?: number | null;
    monthlyPremium?: number | null;
    costDetails?: {
      totalPremium?: number | null;
      subtotalNetPremium?: number | null;
    } | null;
    breakdown?: {
      grossPremium?: number | null;
      bdxDeclaredAlignment?: number;
      lines?: AlignableBreakdownLine[];
    } | null;
  } | null;
  pricing?: {
    total?: number | null;
    annualPremium?: number | null;
  } | null;
  premium?: number | null;
  bdxPremiumAlignment?: BdxPremiumAlignmentAudit;
};

export type DeclaredPremiumAlignmentOutcome = {
  quoteResponse: AlignableQuoteResponse;
  applied: boolean;
  calculatorPremium: number | null;
  declaredPremium: number | null;
  adjustmentAmount: number;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asAlignable(quoteResponse: unknown): AlignableQuoteResponse {
  return quoteResponse && typeof quoteResponse === 'object' && !Array.isArray(quoteResponse)
    ? (quoteResponse as AlignableQuoteResponse)
    : {};
}

/** Same read precedence as the policy-list-index projection. */
export function readCalculatorPremium(quoteResponse: unknown): number | null {
  const qr = asAlignable(quoteResponse);
  const primaryOption = qr.primaryOption;
  const costDetails = primaryOption?.costDetails;
  const pricing = qr.pricing;
  for (const candidate of [
    costDetails?.totalPremium,
    primaryOption?.annualPremium,
    primaryOption?.totalPremium,
    pricing?.total,
    pricing?.annualPremium,
    qr.premium,
    costDetails?.subtotalNetPremium,
  ]) {
    const n = toFiniteNumber(candidate);
    if (n !== null && n !== 0) return n;
  }
  return null;
}

export function declaredPremiumFromEvaluation(evaluation: DeclaredPremiumAlignmentEvaluation): number | null {
  const declared = toFiniteNumber(evaluation.dto.premiumPayable);
  // Zero/negative totals are adjustment-line artefacts, never a term premium —
  // refuse to align rather than book a free policy.
  return declared !== null && declared > 0 ? declared : null;
}

/**
 * Returns a deep-copied quoteResponse whose persisted totals equal the
 * declared bordereau premium, with the calculator premium preserved in the
 * audit block and the delta surfaced as an explicit breakdown line.
 *
 * No declared premium on the row (or an already-matching calculator output
 * within €0.005) returns the input untouched.
 */
export function alignQuoteResponseToDeclaredPremium(args: {
  quoteResponse: unknown;
  evaluation: DeclaredPremiumAlignmentEvaluation;
  runId: string;
}): DeclaredPremiumAlignmentOutcome {
  const original = asAlignable(args.quoteResponse);
  const declaredPremium = declaredPremiumFromEvaluation(args.evaluation);
  const calculatorPremium = readCalculatorPremium(original);

  const unaligned: DeclaredPremiumAlignmentOutcome = {
    quoteResponse: original,
    applied: false,
    calculatorPremium,
    declaredPremium,
    adjustmentAmount: 0,
  };
  if (declaredPremium === null || calculatorPremium === null) return unaligned;

  const adjustmentAmount = round2(declaredPremium - calculatorPremium);
  if (Math.abs(adjustmentAmount) <= 0.005) return unaligned;

  const qr: AlignableQuoteResponse = JSON.parse(JSON.stringify(original));
  const po = qr.primaryOption;
  if (!po) {
    // No primaryOption means the adapter produced a shape we cannot align;
    // fail loudly instead of persisting a premium that contradicts the source.
    throw new Error('[declaredPremiumAlignment] quoteResponse.primaryOption is missing — cannot align declared premium');
  }
  const adjustmentType: 'loading' | 'discount' = adjustmentAmount >= 0 ? 'loading' : 'discount';

  const costDetails = po.costDetails;
  if (costDetails && costDetails.totalPremium !== undefined && costDetails.totalPremium !== null) {
    costDetails.totalPremium = declaredPremium;
  }
  if (po.annualPremium !== undefined && po.annualPremium !== null) po.annualPremium = declaredPremium;
  if (po.totalPremium !== undefined && po.totalPremium !== null) po.totalPremium = declaredPremium;
  if (po.noAddonGrossPremium !== undefined && po.noAddonGrossPremium !== null) po.noAddonGrossPremium = declaredPremium;
  if (po.monthlyPremium !== undefined && po.monthlyPremium !== null) po.monthlyPremium = round2(declaredPremium / 12);

  const breakdown = po.breakdown;
  if (breakdown && typeof breakdown === 'object') {
    const lines = Array.isArray(breakdown.lines) ? breakdown.lines : null;
    if (lines) {
      const totalLine = lines.find((line) => line && line.code === 'total');
      const alreadyPresent = lines.some((line) => line && line.code === 'adjustment.bdxDeclaredAlignment');
      if (!alreadyPresent) {
        const insertAt = totalLine ? lines.indexOf(totalLine) : lines.length;
        lines.splice(insertAt, 0, {
          code: 'adjustment.bdxDeclaredAlignment',
          kind: adjustmentType,
          label: 'Bordereau declared premium alignment',
          amount: adjustmentAmount,
        });
      }
      if (totalLine) totalLine.amount = declaredPremium;
    }
    if (breakdown.grossPremium !== undefined && breakdown.grossPremium !== null) breakdown.grossPremium = declaredPremium;
    breakdown.bdxDeclaredAlignment = adjustmentAmount;
  }

  const pricing = qr.pricing;
  if (pricing && typeof pricing === 'object') {
    if (pricing.total !== undefined && pricing.total !== null) pricing.total = declaredPremium;
    if (pricing.annualPremium !== undefined && pricing.annualPremium !== null) pricing.annualPremium = declaredPremium;
  }
  if (qr.premium !== undefined && qr.premium !== null) qr.premium = declaredPremium;

  qr.bdxPremiumAlignment = {
    appliedAt: new Date().toISOString(),
    origin: 'bdx-import',
    runId: args.runId,
    adjustmentType,
    adjustmentAmount,
    calculatorPremium,
    declaredPremium,
    source: {
      file: args.evaluation.dto.sourceFile || null,
      sheet: args.evaluation.dto.sourceSheetName,
      row: args.evaluation.dto.sourceRowNumber,
      ref: args.evaluation.dto.policyRef,
      txType: String(args.evaluation.dto.entry || '').trim().toUpperCase() || null,
    },
  };

  return {
    quoteResponse: qr,
    applied: true,
    calculatorPremium,
    declaredPremium,
    adjustmentAmount,
  };
}
