import { asRecord } from '@/src/shared/lib/record';

export type ManualProposalRow = {
  code?: string;
  coverage: string;
  limit: string;
  excess: string;
  premium: string;
  notes: string;
  source?: string;
};

export type ManualProposalCompleteness = {
  rows: ManualProposalRow[];
  totalPremium: number;
  missing: string[];
  readyToSend: boolean;
};

const BUSINESS_COVERAGE_CODES = {
  property: 'BUSINESS-PROPERTY',
  stock: 'BUSINESS-STOCK',
  equipment: 'BUSINESS-EQUIPMENT',
  publicLiability: 'BUSINESS-PUBLIC-LIABILITY',
  employersLiability: 'BUSINESS-EMPLOYERS-LIABILITY',
  businessInterruption: 'BUSINESS-BUSINESS-INTERRUPTION',
  legalAssistance: 'BUSINESS-LEGAL-ASSISTANCE',
} as const;

export const EMPTY_MANUAL_PROPOSAL_ROW: ManualProposalRow = {
  coverage: '',
  limit: '',
  excess: '',
  premium: '',
  notes: '',
};

export function normalizeManualProposalRow(value: unknown): ManualProposalRow {
  const row = asRecord(value);
  return {
    code: String(row.code || '').trim() || undefined,
    coverage: String(row.coverage || row.section || ''),
    limit: String(row.limit || ''),
    excess: String(row.excess || ''),
    premium: String(row.premium ?? ''),
    notes: String(row.notes || ''),
    source: String(row.source || '').trim() || undefined,
  };
}

export function normalizeManualProposalRows(value: unknown): ManualProposalRow[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeManualProposalRow).filter(hasMeaningfulRow);
}

