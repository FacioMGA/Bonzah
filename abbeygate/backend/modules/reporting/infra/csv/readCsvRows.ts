import { parse } from 'csv-parse/sync';
import {
  assertSafeXlsxCellCount,
  assertSafeXlsxRowCount,
} from '../../../../platform/security/xlsxSafety.js';

type RowRecord = Record<string, unknown>;

function normalizeCell(value: unknown): unknown {
  if (value === undefined || value === '') return null;
  return value;
}

export function readCsvRowsFromBuffer(buffer: Buffer, sourceLabel: string): RowRecord[] {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error(`CSV payload is empty (${sourceLabel})`);
  }
  const rows = parse(buffer, {
    bom: true,
    columns: (headers: string[]) => headers.map((header) => String(header ?? '').trim()),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as RowRecord[];

  assertSafeXlsxRowCount(rows.length, sourceLabel);
  const headerCount = rows.length > 0 ? Object.keys(rows[0] || {}).length : 0;
  assertSafeXlsxCellCount(rows.length * Math.max(headerCount, 1), sourceLabel);

  return rows.map((row, index) => {
    const out: RowRecord = {
      __sheetName: 'CSV',
      __sheetRowNumber: index + 2,
    };
    for (const [key, value] of Object.entries(row)) {
      if (!key) continue;
      out[key] = normalizeCell(value);
    }
    return out;
  });
}
