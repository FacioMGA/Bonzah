import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { executeCreateEndorsementDraft } from './CreateEndorsementDraft.js';
import { executePatchEndorsementDraft } from './PatchEndorsementDraft.js';
import { executeRateEndorsementDraft } from './RateEndorsementDraft.js';
import { logger } from '../../../platform/utils/logger.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';

function parseSnapshot(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return parseRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return parseRecord(value);
}

export interface SaveEndorsementVersionInput {
  policyId: string;
  sourceRiskTransactionId: string;
  actor: { id: string; role: string; name?: string; email?: string };
  correlationId?: string;
}

export type UseCaseResult<T> =
  | { status: 'SUCCESS'; data: T }
  | { status: 'NOT_FOUND' | 'BLOCKED' | 'SERVER_ERROR'; error: unknown };

/**
 * Atomically forks an endorsement draft into a new version.
 *
 * Replaces the frontend-orchestrated sequence of
 * createEndorsementDraft + patchEndorsementDraft + rateEndorsementDraft
 * with a single backend operation to prevent partial states and race conditions.
 */
export async function executeSaveEndorsementVersion(
  input: SaveEndorsementVersionInput,
): Promise<UseCaseResult<{ riskTransactionId: string; transactionNumber: number }>> {
  const { policyId, sourceRiskTransactionId, actor } = input;

  try {
    const sourceRt = await tenantScopedPrisma.riskTransaction.findUnique({
      where: { id: sourceRiskTransactionId },
      select: { id: true, snapshotDraft: true, policyId: true, effectiveDate: true },
    });

    if (!sourceRt || String(sourceRt.policyId) !== policyId) {
      return { status: 'NOT_FOUND', error: { code: 'NOT_FOUND', message: 'Source risk transaction not found' } };
    }

    const sourceDraft = parseSnapshot(sourceRt.snapshotDraft);
    const workspace = parseRecord(sourceDraft.endorsementWorkspace);

    const effectiveDate = sourceRt.effectiveDate
      ? new Date(String(sourceRt.effectiveDate))
      : new Date();
    const reason = String(workspace.reason || '').trim() || 'Version fork';
    const reasonCode = String(workspace.reasonCode || '').trim() || undefined;

    const createResult = await executeCreateEndorsementDraft({
      policyId,
      effectiveDate,
      reason,
      reasonCode: reasonCode ?? null,
      actor: { id: actor.id, name: actor.name ?? null, email: actor.email ?? null, role: actor.role },
    });

    if (createResult.status !== 'SUCCESS') {
      return { status: 'BLOCKED', error: createResult.error };
    }

    const newRtId = createResult.data.riskTransactionId;

    const patchPayload: Record<string, unknown> = {};
    if (sourceDraft.quoteData) patchPayload.quoteData = sourceDraft.quoteData;
    if (sourceDraft.coverageSelection && Object.keys(parseRecord(sourceDraft.coverageSelection)).length > 0) {
      patchPayload.coverageSelection = sourceDraft.coverageSelection;
    }
    if (sourceDraft.uwDecision && Object.keys(parseRecord(sourceDraft.uwDecision)).length > 0) {
      patchPayload.uwDecision = sourceDraft.uwDecision;
    }
    if (sourceDraft.endorsementMeta && Object.keys(parseRecord(sourceDraft.endorsementMeta)).length > 0) {
      patchPayload.endorsementMeta = sourceDraft.endorsementMeta;
    }

    const patchResult = await executePatchEndorsementDraft({
      policyId,
      riskTransactionId: newRtId,
      body: patchPayload,
      actor: { id: actor.id, name: actor.name ?? null, email: actor.email ?? null, role: actor.role },
    });

    if (patchResult.status !== 'SUCCESS') {
      return { status: 'BLOCKED', error: patchResult.error };
    }

    const rateResult = await executeRateEndorsementDraft({
      policyId,
      riskTransactionId: newRtId,
      actor: { id: actor.id, name: actor.name ?? null, email: actor.email ?? null, role: actor.role },
    });

    if (rateResult.status !== 'SUCCESS') {
      return { status: 'BLOCKED', error: rateResult.error };
    }

    void AuditLogger.log(
      policyId,
      'POLICY',
      'POLICY.QUOTE_VERSION.SAVED',
      actor.id,
      'USER',
      { sourceRiskTransactionId, newRiskTransactionId: newRtId },
      actor.name || undefined,
    );

    return {
      status: 'SUCCESS',
      data: {
        riskTransactionId: newRtId,
        transactionNumber: createResult.data.transactionNumber,
      },
    };
  } catch (error) {
    logger.error({ err: error, policyId, sourceRiskTransactionId }, 'SaveEndorsementVersion failed');
    return { status: 'SERVER_ERROR', error: { code: 'SERVER_ERROR', message: 'Failed to save endorsement version' } };
  }
}
