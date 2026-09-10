import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../backend/platform/db/connection.js';
import { assessExistingBdxPolicyCollision } from '../../backend/modules/policy/app/bdxImportRecovery.js';
import { evaluateBdxMigrationImportRequest } from '../../backend/modules/reporting/app/bdxImport/service.js';
import type { BdxRowEvaluation } from '../../backend/modules/reporting/app/bdxImport/types.js';

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

function toCsv(rows: Array<Record<string, unknown>>, headers: string[]): string {
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ].join('\n');
}

function groupByPolicyRef(evaluations: BdxRowEvaluation[]): Map<string, BdxRowEvaluation[]> {
  const groups = new Map<string, BdxRowEvaluation[]>();
  for (const evaluation of evaluations) {
    const key = String(evaluation.dto.policyRef || '').trim();
    if (!key) continue;
    const bucket = groups.get(key) || [];
    bucket.push(evaluation);
    groups.set(key, bucket);
  }
  return groups;
}

async function main() {
  const sourceFilePath = process.argv[2];
  if (!sourceFilePath) {
    throw new Error('Usage: tsx tools/migrations/export_bdx_history_mismatch_report.ts <source-xlsx> [output-dir]');
  }
  const outputDir = process.argv[3] || path.resolve('artifacts', 'reporting', 'bdx-history-mismatches');
  const program = await prisma.program.findFirst({
    where: { status: 'ACTIVE' },
    select: { id: true, metadata: true },
    orderBy: { updatedAt: 'desc' },
  });
  const result = await evaluateBdxMigrationImportRequest({
    request: { sourceFilePath, dryRun: true },
    runId: `history-mismatch-report-${Date.now()}`,
    program,
  });
  const groups = groupByPolicyRef(result.evaluations);
  const rows: Array<Record<string, unknown>> = [];

  for (const [policyRef, evaluations] of groups.entries()) {
    const assessment = await assessExistingBdxPolicyCollision({ policyRef, evaluations });
    if (assessment.classification === 'no_existing_policy' || assessment.classification === 'idempotent_match') continue;
    rows.push({
      policyRef,
      classification: assessment.classification,
      reason: assessment.reason,
      expectedBaseSourceRowNumber: assessment.expectedBaseSourceRowNumber ?? '',
      actualBaseSourceRowNumber: assessment.actualBaseSourceRowNumber ?? '',
      expectedReplayRowNumbers: assessment.expectedReplayRowNumbers.join('|'),
      existingReplayRowNumbers: assessment.existingReplayRowNumbers.join('|'),
      missingReplayRowNumbers: assessment.missingReplayRowNumbers.join('|'),
      groupRowNumbers: evaluations.map((evaluation) => evaluation.dto.sourceRowNumber).join('|'),
      importableRowNumbers: evaluations
        .filter((evaluation) => evaluation.result !== 'FAIL')
        .map((evaluation) => evaluation.dto.sourceRowNumber)
        .join('|'),
    });
  }

  const byClassification = Object.entries(rows.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.classification || 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);

  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDir, 'history-mismatches.json'), JSON.stringify({
      sourceFilePath,
      totalMismatches: rows.length,
      byClassification,
      rows,
    }, null, 2), 'utf8'),
    writeFile(path.join(outputDir, 'history-mismatches.csv'), toCsv(rows, [
      'policyRef',
      'classification',
      'reason',
      'expectedBaseSourceRowNumber',
      'actualBaseSourceRowNumber',
      'expectedReplayRowNumbers',
      'existingReplayRowNumbers',
      'missingReplayRowNumbers',
      'groupRowNumbers',
      'importableRowNumbers',
    ]), 'utf8'),
  ]);
  console.log(JSON.stringify({
    outputDir,
    totalMismatches: rows.length,
    byClassification,
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
