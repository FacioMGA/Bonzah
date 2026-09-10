const MB = 1024 * 1024;

export const MAX_XLSX_BYTES = 15 * MB;
export const MAX_XLSX_ROWS = 10000;
// Monthly migration workbooks can span 12-14 sheets without being unusually large.
export const MAX_XLSX_WORKSHEETS = 24;
export const MAX_XLSX_CELLS = 350000;

export function assertSafeXlsxBuffer(fileBuffer: Buffer, sourceLabel: string): void {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new Error(`XLSX payload is empty (${sourceLabel})`);
  }
  if (fileBuffer.length > MAX_XLSX_BYTES) {
    throw new Error(`XLSX payload exceeds ${MAX_XLSX_BYTES} bytes (${sourceLabel})`);
  }
}

export function assertSafeXlsxRowCount(rowCount: number, sourceLabel: string): void {
  if (!Number.isFinite(rowCount) || rowCount < 0) {
    throw new Error(`XLSX row count is invalid (${sourceLabel})`);
  }
  if (rowCount > MAX_XLSX_ROWS) {
    throw new Error(`XLSX row count exceeds ${MAX_XLSX_ROWS} (${sourceLabel})`);
  }
}

export function assertSafeXlsxWorksheetCount(worksheetCount: number, sourceLabel: string): void {
  if (!Number.isFinite(worksheetCount) || worksheetCount <= 0) {
    throw new Error(`XLSX worksheet count is invalid (${sourceLabel})`);
  }
  if (worksheetCount > MAX_XLSX_WORKSHEETS) {
    throw new Error(`XLSX worksheet count exceeds ${MAX_XLSX_WORKSHEETS} (${sourceLabel})`);
  }
}

export function assertSafeXlsxCellCount(cellCount: number, sourceLabel: string): void {
  if (!Number.isFinite(cellCount) || cellCount < 0) {
    throw new Error(`XLSX cell count is invalid (${sourceLabel})`);
  }
  if (cellCount > MAX_XLSX_CELLS) {
    throw new Error(`XLSX cell count exceeds ${MAX_XLSX_CELLS} (${sourceLabel})`);
  }
}
