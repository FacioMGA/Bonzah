import { describe, expect, it } from 'vitest';
import {
  assertSafeXlsxBuffer,
  assertSafeXlsxCellCount,
  assertSafeXlsxRowCount,
  assertSafeXlsxWorksheetCount,
  MAX_XLSX_BYTES,
  MAX_XLSX_CELLS,
  MAX_XLSX_ROWS,
  MAX_XLSX_WORKSHEETS,
} from '../xlsxSafety.js';

describe('xlsxSafety', () => {
  it('accepts non-empty buffers below size cap', () => {
    expect(() => assertSafeXlsxBuffer(Buffer.from('abc'), 'unit')).not.toThrow();
  });

  it('rejects oversized buffers', () => {
    const oversized = Buffer.alloc(MAX_XLSX_BYTES + 1, 1);
    expect(() => assertSafeXlsxBuffer(oversized, 'unit')).toThrow(/exceeds/);
  });

  it('rejects row counts above cap', () => {
    expect(() => assertSafeXlsxRowCount(MAX_XLSX_ROWS + 1, 'unit')).toThrow(/exceeds/);
  });

  it('rejects worksheet counts above cap', () => {
    expect(() => assertSafeXlsxWorksheetCount(MAX_XLSX_WORKSHEETS + 1, 'unit')).toThrow(/exceeds/);
  });

  it('rejects cell counts above cap', () => {
    expect(() => assertSafeXlsxCellCount(MAX_XLSX_CELLS + 1, 'unit')).toThrow(/exceeds/);
  });
});
