import readXlsxFile from 'read-excel-file/node';
import {
  assertSafeXlsxCellCount,
  assertSafeXlsxRowCount,
  assertSafeXlsxWorksheetCount,
} from '../../../../platform/security/xlsxSafety.js';

type RowRecord = Record<string, unknown>;

function toHeader(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeCell(value: unknown): unknown {
  if (value === undefined) return null;
  return value;
}

function isSupplementalHeaderRow(headers: string[], row: unknown[] | undefined): boolean {
  if (!row || row.length === 0) return false;
  const values = row.map((cell) => toHeader(cell)).filter(Boolean);
  if (values.length === 0) return false;
  const genericTokens = new Set(['NUMBER', 'DATE', 'NOTE', 'DETAILS']);
  const genericCount = values.filter((value) => genericTokens.has(value.toUpperCase())).length;
  const headerSignal =
    (headers.includes('Policy') && toHeader(row[headers.indexOf('Policy')]).toUpperCase() === 'NUMBER') ||
    (headers.includes('Booked') && toHeader(row[headers.indexOf('Booked')]).toUpperCase() === 'DATE') ||
    (headers.includes('Inception') && toHeader(row[headers.indexOf('Inception')]).toUpperCase() === 'DATE') ||
    (headers.includes('Expiry') && toHeader(row[headers.indexOf('Expiry')]).toUpperCase() === 'DATE');
  return headerSignal || (values.length <= Math.max(4, Math.ceil(headers.length / 6)) && genericCount === values.length);
}

// Canonical column names that only appear once a wrapped two-line Lloyd's v5.2
// header has been merged (e.g. row0 "Certificate" + row1 "Ref" -> "Certificate
// Ref"). Used to decide whether a signal-poor single header row is actually the
// top line of a two-line header block.
const MERGED_HEADER_SIGNALS = new Set([
  'Certificate Ref',
  'Policy or Group Ref',
  'Risk, Transaction Type',
  'Total gross written premium',
  'Risk Inception Date',
  'Risk Expiry Date',
  'Risk Start Date',
]);

function mergedSignalCount(headers: string[]): number {
  return headers.filter((header) => MERGED_HEADER_SIGNALS.has(header)).length;
}

function isBlankMatrixRow(row: unknown[] | undefined): boolean {
  if (!row) return true;
  return !row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');
}

function findHeaderRowIndex(matrix: unknown[][]): number {
  const headerSignals = new Set([
    'Id',
    'Policy',
    'Certificate Ref',
    'Policy or Group Ref',
    'Risk, Transaction Type',
    'Total gross written premium',
    'Traveller 1',
    'From',
    'Level of',
  ]);
  const index = matrix.findIndex((row) => {
    const headers = (row || []).map((cell) => toHeader(cell));
    const signalCount = headers.filter((header) => headerSignals.has(header)).length;
    return signalCount >= 2
      || (headers.includes('Id') && headers.includes('Policy'))
      || (headers.includes('Traveller 1') && headers.includes('From'));
  });
  if (index >= 0) return index;
  // Two-line header fallback: no single row carries the signals, but the
  // canonical names appear once two consecutive rows are merged (Home and
  // non-"Traveller 1" Travel v5.2 exports ship this shape).
  for (let i = 0; i < matrix.length - 1; i += 1) {
    if (mergedSignalCount(mergeHeaderRows(matrix.slice(i, i + 2))) >= 2) return i;
  }
  return 0;
}

function isBdxDataRow(headers: string[], row: unknown[] | undefined): boolean {
  if (!row || row.length === 0) return false;
  const valueAt = (name: string) => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? toHeader(row[idx]) : '';
  };
  const motorPolicy = valueAt('Policy');
  if (motorPolicy && motorPolicy.toUpperCase() !== 'POLICY') return true;
  const certificateRef = valueAt('Certificate Ref');
  if (certificateRef && !['REF', 'CERTIFICATE REF', 'N/A'].includes(certificateRef.toUpperCase())) return true;
  const policyOrGroupRef = valueAt('Policy or Group Ref');
  if (policyOrGroupRef && !['GROUP REF', 'POLICY OR GROUP REF', 'N/A'].includes(policyOrGroupRef.toUpperCase())) return true;
  return false;
}

function firstDataRowIndex(headers: string[], matrix: unknown[][], headerIndex: number): number {
  let idx = headerIndex + 1;
  while (idx < matrix.length) {
    if (isBdxDataRow(headers, matrix[idx])) return idx;
    if (!isSupplementalHeaderRow(headers, matrix[idx])) {
      const values = (matrix[idx] || []).map((cell) => toHeader(cell)).filter(Boolean);
      if (values.length > 0 && headerIndex === 0) return idx;
    }
    idx += 1;
  }
  return headerIndex + 1;
}

