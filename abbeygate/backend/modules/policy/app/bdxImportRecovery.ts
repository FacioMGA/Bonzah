import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { BdxRowEvaluation } from '../../reporting/app/bdxImport/types.js';

type JsonRecord = Record<string, unknown>;

type BdxImportMeta = {
  rowKey: string;
  sourceRowNumber: number | null;
  sourcePolicyRef: string | null;
};

type RiskTransactionBdxMeta = BdxImportMeta & {
  riskTransactionId: string;
  transactionNumber: number;
};

export type ExistingBdxPolicyCollisionClassification =
  | 'no_existing_policy'
  | 'idempotent_match'
  | 'missing_replay'
  | 'base_row_mismatch'
  | 'history_order_mismatch'
  | 'unsafe_to_touch';

export type ExistingBdxPolicyCollisionAssessment = {
  classification: ExistingBdxPolicyCollisionClassification;
  policyId: string | null;
  reason: string;
  expectedBaseRowKey: string | null;
  expectedBaseSourceRowNumber: number | null;
  actualBaseRowKey: string | null;
  actualBaseSourceRowNumber: number | null;
  expectedReplayRowNumbers: number[];
  existingReplayRowNumbers: number[];
  missingReplayRowNumbers: number[];
};

function asJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function toNullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function policyRowTimestamp(evaluation: BdxRowEvaluation): number {
  const booked = evaluation.dto.bookedDate ? new Date(evaluation.dto.bookedDate).getTime() : NaN;
  if (Number.isFinite(booked)) return booked;
  const inception = evaluation.dto.inceptionDate ? new Date(evaluation.dto.inceptionDate).getTime() : NaN;
  if (Number.isFinite(inception)) return inception;
  return evaluation.dto.sourceRowNumber;
}

function orderedGroupRows(evaluations: BdxRowEvaluation[]): BdxRowEvaluation[] {
  return evaluations.slice().sort((a, b) => {
    const delta = policyRowTimestamp(a) - policyRowTimestamp(b);
    if (delta !== 0) return delta;
    return a.dto.sourceRowNumber - b.dto.sourceRowNumber;
  });
}

function readPolicyBdxMeta(snapshot: unknown): BdxImportMeta {
  const root = asJsonRecord(snapshot);
  const bdxImport = asJsonRecord(root.bdxImport);
  return {
    rowKey: String(bdxImport.rowKey || '').trim(),
    sourceRowNumber: toNullableNumber(bdxImport.sourceRowNumber),
    sourcePolicyRef: String(bdxImport.sourcePolicyRef || '').trim() || null,
  };
}

function readRiskTransactionBdxMeta(snapshot: unknown, riskTransactionId: string, transactionNumber: number): RiskTransactionBdxMeta | null {
  const root = asJsonRecord(snapshot);
  const endorsementMeta = asJsonRecord(root.endorsementMeta);
  const bdxImport = asJsonRecord(endorsementMeta.bdxImport);
  const rowKey = String(bdxImport.rowKey || '').trim();
  if (!rowKey) return null;
  return {
    riskTransactionId,
    transactionNumber,
    rowKey,
    sourceRowNumber: toNullableNumber(bdxImport.sourceRowNumber),
    sourcePolicyRef: String(bdxImport.sourcePolicyRef || '').trim() || null,
  };
}

