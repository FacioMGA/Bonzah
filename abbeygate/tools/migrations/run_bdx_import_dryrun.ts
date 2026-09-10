import { prisma } from '../../backend/platform/db/connection.js';
import { evaluateBdxMigrationImportRequest } from '../../backend/modules/reporting/app/bdxImport/service.js';
import { resolvePolicyDocumentPath } from '../../backend/platform/runtime/runtimePaths.js';

async function main() {
  const sourceFilePath = process.argv[2] || resolvePolicyDocumentPath('BDX Volante Cyprus Dec 2025.xlsx');
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
    runId: `local-dryrun-${Date.now()}`,
    program,
  });

  const failReasonCounts = new Map<string, number>();
  const flaggedReasonCounts = new Map<string, number>();
  for (const evaluation of result.evaluations) {
    if (evaluation.result === 'FAIL') {
      const primaryGap = evaluation.gaps[0]?.message || 'Unknown failure';
      failReasonCounts.set(primaryGap, (failReasonCounts.get(primaryGap) || 0) + 1);
    }
    if (evaluation.migrationCompliance?.state === 'FAIL') {
      const reason = evaluation.migrationCompliance.reasonCodes[0] || 'BDX_MIGRATION_NON_COMPLIANT';
      flaggedReasonCounts.set(reason, (flaggedReasonCounts.get(reason) || 0) + 1);
    }
  }

  const payload = {
    runId: result.runId,
    sourceFilePath: result.sourceFilePath,
    summary: result.summary,
    importCandidateSummary: {
      policyImportCandidateRows: result.summary.policyImportCandidateRows,
      endorsementReplayRows: result.summary.endorsementReplayRows,
      skippedDeltaRows: result.summary.skippedDeltaRows,
      skippedSupersededRows: result.summary.skippedSupersededRows,
      importCandidateFailures: result.evaluations.filter((x) => x.policyImportDisposition === 'IMPORT_POLICY' && x.result === 'FAIL').length,
      importCandidateNonCompliant: result.evaluations.filter((x) => x.policyImportDisposition === 'IMPORT_POLICY' && x.migrationCompliance?.state === 'FAIL').length,
    },
    gapsByCategory: result.gapsByCategory,
    reconciliationStatistics: result.outputs.reconciliationStatistics,
    migrationCompliance: {
      nonCompliantRows: result.evaluations.filter((x) => x.migrationCompliance?.state === 'FAIL').length,
      autoAdjustedRows: result.evaluations.filter((x) => Boolean(x.migrationCompliance?.appliedUwAdjustment)).length,
      topReasons: [...flaggedReasonCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([reason, count]) => ({ reason, count })),
    },
    hardFailSummary: {
      count: result.summary.failRows,
      topReasons: [...failReasonCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([reason, count]) => ({ reason, count })),
    },
    topExceptions: result.outputs.exceptionFile.slice(0, 20),
  };
  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
