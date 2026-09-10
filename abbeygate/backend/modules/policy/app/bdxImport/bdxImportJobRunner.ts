import type { BdxImportRequest, BdxImportResult } from '../../../reporting/app/bdxImport/types.js';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { evaluateBdxMigrationImportRequest } from '../../../reporting/app/bdxImport/service.js';
import { executeBdxImportLiveRun } from './bdxImportOrchestrator.js';
import { resolveProgramBinder } from './bdxImportContext.js';
import {
  appendBdxImportJobLog,
  getBdxImportJob,
  updateBdxImportJob,
  upsertBdxImportJobResult,
} from './bdxImportJobRepository.js';

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function summarizeResult(result: BdxImportResult) {
  const failedRows = result.evaluations.filter((evaluation) => evaluation.result === 'FAIL').length;
  const successRows = result.evaluations.length - failedRows;
  return {
    totalRows: result.evaluations.length,
    processedRows: result.evaluations.length,
    successRows,
    failedRows,
    summaryJson: result.summary,
  };
}

async function resolveWorkerSourceFile(job: NonNullable<Awaited<ReturnType<typeof getBdxImportJob>>>): Promise<string> {
  try {
    await fs.access(job.sourceFilePath);
    return job.sourceFilePath;
  } catch {
    if (!job.sourceFileBytes) throw new Error(`BDX source file is not available to worker: ${job.sourceFilePath}`);
  }
  const safeName = path.basename(job.sourceFilePath || `bdx-${job.id}.xlsx`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const tmpPath = path.join(os.tmpdir(), `bdx-job-${job.id}-${safeName}`);
  await fs.writeFile(tmpPath, Buffer.from(job.sourceFileBytes));
  return tmpPath;
}

async function writeFailureLogs(jobId: string, result: BdxImportResult): Promise<void> {
  for (const evaluation of result.evaluations) {
    for (const gap of evaluation.gaps) {
      await appendBdxImportJobLog({
        jobId,
        level: gap.severity === 'Critical' ? 'error' : gap.severity === 'Warning' ? 'warn' : 'info',
        code: gap.category,
        message: gap.message,
        rowNumber: evaluation.dto.sourceRowNumber,
        policyRef: evaluation.dto.policyRef,
        termKey: evaluation.dto.termKey,
        sourceSheetName: evaluation.dto.sourceSheetName,
        sourceMonth: evaluation.dto.sourceMonth,
        detailsJson: toJson({
          rootCauseHint: gap.rootCauseHint,
          productLine: evaluation.dto.productLine,
          sourceFile: evaluation.dto.sourceFile,
        }),
      });
    }
  }
}

export async function runBdxImportJob(jobId: string): Promise<BdxImportResult> {
  const job = await getBdxImportJob(jobId);
  if (!job) throw new Error(`BDX import job not found: ${jobId}`);
  const mode = job.mode === 'commit' ? 'commit' : 'dryRun';
  await updateBdxImportJob(jobId, {
    status: mode === 'commit' ? 'importing' : 'parsing',
    startedAt: new Date(),
    currentStep: 'Resolving program and binder',
  });

  try {
    const sourceFilePath = await resolveWorkerSourceFile(job);
    // Resolve by productLine — never by "latest ACTIVE program by updatedAt".
    // The previous empty-args call silently pinned every imported row to whichever
    // program was touched most recently, which mis-tagged 5,702 staging rows in
    // May 2026 (MOTOR policies committed under the Travel program/binder).
    const productType = String(job.productLine || '').trim().toUpperCase();
    if (!productType) {
      throw new Error('BDX import job is missing productLine; cannot resolve target Program.');
    }
    const resolved = await resolveProgramBinder({ productType });
    if (mode === 'commit') {
      if (!resolved.program) {
        throw new Error(
          `No unique ACTIVE Program found for productType=${productType}. `
          + 'Configure exactly one ACTIVE program for this product before running a BDX commit.'
        );
      }
      if (resolved.binders.length === 0) {
        throw new Error(
          `Program ${resolved.program.name} (${resolved.program.id}) has no ACTIVE linked Binder; `
          + 'cannot commit BDX import.'
        );
      }
    }
    const request: BdxImportRequest = {
      sourceFilePath,
      sourceHash: job.sourceFileHash,
      dryRun: mode === 'dryRun',
      productLine: job.productLine as BdxImportRequest['productLine'],
      fileType: job.fileType as BdxImportRequest['fileType'],
      mode,
      tenantHost: job.tenantHost,
      operatingTenantId: job.operatingTenantId,
      ...(job.dryRunJobId ? { dryRunJobId: job.dryRunJobId } : {}),
      importRunId: jobId,
      programId: resolved.program?.id || null,
      binderId: resolved.binders[0]?.id || null,
    };

    await updateBdxImportJob(jobId, {
      status: 'validating',
      currentStep: 'Validating BDX rows',
    });
    const result = await evaluateBdxMigrationImportRequest({
      request,
      runId: jobId,
      program: {
        id: resolved.program?.id || 'bdx-dry-run',
        metadata: resolved.program?.metadata || {},
      },
    });
    await writeFailureLogs(jobId, result);

    if (mode === 'commit') {
      await updateBdxImportJob(jobId, {
        status: 'importing',
        currentStep: 'Importing valid BDX rows',
      });
      await executeBdxImportLiveRun({
        result,
        request: { ...request, dryRun: false },
        runId: jobId,
        maxImports: 1000,
        accountId: null,
        program: { id: resolved.program!.id, metadata: resolved.program!.metadata },
        binders: resolved.binders,
        context: {
          actor: {
            id: job.createdBy,
            name: 'BDX Import Job',
            email: null,
            role: 'SYSTEM',
          },
          correlationId: jobId,
          reqUrlContext: {
            protocol: 'https',
            host: job.tenantHost,
          },
        },
      });
    }

    const counters = summarizeResult(result);
    await upsertBdxImportJobResult({
      jobId,
      summaryJson: toJson(counters.summaryJson),
      resultJson: toJson(result),
    });
    const finalStatus = mode === 'dryRun'
      ? 'ready_for_commit'
      : counters.failedRows > 0 ? 'completed_with_failures' : 'completed';
    await updateBdxImportJob(jobId, {
      status: finalStatus,
      currentStep: mode === 'dryRun' ? 'Dry-run complete; ready for approval' : 'Import complete',
      totalRows: counters.totalRows,
      processedRows: counters.processedRows,
      successRows: counters.successRows,
      failedRows: counters.failedRows,
      summaryJson: toJson(counters.summaryJson),
      finishedAt: new Date(),
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BDX import job failed';
    await appendBdxImportJobLog({
      jobId,
      level: 'error',
      code: 'BDX_JOB_FAILED',
      message,
    });
    await updateBdxImportJob(jobId, {
      status: 'failed',
      currentStep: message,
      finishedAt: new Date(),
    });
    throw error;
  }
}
