import type { BdxImportOutcomeStatus, BdxRowEvaluation } from '../../reporting/app/bdxImport/types.js';

function policyRowTimestamp(evaluation: BdxRowEvaluation): number {
  const booked = evaluation.dto.bookedDate ? new Date(evaluation.dto.bookedDate).getTime() : NaN;
  if (Number.isFinite(booked)) return booked;
  const inception = evaluation.dto.inceptionDate ? new Date(evaluation.dto.inceptionDate).getTime() : NaN;
  if (Number.isFinite(inception)) return inception;
  return evaluation.dto.sourceRowNumber;
}

function normalizeTermDate(value: string): string {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().split('T')[0] || '';
}

export function buildBdxPolicyTermKey(evaluation: Pick<BdxRowEvaluation, 'dto'>): string {
  const policyRef = String(evaluation.dto.policyRef || '').trim() || evaluation.dto.rowKey;
  const inception = normalizeTermDate(evaluation.dto.inceptionDate);
  const expiry = normalizeTermDate(evaluation.dto.expiryDate);
  const booked = normalizeTermDate(evaluation.dto.bookedDate);
  const term = inception && expiry ? `${inception}_${expiry}` : inception || expiry || booked || `row_${evaluation.dto.sourceRowNumber}`;
  return `${policyRef}::${term}`;
}

export function groupPolicyHistoryRows(evaluations: BdxRowEvaluation[]): BdxRowEvaluation[][] {
  const groups = new Map<string, BdxRowEvaluation[]>();
  for (const evaluation of evaluations) {
    const key = buildBdxPolicyTermKey(evaluation);
    const bucket = groups.get(key) || [];
    bucket.push(evaluation);
    groups.set(key, bucket);
  }
  return [...groups.values()]
    .map((rows) =>
      rows.slice().sort((a, b) => {
        const delta = policyRowTimestamp(a) - policyRowTimestamp(b);
        if (delta !== 0) return delta;
        return a.dto.sourceRowNumber - b.dto.sourceRowNumber;
      }),
    )
    .sort((a, b) => policyRowTimestamp(a[0]!) - policyRowTimestamp(b[0]!));
}

export function buildPolicyHistoryMap(evaluations: BdxRowEvaluation[]): Map<string, BdxRowEvaluation[]> {
  const historyGroups = groupPolicyHistoryRows(evaluations);
  const historyMap = new Map<string, BdxRowEvaluation[]>();
  for (const rows of historyGroups) {
    const first = rows[0];
    if (!first) continue;
    historyMap.set(buildBdxPolicyTermKey(first), rows);
  }
  return historyMap;
}

function findImportOutcomeIndex(
  result: { outputs: { importOutcomes: Array<{ rowId: string; policyRef: string; sourceRowNumber: number }> } },
  evaluation: BdxRowEvaluation,
): number {
  return result.outputs.importOutcomes.findIndex((x) =>
    x.rowId === evaluation.dto.sourceId
    && x.policyRef === evaluation.dto.policyRef
    && x.sourceRowNumber === evaluation.dto.sourceRowNumber,
  );
}

export function markImportOutcome(
  result: {
    outputs: {
      importOutcomes: Array<{
        rowId: string;
        policyRef: string;
        sourceRowNumber: number;
        status: BdxImportOutcomeStatus;
        policyId?: string;
        reason?: string;
      }>;
    };
  },
  evaluation: BdxRowEvaluation,
  patch: {
    status: BdxImportOutcomeStatus;
    policyId?: string;
    reason?: string;
  },
): void {
  const idx = findImportOutcomeIndex(result, evaluation);
  if (idx < 0) return;
  result.outputs.importOutcomes[idx] = {
    ...result.outputs.importOutcomes[idx],
    ...patch,
  };
}
