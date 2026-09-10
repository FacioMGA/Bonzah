import { evaluateBdxMigrationImportRequest } from '../../../reporting/app/bdxImport/service.js';
import type { BdxRowEvaluation } from '../../../reporting/app/bdxImport/types.js';
import { assessExistingBdxPolicyCollision } from '../bdxImportRecovery.js';
import { buildBdxPolicyTermKey, buildPolicyHistoryMap, groupPolicyHistoryRows, markImportOutcome } from '../bdxImportRouteHelpers.js';
import { createBdxReplaySessionState, decideBdxReplayAction, markReplayRowApplied } from '../bdxReplayEngine.js';
import {
  findImportedEndorsementsByRowKeys,
  findImportedPoliciesByRowKeys,
  resolveBinderForEvaluation,
} from './bdxImportContext.js';
import { importPassingRow, importRenewalTermRow, replayEndorsementRow } from './bdxImportExecution.js';
import type { BdxImportLiveRunCommand } from './bdxImportTypes.js';

// This module owns orchestration only.
// It coordinates evaluation, chronology, and execution modules, but must not
// know about Express request/response types or HTTP status mapping.

function canonicalRowLookupKey(evaluation: Pick<BdxRowEvaluation, 'dto'>): string {
  return `${evaluation.dto.rowKey}::${evaluation.dto.sourceRowNumber}`;
}

// Lock-pressure throttle. Each `importPassingRow` cycle (Policy create,
// bind coverage, issue, projection sync) opens 4–5 short transactions
// AND enqueues 2–4 worker jobs (DOC.GENERATE_ISSUED_POLICY_PACK,
// POLICY.LIST_INDEX_UPDATE, …). At full throttle on a 5K-row chunk the
// downstream workers spawn faster than Postgres' `max_locks_per_transaction
// * max_connections` slot pool can release them — once it's saturated
// every BDX commit query returns 53200 "out of shared memory" and the
// whole import wedges. Default = 0 (no throttle, preserves existing
// behavior on small imports). Operators of large-scale BDX migrations
// set `BDX_IMPORT_ROW_THROTTLE_MS` on the import Job to 30–80ms; with
// a 5-pod x 5-concurrency worker pool that holds steady-state queue
// depth well within the lock-table ceiling.
const BDX_IMPORT_ROW_THROTTLE_MS = (() => {
  const raw = Number(process.env.BDX_IMPORT_ROW_THROTTLE_MS || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, 5_000);
})();

