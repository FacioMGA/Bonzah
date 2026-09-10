import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../backend/platform/db/connection.js';
import { evaluateBdxMigrationImportRequest } from '../../backend/modules/reporting/app/bdxImport/service.js';

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

async function main() {
  const sourceFilePath = process.argv[2];
  if (!sourceFilePath) {
    throw new Error('Usage: tsx tools/migrations/export_bdx_hard_fail_report.ts <source-xlsx> [output-dir]');
  }
  const outputDir = process.argv[3] || path.resolve('artifacts', 'reporting', 'bdx-hard-fails');
  const program = await prisma.program.findFirst({
    where: { status: 'ACTIVE' },
    select: { id: true, metadata: true },
    orderBy: { updatedAt: 'desc' },
  });
  const result = await evaluateBdxMigrationImportRequest({
    request: { sourceFilePath, dryRun: true },
    runId: `hard-fail-report-${Date.now()}`,
    program,
  });
  const hardFails = result.evaluations
    .filter((evaluation) => evaluation.result === 'FAIL')
    .map((evaluation) => ({
      policyRef: evaluation.dto.policyRef,
      rowId: evaluation.dto.sourceId,
      sheet: evaluation.dto.sourceSheetName,
      rowNumber: evaluation.dto.sourceRowNumber,
      entry: evaluation.dto.entry,
      disposition: evaluation.policyImportDisposition || '',
      primaryReason: evaluation.gaps[0]?.message || 'Unknown',
      rootCauseHint: evaluation.gaps[0]?.rootCauseHint || '',
      bookedDate: evaluation.dto.bookedDate,
      inceptionDate: evaluation.dto.inceptionDate,
      expiryDate: evaluation.dto.expiryDate,
      dateOfBirth: evaluation.dto.dateOfBirth,
      make: evaluation.dto.make,
      model: evaluation.dto.model,
      engineSize: evaluation.dto.engineSize ?? '',
      premiumPayable: evaluation.dto.premiumPayable ?? '',
      grossPremium: evaluation.dto.grossPremium ?? '',
      registration: evaluation.dto.registration,
    }));
  const byReason = Object.entries(hardFails.reduce<Record<string, number>>((acc, row) => {
    acc[row.primaryReason] = (acc[row.primaryReason] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDir, 'hard-fails.json'), JSON.stringify({
      sourceFilePath,
      totalHardFails: hardFails.length,
      byReason,
      rows: hardFails,
    }, null, 2), 'utf8'),
    writeFile(path.join(outputDir, 'hard-fails.csv'), toCsv(hardFails, [
      'policyRef',
      'rowId',
      'sheet',
      'rowNumber',
      'entry',
      'disposition',
      'primaryReason',
      'rootCauseHint',
      'bookedDate',
      'inceptionDate',
      'expiryDate',
      'dateOfBirth',
      'make',
      'model',
      'engineSize',
      'premiumPayable',
      'grossPremium',
      'registration',
    ]), 'utf8'),
  ]);
  console.log(JSON.stringify({
    outputDir,
    totalHardFails: hardFails.length,
    byReason,
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
