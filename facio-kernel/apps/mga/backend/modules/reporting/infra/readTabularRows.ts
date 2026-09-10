import path from 'node:path';
import { promises as fs } from 'node:fs';
import { assertSafeXlsxBuffer } from '../../../platform/security/xlsxSafety.js';
import { readCsvRowsFromBuffer } from './csv/readCsvRows.js';
import { readWorkbookRowsFromBuffer } from './xlsx/readWorkbookRows.js';
import type { BdxImportFileType, BdxProductLine, BdxRawRow } from '../app/bdxImport/types.js';

type ReadTabularRowsArgs = {
  filePath: string;
  fileType: BdxImportFileType;
  productLine?: BdxProductLine;
  tenantSite?: string;
};

const MONTHS: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  novenber: '11',
  dec: '12',
  december: '12',
};

function normalizeMonthSource(value: string): string | null {
  const normalized = value.toLowerCase().replace(/[_-]/g, ' ');
  const full = normalized.match(/\b(january|february|march|april|may|june|july|august|september|october|november|novenber|december)\s+(20\d{2})\b/);
  if (full) return `${full[2]}-${MONTHS[full[1]!]}`;
  const short = normalized.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s*'?(\d{2}|\d{4})\b/);
  if (!short) return null;
  const yearRaw = short[2]!;
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  return `${year}-${MONTHS[short[1]!]}`;
}

export function detectSourceMonth(args: { sourceFile?: string; sourceSheetName?: string }): string | null {
  const sheetMonth = args.sourceSheetName ? normalizeMonthSource(args.sourceSheetName) : null;
  if (sheetMonth) return sheetMonth;
  const fileMonth = args.sourceFile ? normalizeMonthSource(path.basename(args.sourceFile)) : null;
  return fileMonth;
}

function tenantSheetMatcher(tenantSite?: string): RegExp | null {
  const normalized = String(tenantSite || '').toLowerCase();
  if (normalized.includes('abbeygate-cy') || normalized === 'cy' || normalized.includes('cyprus')) {
    return /^(cy|cyprus)$/i;
  }
  if (normalized.includes('abbeygate-pt') || normalized === 'pt' || normalized.includes('portugal')) {
    return /^(pt|portugal)$/i;
  }
  return null;
}

export function filterRowsForTenantSheet(rows: BdxRawRow[], tenantSite?: string): BdxRawRow[] {
  const matcher = tenantSheetMatcher(tenantSite);
  if (!matcher) return rows;
  const hasTenantSheet = rows.some((row) => matcher.test(String(row.__sheetName || '').trim()));
  if (!hasTenantSheet) return rows;
  return rows.filter((row) => matcher.test(String(row.__sheetName || '').trim()));
}

export async function readTabularRows(args: ReadTabularRowsArgs): Promise<BdxRawRow[]> {
  const bytes = await fs.readFile(args.filePath);
  const sourceLabel = args.filePath;
  const rowsRaw = args.fileType === 'csv'
    ? readCsvRowsFromBuffer(bytes, sourceLabel)
    : (() => {
        assertSafeXlsxBuffer(bytes, sourceLabel);
        return readWorkbookRowsFromBuffer(bytes, sourceLabel);
      })();
  const rows = filterRowsForTenantSheet(await rowsRaw, args.tenantSite);

  return rows.map((row) => {
    const sourceSheetName = String(row.__sheetName || (args.fileType === 'csv' ? 'CSV' : 'Sheet1'));
    return {
      ...row,
      __sourceFile: args.filePath,
      __sheetName: sourceSheetName,
      __sourceMonth: detectSourceMonth({
        sourceFile: args.filePath,
        sourceSheetName,
      }) || undefined,
      __productLine: args.productLine,
      __tenantSite: args.tenantSite,
    };
  }) as BdxRawRow[];
}