export async function executeBdxImportLiveRun(args: BdxImportLiveRunCommand): Promise<void> {
  const { result, request, runId, accountId, program, binders, context } = args;
  const affectedPolicyTermKeys = [...new Set(
    result.evaluations
      .map((evaluation) => buildBdxPolicyTermKey(evaluation))
      .filter(Boolean),
  )];
  const fullHistoryResult = await evaluateBdxMigrationImportRequest({
    request: {
      ...request,
      dryRun: true,
      startRow: undefined,
      endRow: undefined,
    },
    runId: `${runId}-history`,
    program,
  });
  const fullHistoryMap = buildPolicyHistoryMap(
    fullHistoryResult.evaluations.filter((evaluation) =>
      affectedPolicyTermKeys.includes(buildBdxPolicyTermKey(evaluation)),
    ),
  );
  const replayGroups = groupPolicyHistoryRows(result.evaluations);
  let importBudget = args.maxImports;

  for (const group of replayGroups) {
    const policyTermKey = group[0] ? buildBdxPolicyTermKey(group[0]) : '';
    const policyRef = String(group[0]?.dto.policyRef || '').trim();
    const fullPolicyHistory = fullHistoryMap.get(policyTermKey) || group;
    const canonicalByKey = new Map(
      fullPolicyHistory.map((evaluation) => [canonicalRowLookupKey(evaluation), evaluation])
    );
    const importedPolicyRows = await findImportedPoliciesByRowKeys(fullPolicyHistory.map((row) => row.dto.rowKey));
    const importedEndorsementRows = await findImportedEndorsementsByRowKeys(fullPolicyHistory.map((row) => row.dto.rowKey));
    const groupAssessment = await assessExistingBdxPolicyCollision({
      policyRef,
      evaluations: fullPolicyHistory,
    });
    const session = createBdxReplaySessionState(groupAssessment);

    for (let index = 0; index < group.length; index += 1) {
      const evaluation = group[index]!;
      const canonicalEvaluation = canonicalByKey.get(canonicalRowLookupKey(evaluation)) || evaluation;
      const importedPolicyRowAlreadyExists = importedPolicyRows.has(evaluation.dto.rowKey);
      const importedEndorsementRowAlreadyExists = importedEndorsementRows.has(evaluation.dto.rowKey);
      const decision = decideBdxReplayAction({
        evaluation: canonicalEvaluation,
        policyHistory: fullPolicyHistory,
        session,
        importedPolicyRowAlreadyExists,
        importedEndorsementRowAlreadyExists,
      });

      if (decision.action === 'already_applied') {
        markReplayRowApplied(session, canonicalEvaluation, groupAssessment.policyId || undefined);
        markImportOutcome(result, evaluation, {
          status: 'already_imported',
          policyId: groupAssessment.policyId || undefined,
        });
        continue;
      }

      if (
        decision.action === 'blocked_existing_history'
        || decision.action === 'blocked_prior_row_failed'
        || decision.action === 'blocked_transaction_row_without_base'
      ) {
        markImportOutcome(result, evaluation, {
          status: decision.outcomeStatus,
          reason: decision.reason,
          policyId: groupAssessment.policyId || undefined,
        });
        if (evaluation.result !== 'FAIL') {
          evaluation.gaps.push({
            rowId: evaluation.dto.sourceId,
            policyRef: evaluation.dto.policyRef,
            category: 'DOMAIN',
            severity: 'Critical',
            message: decision.reason || 'Policy generation failed',
          });
          evaluation.result = 'FAIL';
        }
        continue;
      }

      if (decision.action === 'defer_waiting_for_prior_row') {
        markImportOutcome(result, evaluation, {
          status: decision.outcomeStatus,
          reason: decision.reason,
          policyId: groupAssessment.policyId || undefined,
        });
        continue;
      }

      if (evaluation.result === 'FAIL') {
        markImportOutcome(result, evaluation, {
          status: 'failed_with_reason',
          reason: evaluation.gaps[0]?.message || 'Failed during import',
        });
        continue;
      }
      if (importBudget <= 0) {
        markImportOutcome(result, evaluation, {
          status: 'failed_with_reason',
          reason: 'Skipped due to maxImports limit',
        });
        continue;
      }

      let imported:
        | Awaited<ReturnType<typeof importPassingRow>>
        | Awaited<ReturnType<typeof importRenewalTermRow>>
        | Awaited<ReturnType<typeof replayEndorsementRow>>;
      try {
        imported = decision.action === 'create_base'
          ? await importPassingRow({
            evaluation,
            request,
            programId: program.id,
            binderId: resolveBinderForEvaluation({ evaluation, binders })?.id || '',
            accountId,
            runId,
            context,
            bindMode: 'coverage',
          })
          : decision.action === 'replay_renewal'
            ? await importRenewalTermRow({
              evaluation,
              request,
              priorPolicyId: session.policyId || groupAssessment.policyId || '',
              binderId: resolveBinderForEvaluation({ evaluation, binders })?.id || '',
              runId,
              context,
            })
            : await replayEndorsementRow({
              evaluation,
              runId,
              policyId: session.policyId || groupAssessment.policyId,
              context,
            });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        markImportOutcome(result, evaluation, {
          status: 'failed_with_reason',
          reason: message,
        });
        evaluation.gaps.push({
          rowId: evaluation.dto.sourceId,
          policyRef: evaluation.dto.policyRef,
          category: 'DOMAIN',
          severity: 'Critical',
          message: `Policy generation failed: ${message}`,
        });
        evaluation.result = 'FAIL';
        continue;
      }

      if (imported.status !== 'already_imported') {
        importBudget -= 1;
        if (BDX_IMPORT_ROW_THROTTLE_MS > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, BDX_IMPORT_ROW_THROTTLE_MS));
        }
      }
      if (imported.policyId) {
        if (
          imported.status !== 'already_imported'
          && (decision.action === 'create_base' || decision.action === 'replay_renewal')
        ) {
          result.summary.generatedPolicyIds.push(imported.policyId);
        }
        markReplayRowApplied(session, canonicalEvaluation, imported.policyId);
        markImportOutcome(result, evaluation, {
          status: imported.status || 'imported',
          policyId: imported.policyId,
          ...(imported.projectionWarning ? { reason: imported.projectionWarning } : {}),
        });
      } else if (imported.error) {
        markImportOutcome(result, evaluation, {
          status: 'failed_with_reason',
          reason: imported.error,
        });
        evaluation.gaps.push({
          rowId: evaluation.dto.sourceId,
          policyRef: evaluation.dto.policyRef,
          category: 'DOMAIN',
          severity: 'Critical',
          message: `Policy generation failed: ${imported.error}`,
        });
        evaluation.result = 'FAIL';
      }
    }
  }

  for (const outcome of result.outputs.importOutcomes) {
    if (outcome.status !== 'skipped') continue;
    const evaluation = result.evaluations.find((e) =>
      e.dto.sourceId === outcome.rowId
      && e.dto.policyRef === outcome.policyRef
      && e.dto.sourceRowNumber === outcome.sourceRowNumber,
    );
    if (!evaluation) continue;
    if (evaluation.result === 'PASS') {
      outcome.status = 'failed_with_reason';
      outcome.reason = 'Skipped due to maxImports limit';
      continue;
    }
    if (evaluation.result === 'FAIL') {
      outcome.status = 'failed_with_reason';
      outcome.reason = evaluation.gaps[0]?.message || 'Failed during import';
    }
  }

  result.summary.importedRows = result.outputs.importOutcomes.filter((outcome) => outcome.status === 'imported').length;
}