function arrayEquals(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isPrefix(prefix: string[], values: string[]): boolean {
  return prefix.length <= values.length && prefix.every((value, index) => value === values[index]);
}

export async function findImportedEndorsementByRowKey(rowKey: string): Promise<{ policyId: string; riskTransactionId: string } | null> {
  const normalized = String(rowKey || '').trim();
  if (!normalized) return null;
  const existing = await tenantScopedPrisma.riskTransaction.findFirst({
    where: {
      transactionType: 'ENDORSEMENT',
      OR: [
        {
          snapshotFinal: {
            path: ['endorsementMeta', 'bdxImport', 'rowKey'],
            equals: normalized,
          },
        },
        {
          snapshotDraft: {
            path: ['endorsementMeta', 'bdxImport', 'rowKey'],
            equals: normalized,
          },
        },
      ],
    },
    select: { id: true, policyId: true },
  });
  return existing ? { policyId: existing.policyId, riskTransactionId: existing.id } : null;
}

export async function assessExistingBdxPolicyCollision(args: {
  policyRef: string;
  evaluations: BdxRowEvaluation[];
}): Promise<ExistingBdxPolicyCollisionAssessment> {
  const policyRef = String(args.policyRef || '').trim();
  const ordered = orderedGroupRows(args.evaluations);
  const expectedBase = ordered[0] || null;
  const expectedReplayRows = ordered
    .slice(1)
    .filter((evaluation) => evaluation.result !== 'FAIL')
    .map((evaluation) => ({
      rowKey: evaluation.dto.rowKey,
      sourceRowNumber: evaluation.dto.sourceRowNumber,
    }));
  const emptyAssessment: ExistingBdxPolicyCollisionAssessment = {
    classification: 'no_existing_policy',
    policyId: null,
    reason: 'Policy number does not exist yet.',
    expectedBaseRowKey: expectedBase?.dto.rowKey || null,
    expectedBaseSourceRowNumber: expectedBase?.dto.sourceRowNumber ?? null,
    actualBaseRowKey: null,
    actualBaseSourceRowNumber: null,
    expectedReplayRowNumbers: expectedReplayRows.map((row) => row.sourceRowNumber),
    existingReplayRowNumbers: [],
    missingReplayRowNumbers: expectedReplayRows.map((row) => row.sourceRowNumber),
  };
  if (!policyRef || !expectedBase) return emptyAssessment;

  const existingPolicies = await tenantScopedPrisma.policy.findMany({
    where: { policyNumber: policyRef },
    orderBy: [{ renewalSequence: 'asc' }, { inceptionDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      stateCurrent: { select: { snapshot: true } },
      riskTransactions: {
        where: { transactionType: 'ENDORSEMENT' },
        select: {
          id: true,
          transactionNumber: true,
          snapshotDraft: true,
          snapshotFinal: true,
        },
        orderBy: { transactionNumber: 'asc' },
      },
    },
  });
  if (existingPolicies.length === 0) return emptyAssessment;

  const basePolicy = existingPolicies[0]!;
  const latestPolicy = existingPolicies[existingPolicies.length - 1]!;
  const baseMeta = readPolicyBdxMeta(basePolicy.stateCurrent?.snapshot);
  const existingPolicyTermMeta = existingPolicies
    .slice(1)
    .map((policy) => {
      const policyMeta = readPolicyBdxMeta(policy.stateCurrent?.snapshot);
      return policyMeta.rowKey
        ? {
            riskTransactionId: policy.id,
            transactionNumber: 1,
            rowKey: policyMeta.rowKey,
            sourceRowNumber: policyMeta.sourceRowNumber,
            sourcePolicyRef: policyMeta.sourcePolicyRef,
          }
        : null;
    })
    .filter((value): value is RiskTransactionBdxMeta => Boolean(value));
  const existingReplayMeta = existingPolicies
    .flatMap((policy) => policy.riskTransactions)
    .map((riskTransaction) =>
      readRiskTransactionBdxMeta(
        riskTransaction.snapshotFinal ?? riskTransaction.snapshotDraft,
        riskTransaction.id,
        riskTransaction.transactionNumber,
      ),
    );
  const bdxReplayMeta = [
    ...existingPolicyTermMeta,
    ...existingReplayMeta.filter((value): value is RiskTransactionBdxMeta => Boolean(value)),
  ];
  const existingEndorsementRows = existingPolicies.flatMap((policy) => policy.riskTransactions);
  const hasNonBdxReplayRows = existingEndorsementRows.length !== existingReplayMeta.filter(Boolean).length;
  const expectedReplayRowKeys = expectedReplayRows.map((row) => row.rowKey);
  const existingReplayRowKeys = bdxReplayMeta.map((row) => row.rowKey);
  const expectedReplayRowNumbers = expectedReplayRows.map((row) => row.sourceRowNumber);
  const existingReplayRowNumbers = bdxReplayMeta
    .map((row) => row.sourceRowNumber)
    .filter((value): value is number => Number.isFinite(value));
  const missingReplayRowNumbers = expectedReplayRows
    .filter((row) => !existingReplayRowKeys.includes(row.rowKey))
    .map((row) => row.sourceRowNumber);

  const baseAssessment = {
    policyId: latestPolicy.id,
    expectedBaseRowKey: expectedBase.dto.rowKey,
    expectedBaseSourceRowNumber: expectedBase.dto.sourceRowNumber,
    actualBaseRowKey: baseMeta.rowKey,
    actualBaseSourceRowNumber: baseMeta.sourceRowNumber,
    expectedReplayRowNumbers,
    existingReplayRowNumbers,
    missingReplayRowNumbers,
  };

  if (!baseMeta.rowKey) {
    return {
      classification: 'unsafe_to_touch',
      reason: 'Existing policy has no BDX base metadata.',
      ...baseAssessment,
    };
  }

  if (
    baseMeta.rowKey !== expectedBase.dto.rowKey ||
    baseMeta.sourceRowNumber !== expectedBase.dto.sourceRowNumber
  ) {
    return {
      classification: 'base_row_mismatch',
      reason: 'Existing policy base row does not match the expected original BDX row.',
      ...baseAssessment,
    };
  }

  if (hasNonBdxReplayRows) {
    return {
      classification: 'unsafe_to_touch',
      reason: 'Existing policy has endorsement history without BDX replay metadata.',
      ...baseAssessment,
    };
  }

  if (!isPrefix(existingReplayRowKeys, expectedReplayRowKeys)) {
    return {
      classification: 'history_order_mismatch',
      reason: 'Existing endorsement replay order does not match the expected BDX chronology.',
      ...baseAssessment,
    };
  }

  if (arrayEquals(existingReplayRowKeys, expectedReplayRowKeys)) {
    return {
      classification: 'idempotent_match',
      reason: 'Existing policy base row and endorsement order already match the BDX history.',
      ...baseAssessment,
    };
  }

  return {
    classification: 'missing_replay',
    reason: 'Existing policy base row matches, but one or more replayable endorsements are still missing.',
    ...baseAssessment,
  };
}