export function rowPremium(row: Pick<ManualProposalRow, 'premium'>): number {
  const amount = Number(String(row.premium || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export function totalManualPremium(rows: Array<Pick<ManualProposalRow, 'premium'>>): number {
  return rows.reduce((sum, row) => sum + rowPremium(row), 0);
}

export function prepareManualProposalRows(rows: ManualProposalRow[]): ReturnType<typeof asRecord>[] {
  return rows
    .map((row) => ({
      ...(row.code ? { code: row.code } : {}),
      coverage: row.coverage.trim(),
      limit: row.limit.trim(),
      excess: row.excess.trim(),
      premium: rowPremium(row),
      notes: row.notes.trim(),
      ...(row.source ? { source: row.source } : {}),
    }))
    .filter((row) => Boolean(row.code || row.coverage || row.limit || row.excess || Number(row.premium) > 0 || row.notes));
}

export function buildBusinessProposalRowsFromQuoteData(quoteData: unknown, selectedCoverageCodes: string[] = []): ManualProposalRow[] {
  const coverage = asRecord(asRecord(quoteData).coverage);
  const rows: ManualProposalRow[] = [];
  const selectedCodes = new Set(selectedCoverageCodes.map((code) => String(code || '').trim().toUpperCase()).filter(Boolean));
  const isExplicitlySelected = (code: string) => selectedCodes.has(code.toUpperCase());
  const pushAmount = (code: string, label: string, amountValue: unknown) => {
    const amount = numeric(amountValue);
    if (amount <= 0 && !isExplicitlySelected(code)) return;
    rows.push({
      code,
      coverage: label,
      limit: amount > 0 ? formatAmount(amount) : '',
      excess: '',
      premium: '',
      notes: '',
      source: 'questionnaire',
    });
  };

  pushAmount(BUSINESS_COVERAGE_CODES.property, 'Property cover', coverage.buildings);
  pushAmount(BUSINESS_COVERAGE_CODES.stock, 'Stock cover', coverage.stock);
  pushAmount(BUSINESS_COVERAGE_CODES.equipment, 'Equipment cover', coverage.equipment);

  if (isYes(coverage.publicLiability) || isExplicitlySelected(BUSINESS_COVERAGE_CODES.publicLiability)) {
    rows.push({
      code: BUSINESS_COVERAGE_CODES.publicLiability,
      coverage: 'Public liability',
      limit: formatLimit(coverage.publicLiabilityLimit),
      excess: '',
      premium: '',
      notes: '',
      source: 'questionnaire',
    });
  }

  if (isYes(coverage.employersLiability) || isExplicitlySelected(BUSINESS_COVERAGE_CODES.employersLiability)) {
    rows.push({
      code: BUSINESS_COVERAGE_CODES.employersLiability,
      coverage: 'Employers liability',
      limit: formatLimit(coverage.employersLiabilityLimit),
      excess: '',
      premium: '',
      notes: '',
      source: 'questionnaire',
    });
  }

  if (isYes(coverage.businessInterruption) || isExplicitlySelected(BUSINESS_COVERAGE_CODES.businessInterruption)) {
    rows.push({
      code: BUSINESS_COVERAGE_CODES.businessInterruption,
      coverage: 'Business interruption',
      limit: formatLimit(coverage.businessInterruptionLimit),
      excess: '',
      premium: '',
      notes: '',
      source: 'questionnaire',
    });
  }

  if (isYes(coverage.legalAssistance) || isExplicitlySelected(BUSINESS_COVERAGE_CODES.legalAssistance)) {
    rows.push({
      code: BUSINESS_COVERAGE_CODES.legalAssistance,
      coverage: 'Legal assistance',
      limit: 'Included',
      excess: '',
      premium: '',
      notes: '',
      source: 'questionnaire',
    });
  }

  return dedupeRows(rows);
}

export function selectedCoverageCodesFromSelection(coverageSelection: unknown): string[] {
  const selection = asRecord(coverageSelection);
  const selected = asRecord(selection.selected);
  const defaults = asRecord(asRecord(selection.defaults).selected);
  const resolved = asRecord(selection.resolvedCoverageSet);
  const selectedCodes = Array.isArray(resolved.selectedCodes) ? resolved.selectedCodes : [];
  const applied = Array.isArray(selection.applied) ? selection.applied : [];
  return Array.from(new Set([
    ...Object.entries(selected)
      .filter(([, value]) => value === true)
      .map(([code]) => code),
    ...Object.entries(defaults)
      .filter(([, value]) => value === true)
      .map(([code]) => code),
    ...selectedCodes.map((code) => String(code || '').trim()).filter(Boolean),
    ...applied.map((item) => String(asRecord(item).code || '').trim()).filter(Boolean),
  ]));
}

export function effectiveCoverageSelectionFromPolicy(policy: unknown): unknown {
  const record = asRecord(policy);
  const directSelection = asRecord(record.coverageSelection);
  if (Object.keys(directSelection).length > 0) return directSelection;
  return asRecord(asRecord(record.stateSnapshot).coverageSelection);
}

export function seedManualProposalRows(quoteData: unknown, productTypeHint?: string, coverageSelection?: unknown): ManualProposalRow[] {
  const productType = String(productTypeHint || asRecord(quoteData).productType || '').trim().toUpperCase();
  if (productType && productType !== 'BUSINESS') return [];
  return buildBusinessProposalRowsFromQuoteData(quoteData, selectedCoverageCodesFromSelection(coverageSelection));
}

export function mergeManualProposalRowsFromQuestionnaire(currentRows: ManualProposalRow[], seedRows: ManualProposalRow[]): ManualProposalRow[] {
  if (seedRows.length === 0) return currentRows.length > 0 ? currentRows : [{ ...EMPTY_MANUAL_PROPOSAL_ROW }];
  const currentByKey = new Map(currentRows.map((row) => [rowKey(row), row]));
  const seedKeys = new Set(seedRows.map(rowKey));
  const mergedSeedRows = seedRows.map((seed) => {
    const existing = currentByKey.get(rowKey(seed));
    if (!existing) return seed;
    return {
      ...seed,
      limit: existing.limit || seed.limit,
      excess: existing.excess,
      premium: existing.premium,
      notes: existing.notes || seed.notes,
    };
  });
  const manualExtraRows = currentRows.filter((row) => {
    if (!hasMeaningfulRow(row)) return false;
    if (seedKeys.has(rowKey(row))) return false;
    return row.source !== 'questionnaire';
  });
  return [...mergedSeedRows, ...manualExtraRows];
}

export function manualProposalCompleteness(quoteData: unknown, rows: ManualProposalRow[]): ManualProposalCompleteness {
  const proposal = asRecord(asRecord(quoteData).proposal);
  const activeRows = rows.filter(hasMeaningfulRow);
  const missing: string[] = [];
  if (activeRows.length === 0) missing.push('Add at least one coverage row');
  if (!String(proposal.marketName || '').trim()) missing.push('Add market / insurer');
  for (const row of activeRows) {
    const label = row.coverage.trim() || row.code || 'Coverage row';
    if (!row.coverage.trim()) missing.push('Add coverage name');
    if (rowPremium(row) <= 0) missing.push(`Add premium for ${label}`);
    if (!row.excess.trim()) missing.push(`Add excess for ${label}`);
  }
  return {
    rows: activeRows,
    totalPremium: totalManualPremium(activeRows),
    missing: Array.from(new Set(missing)),
    readyToSend: missing.length === 0,
  };
}

function hasMeaningfulRow(row: ManualProposalRow): boolean {
  return Boolean(row.code || row.coverage.trim() || row.limit.trim() || row.excess.trim() || rowPremium(row) > 0 || row.notes.trim());
}

function rowKey(row: ManualProposalRow): string {
  return String(row.code || row.coverage).trim().toUpperCase();
}

function dedupeRows(rows: ManualProposalRow[]): ManualProposalRow[] {
  const seen = new Set<string>();
  const out: ManualProposalRow[] = [];
  for (const row of rows) {
    const key = rowKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function isYes(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'yes' || normalized === 'true';
}

function numeric(value: unknown): number {
  const amount = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function formatAmount(amount: number): string {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatLimit(value: unknown): string {
  const amount = numeric(value);
  return amount > 0 ? formatAmount(amount) : '';
}
