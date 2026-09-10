import { describe, expect, it } from 'vitest';
import {
  alignQuoteResponseToDeclaredPremium,
  declaredPremiumFromEvaluation,
  readCalculatorPremium,
  type DeclaredPremiumAlignmentEvaluation,
} from '../declaredPremiumAlignment.js';

type BreakdownLine = { code: string; kind: string; label: string; amount: number };

/** Typed view over the aligned quoteResponse for assertions. */
type AlignedQuoteResponse = {
  primaryOption: {
    annualPremium: number;
    monthlyPremium: number;
    costDetails: { totalPremium: number };
    breakdown: { grossPremium: number; bdxDeclaredAlignment?: number; lines: BreakdownLine[] };
  };
  pricing: { total: number };
  bdxPremiumAlignment?: {
    adjustmentType: string;
    adjustmentAmount: number;
    calculatorPremium: number;
    declaredPremium: number;
    origin: string;
    runId: string;
    source: { ref: string };
  };
};

function alignedView(quoteResponse: unknown): AlignedQuoteResponse {
  return quoteResponse as AlignedQuoteResponse;
}

function quoteResponseFixture(calculatorPremium: number) {
  return {
    primaryOption: {
      annualPremium: calculatorPremium,
      monthlyPremium: Math.round((calculatorPremium / 12) * 100) / 100,
      costDetails: { totalPremium: calculatorPremium, subtotalNetPremium: calculatorPremium * 0.8 },
      breakdown: {
        grossPremium: calculatorPremium,
        lines: [
          { code: 'base', kind: 'base', label: 'Base premium', amount: calculatorPremium * 0.9 },
          { code: 'ipt', kind: 'tax', label: 'IPT', amount: calculatorPremium * 0.1 },
          { code: 'total', kind: 'total', label: 'Total', amount: calculatorPremium },
        ],
      },
    },
    pricing: { total: calculatorPremium, annualPremium: calculatorPremium },
  };
}

function evaluationWith(premiumPayable: number | null, entry = 'NB'): DeclaredPremiumAlignmentEvaluation {
  return {
    dto: {
      premiumPayable,
      entry,
      policyRef: 'BRIT/ABG/00009999',
      sourceRowNumber: 7,
      sourceSheetName: 'Jul 26',
      sourceFile: 'travel-health-binder-july-26.xlsx',
    },
  };
}

describe('declaredPremiumAlignment (ADR-0056)', () => {
  it('applies a discount when the calculator over-prices the declared premium', () => {
    const outcome = alignQuoteResponseToDeclaredPremium({
      quoteResponse: quoteResponseFixture(140),
      evaluation: evaluationWith(100),
      runId: 'run-1',
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.adjustmentAmount).toBe(-40);

    const qr = alignedView(outcome.quoteResponse);
    expect(qr.primaryOption.annualPremium).toBe(100);
    expect(qr.primaryOption.costDetails.totalPremium).toBe(100);
    expect(qr.primaryOption.monthlyPremium).toBe(8.33);
    expect(qr.pricing.total).toBe(100);

    const audit = qr.bdxPremiumAlignment!;
    expect(audit.adjustmentType).toBe('discount');
    expect(audit.calculatorPremium).toBe(140);
    expect(audit.declaredPremium).toBe(100);
    expect(audit.origin).toBe('bdx-import');
    expect(audit.runId).toBe('run-1');
    expect(audit.source.ref).toBe('BRIT/ABG/00009999');

    const lines = qr.primaryOption.breakdown.lines;
    const adjustmentLine = lines.find((l) => l.code === 'adjustment.bdxDeclaredAlignment');
    expect(adjustmentLine).toMatchObject({ kind: 'discount', amount: -40 });
    // Adjustment line sits before the total line, and the total shows the declared premium.
    expect(lines.indexOf(adjustmentLine!)).toBeLessThan(lines.findIndex((l) => l.code === 'total'));
    expect(lines.find((l) => l.code === 'total')?.amount).toBe(100);
  });

  it('applies a loading when the calculator under-prices the declared premium', () => {
    const outcome = alignQuoteResponseToDeclaredPremium({
      quoteResponse: quoteResponseFixture(80),
      evaluation: evaluationWith(95.5),
      runId: 'run-2',
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.adjustmentAmount).toBe(15.5);
    const qr = alignedView(outcome.quoteResponse);
    expect(qr.bdxPremiumAlignment!.adjustmentType).toBe('loading');
    expect(qr.primaryOption.annualPremium).toBe(95.5);
  });

  it('leaves the quoteResponse untouched when calculator already matches within €0.005', () => {
    const original = quoteResponseFixture(100);
    const outcome = alignQuoteResponseToDeclaredPremium({
      quoteResponse: original,
      evaluation: evaluationWith(100.004),
      runId: 'run-3',
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.quoteResponse).toBe(original);
    expect(alignedView(outcome.quoteResponse).bdxPremiumAlignment).toBeUndefined();
  });

  it('refuses to align when the row has no positive declared premium', () => {
    for (const declared of [null, 0, -12.5]) {
      const outcome = alignQuoteResponseToDeclaredPremium({
        quoteResponse: quoteResponseFixture(100),
        evaluation: evaluationWith(declared),
        runId: 'run-4',
      });
      expect(outcome.applied).toBe(false);
      expect(outcome.declaredPremium).toBeNull();
    }
  });

  it('fails loudly when primaryOption is missing instead of persisting a contradicting premium', () => {
    expect(() => alignQuoteResponseToDeclaredPremium({
      quoteResponse: { pricing: { total: 100 } },
      evaluation: evaluationWith(140),
      runId: 'run-5',
    })).toThrow(/primaryOption is missing/);
  });

  it('reads the calculator premium with the same precedence as the list-index projection', () => {
    expect(readCalculatorPremium(quoteResponseFixture(123.45))).toBe(123.45);
    expect(readCalculatorPremium({ primaryOption: { annualPremium: 55 } })).toBe(55);
    expect(readCalculatorPremium({ pricing: { total: 77 } })).toBe(77);
    expect(readCalculatorPremium({})).toBeNull();
  });

  it('treats only positive finite premiumPayable as declared', () => {
    expect(declaredPremiumFromEvaluation(evaluationWith(250.75))).toBe(250.75);
    expect(declaredPremiumFromEvaluation(evaluationWith(0))).toBeNull();
    expect(declaredPremiumFromEvaluation(evaluationWith(null))).toBeNull();
  });

  it('is idempotent: a second alignment pass adds no duplicate breakdown line', () => {
    const first = alignQuoteResponseToDeclaredPremium({
      quoteResponse: quoteResponseFixture(140),
      evaluation: evaluationWith(100),
      runId: 'run-6',
    });
    // Second pass: declared now equals the persisted premium — no-op.
    const second = alignQuoteResponseToDeclaredPremium({
      quoteResponse: first.quoteResponse,
      evaluation: evaluationWith(100),
      runId: 'run-6',
    });
    expect(second.applied).toBe(false);
    const lines = alignedView(second.quoteResponse).primaryOption.breakdown.lines;
    expect(lines.filter((l) => l.code === 'adjustment.bdxDeclaredAlignment')).toHaveLength(1);
  });
});
