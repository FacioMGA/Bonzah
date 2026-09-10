import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../backend/platform/db/connection.js';
import { evaluateBdxMigrationImportRequest } from '../../backend/modules/reporting/app/bdxImport/service.js';

type Stage = {
  name: string;
  dryRun: boolean;
  batchSize: number;
  maxImports: number;
  parallelWorkers: number;
  rowNumbers: number[];
  policyChainKeys?: string[];
};

function chunk<T>(items: T[], limit: number): T[] {
  if (!Number.isFinite(limit) || limit <= 0) return items;
  return items.slice(0, limit);
}

function policyRowTimestamp(evaluation: {
  dto: { bookedDate: string; inceptionDate: string; sourceRowNumber: number };
}): number {
  const booked = evaluation.dto.bookedDate ? new Date(evaluation.dto.bookedDate).getTime() : NaN;
  if (Number.isFinite(booked)) return booked;
  const inception = evaluation.dto.inceptionDate ? new Date(evaluation.dto.inceptionDate).getTime() : NaN;
  if (Number.isFinite(inception)) return inception;
  return evaluation.dto.sourceRowNumber;
}

function buildReplayAwareRowSelection(evaluations: Array<{
  dto: { policyRef: string; sourceRowNumber: number; bookedDate: string; inceptionDate: string };
  result: string;
  policyImportDisposition?: string;
  migrationCompliance?: { state?: string };
}>): number[] {
  const groups = new Map<string, typeof evaluations>();
  for (const evaluation of evaluations) {
    const key = String(evaluation.dto.policyRef || '').trim();
    if (!key) continue;
    const bucket = groups.get(key) || [];
    bucket.push(evaluation);
    groups.set(key, bucket);
  }
  const selectedRows = new Set<number>();
  for (const rows of groups.values()) {
    const ordered = rows
      .slice()
      .sort((a, b) => {
        const delta = policyRowTimestamp(a) - policyRowTimestamp(b);
        if (delta !== 0) return delta;
        return a.dto.sourceRowNumber - b.dto.sourceRowNumber;
      });
    const explicitlySafe = ordered.filter((evaluation) =>
      evaluation.result !== 'FAIL' && evaluation.migrationCompliance?.state !== 'FAIL'
    );
    if (explicitlySafe.length === 0) continue;
    const latestSelectedRowNumber = Math.max(...explicitlySafe.map((evaluation) => evaluation.dto.sourceRowNumber));
    for (const evaluation of ordered) {
      if (evaluation.result === 'FAIL') continue;
      if (evaluation.dto.sourceRowNumber <= latestSelectedRowNumber) {
        selectedRows.add(evaluation.dto.sourceRowNumber);
      }
    }
  }
  return [...selectedRows].sort((a, b) => a - b);
}

function buildPolicyChainRows(evaluations: Array<{
  dto: { policyRef: string; sourceRowNumber: number; policyChainKey: string };
}>): Record<string, number[]> {
  const chains = new Map<string, Set<number>>();
  for (const evaluation of evaluations) {
    const key = String(evaluation.dto.policyChainKey || '').trim();
    if (!key) continue;
    const bucket = chains.get(key) || new Set<number>();
    bucket.add(evaluation.dto.sourceRowNumber);
    chains.set(key, bucket);
  }
  return Object.fromEntries(
    [...chains.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, rows]) => [key, [...rows].sort((a, b) => a - b)]),
  );
}

async function main() {
  const sourceFilePath = process.argv[2];
  if (!sourceFilePath) {
    throw new Error('Usage: tsx tools/migrations/build_bdx_safe_upload_template.ts <source-xlsx> [output-json] [row-limit] [safe|remaining|continue]');
  }
  const outputPath = process.argv[3] || path.resolve('tmp', 'bdx-safe-upload-template.json');
  const rowLimitArg = process.argv[4] || '';
  const modeArg = process.argv[5] || (Number.isFinite(Number(rowLimitArg)) || rowLimitArg === '' ? 'safe' : rowLimitArg);
  const rowLimit = Number(Number.isFinite(Number(rowLimitArg)) ? rowLimitArg : 0);
  const mode = modeArg === 'remaining' || modeArg === 'continue' ? 'continue' : 'safe';
  const program = await prisma.program.findFirst({
    where: { status: 'ACTIVE' },
    select: { id: true, metadata: true },
    orderBy: { updatedAt: 'desc' },
  });
  const result = await evaluateBdxMigrationImportRequest({
    request: {
      sourceFilePath,
      dryRun: true,
    },
    runId: `safe-upload-template-${Date.now()}`,
    program,
  });
  const safeRows = mode === 'continue'
    ? result.evaluations
        .filter((evaluation) =>
          (evaluation.policyImportDisposition === 'IMPORT_POLICY' || evaluation.policyImportDisposition === 'IMPORT_ENDORSEMENT') &&
          evaluation.result !== 'FAIL'
        )
        .map((evaluation) => evaluation.dto.sourceRowNumber)
    : buildReplayAwareRowSelection(result.evaluations);
  const rowNumbers = chunk(safeRows, rowLimit);
  const chainRows = buildPolicyChainRows(result.evaluations);
  const stages: Stage[] = [
    {
      name: 'validateOnly-safe',
      dryRun: true,
      batchSize: 50,
      maxImports: 1,
      parallelWorkers: 1,
      rowNumbers,
    },
    {
      name: 'bindIssue-safe',
      dryRun: false,
      batchSize: 25,
      maxImports: 25,
      parallelWorkers: 1,
      rowNumbers,
    },
    {
      name: 'retryFailed-safe',
      dryRun: false,
      batchSize: 1,
      maxImports: 1,
      parallelWorkers: 1,
      rowNumbers: [],
    },
  ];
  const payload = {
    endpoint: 'https://abbeygate-cy.facio.io/api/policies/imports/bdx',
    sourceFilePath,
    uploadFromRunner: true,
    authTokenEnv: 'BDX_AUTH_TOKEN',
    chainRows,
    stages: [
      stages[0],
      stages[1],
      {
        ...stages[2],
        retryFailedFromStage: 'bindIssue-safe',
      },
    ],
  };
  await writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(JSON.stringify({
    outputPath,
    mode,
    totalRows: result.summary.totalRows,
    safeRowCount: safeRows.length,
    selectedRowCount: rowNumbers.length,
    policyChainCount: Object.keys(chainRows).length,
    flaggedRowsExcluded: result.evaluations.length - safeRows.length,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
