import { describe, it, expect } from 'vitest';
import { resolveHeadersAndDataStart } from '../readWorkbookRows.js';

// Regression guard for the 2026-07-21 go-live import blocker: Lloyd's v5.2
// Home + Travel exports ship a TWO-LINE column header (e.g. row0 "Certificate"
// + row1 "Ref" -> "Certificate Ref"). The parser previously only merged the
// wrapped header for the narrow Travel "Traveller 1" case, so Home files were
// read from the truncated row-0 fragments and every row failed with
// "Missing inception/expiry date" + placeholder policy refs.
describe('resolveHeadersAndDataStart', () => {
  it('keeps a clean single-row motor header (Id/Policy) unchanged', () => {
    const matrix = [
      ['Id', 'Policy', 'Cover'],
      ['1', 'ABLV1', 'TPO'],
    ];
    const { headers, dataStartIndex } = resolveHeadersAndDataStart(matrix);
    expect(headers).toEqual(['Id', 'Policy', 'Cover']);
    expect(dataStartIndex).toBe(1);
  });

  it('keeps a clean single-row header that already carries Certificate Ref', () => {
    const matrix = [
      ['Certificate Ref', 'Insured First Name'],
      ['C1', 'Jo'],
    ];
    const { headers, dataStartIndex } = resolveHeadersAndDataStart(matrix);
    expect(headers).toContain('Certificate Ref');
    expect(dataStartIndex).toBe(1);
  });

  it('merges a two-line Home header and skips the blank spacer row (data at row 3)', () => {
    const matrix = [
      ['Certificate', 'Risk Inception', 'Risk Expiry'],
      ['Ref', 'Date', 'Date'],
      ['', '', ''],
      ['C1', '2026-01-01', '2027-01-01'],
    ];
    const { headers, dataStartIndex } = resolveHeadersAndDataStart(matrix);
    expect(headers).toEqual(['Certificate Ref', 'Risk Inception Date', 'Risk Expiry Date']);
    expect(dataStartIndex).toBe(3);
  });

  it('merges a two-line Travel header with no spacer (data at row 2)', () => {
    const matrix = [
      ['Certificate', 'Risk Inception', 'Total gross written', 'Traveller 1'],
      ['Ref', 'Date', 'premium', 'Name'],
      ['BRIT/1', '2026-07-08', '100', 'Graeme'],
    ];
    const { headers, dataStartIndex } = resolveHeadersAndDataStart(matrix);
    expect(headers).toContain('Certificate Ref');
    expect(headers).toContain('Risk Inception Date');
    expect(headers).toContain('Total gross written premium');
    expect(dataStartIndex).toBe(2);
  });
});