function mergeHeaderRows(rows: unknown[][]): string[] {
  const width = Math.max(...rows.map((row) => row.length), 0);
  const merged: string[] = [];
  for (let i = 0; i < width; i += 1) {
    const parts = rows
      .map((row) => toHeader(row[i]))
      .filter(Boolean);
    merged.push(parts.join(' ').replace(/\s+/g, ' ').trim());
  }
  return merged;
}

export function resolveHeadersAndDataStart(matrix: unknown[][]): { headers: string[]; dataStartIndex: number } {
  const headerIndex = findHeaderRowIndex(matrix);
  const baseHeaders = (matrix[headerIndex] || []).map((cell) => toHeader(cell));

  // Case A — clean single-row header (classic motor `Id`/`Policy`, or any row
  // that already carries canonical signals / a `Certificate Ref` column).
  // Preserve the existing behavior exactly.
  const singleRowHeader =
    mergedSignalCount(baseHeaders) >= 2
    || baseHeaders.includes('Certificate Ref')
    || (baseHeaders.includes('Id') && baseHeaders.includes('Policy'));
  if (singleRowHeader) {
    return {
      headers: baseHeaders,
      dataStartIndex: firstDataRowIndex(baseHeaders, matrix, headerIndex),
    };
  }

  // Case B — wrapped multi-line Lloyd's v5.2 header (Home + Travel exports).
  // The canonical column names are split across 2–3 header rows, so no single
  // row carries the signals. `mergeHeaderRows` joins EVERY column across the
  // span, so we simply grow the span (max 3) until the merged header carries
  // the canonical signals — that is the complete header block. Then start data
  // at the first real data row, which transparently skips the blank spacer row
  // the Home layout inserts (Travel has no spacer; both are handled).
  let span = 1;
  let merged = mergeHeaderRows(matrix.slice(headerIndex, headerIndex + span));
  while (mergedSignalCount(merged) < 2 && span < 3 && headerIndex + span < matrix.length) {
    span += 1;
    merged = mergeHeaderRows(matrix.slice(headerIndex, headerIndex + span));
  }
  if (mergedSignalCount(merged) >= 2) {
    let dataStartIndex = headerIndex + span;
    while (
      dataStartIndex < matrix.length
      && (isBlankMatrixRow(matrix[dataStartIndex]) || !isBdxDataRow(merged, matrix[dataStartIndex]))
    ) {
      dataStartIndex += 1;
    }
    return { headers: merged, dataStartIndex };
  }

  return {
    headers: baseHeaders,
    dataStartIndex: firstDataRowIndex(baseHeaders, matrix, headerIndex),
  };
}

export async function readFirstSheetRowsFromBuffer(buffer: Buffer, sourceLabel: string): Promise<RowRecord[]> {
  const workbook = await readXlsxFile(buffer);
  assertSafeXlsxWorksheetCount(workbook.length, sourceLabel);
  const firstSheet = workbook[0];
  if (!firstSheet) return [];

  const matrix = firstSheet.data;
  if (!matrix.length) return [];

  const { headers, dataStartIndex } = resolveHeadersAndDataStart(matrix);
  const dataRows = matrix.slice(dataStartIndex);
  assertSafeXlsxRowCount(dataRows.length, `${sourceLabel}:${firstSheet.sheet}`);
  assertSafeXlsxCellCount(dataRows.length * Math.max(headers.length, 1), sourceLabel);

  return dataRows.map((row, idx) => {
    const out: RowRecord = {
      __sheetName: firstSheet.sheet,
      __sheetRowNumber: idx + dataStartIndex + 1,
    };
    headers.forEach((header, headerIdx) => {
      if (!header) return;
      out[header] = normalizeCell((row || [])[headerIdx]);
    });
    return out;
  });
}

export async function readWorkbookRowsFromBuffer(buffer: Buffer, sourceLabel: string): Promise<RowRecord[]> {
  const workbook = await readXlsxFile(buffer);
  assertSafeXlsxWorksheetCount(workbook.length, sourceLabel);
  if (workbook.length === 0) return [];

  const rows: RowRecord[] = [];
  let totalCells = 0;

  for (const sheet of workbook) {
    const sheetName = sheet.sheet;
    const matrix = sheet.data;
    if (!matrix.length) continue;

    const { headers, dataStartIndex } = resolveHeadersAndDataStart(matrix);
    const dataRows = matrix.slice(dataStartIndex);
    assertSafeXlsxRowCount(dataRows.length, `${sourceLabel}:${sheetName}`);
    totalCells += dataRows.length * Math.max(headers.length, 1);

    dataRows.forEach((row, idx) => {
      const out: RowRecord = {
        __sheetName: sheetName,
        __sheetRowNumber: idx + dataStartIndex + 1,
      };
      headers.forEach((header, headerIdx) => {
        if (!header) return;
        out[header] = normalizeCell((row || [])[headerIdx]);
      });
      rows.push(out);
    });
  }

  assertSafeXlsxCellCount(totalCells, sourceLabel);
  return rows;
}
