export type CoverageExcessRow = {
  coverage: string;
  amount: number;
};

export type CoverageExcessInput = {
  coverages: string[];
  quoteData: Record<string, unknown>;
  baseExcess: number;
};

const NO_EXCESS_COVERAGE_KEYWORDS = ['THIRD PARTY', 'ROADSIDE', 'BREAKDOWN', 'ASSISTANCE'] as const;
const OWN_DAMAGE_COVERAGE_KEYWORDS = ['COMPREHENSIVE', 'OWN DAMAGE', 'FIRE', 'THEFT'] as const;
const GLASS_COVERAGE_KEYWORDS = ['GLASS', 'WINDSCREEN'] as const;

function parseNumeric(value: unknown): number {
  const cleaned = String(value || '').replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMatch(normalizedCoverage: string, keywords: readonly string[]): boolean {
  return keywords.some((key) => normalizedCoverage.includes(key));
}

export function buildCoverageExcessRows(input: CoverageExcessInput): CoverageExcessRow[] {
  const { coverages, quoteData, baseExcess } = input;
  const rows: CoverageExcessRow[] = [];

  coverages.forEach((coverageRaw) => {
    const coverage = String(coverageRaw || '').trim();
    if (!coverage) return;
    const normalized = coverage.toUpperCase();

    if (normalized.includes('COMPREHENSIVE')) {
      rows.push({ coverage: 'Third Party Liability', amount: 0 });
      rows.push({ coverage: 'Own Damage', amount: baseExcess });
      return;
    }

    if (isMatch(normalized, NO_EXCESS_COVERAGE_KEYWORDS)) {
      rows.push({ coverage, amount: 0 });
      return;
    }

    if (isMatch(normalized, GLASS_COVERAGE_KEYWORDS)) {
      rows.push({
        coverage,
        amount: parseNumeric(
          quoteData.windscreenExcess ?? quoteData.glassExcess ?? quoteData.windscreenExcessAmount,
        ),
      });
      return;
    }

    if (isMatch(normalized, OWN_DAMAGE_COVERAGE_KEYWORDS)) {
      rows.push({ coverage, amount: baseExcess });
      return;
    }

    rows.push({ coverage, amount: baseExcess });
  });

  // Deduplicate by coverage label while preserving strongest amount.
  const deduped = new Map<string, CoverageExcessRow>();
  rows.forEach((row) => {
    const existing = deduped.get(row.coverage);
    if (!existing || row.amount > existing.amount) deduped.set(row.coverage, row);
  });
  return Array.from(deduped.values());
}
