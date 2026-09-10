import { describe, it, expect } from 'vitest';
import {
  COUNTRY_TENANT_MAP,
  EXCLUDED_COUNTRIES,
  partitionByTenant,
  resolveCountryColumns,
} from '../split_bdx_by_tenant.js';

type Cell = string | number | boolean | Date | null;

// Two header rows + a blank spacer row, mirroring the real BDX layout.
function buildMatrix(dataRows: Cell[][]): Cell[][] {
  const header0 = ['Certificate Ref', 'Location of risk - Country'];
  const header1 = ['', ''];
  const blank = ['', ''];
  return [header0, header1, blank, ...dataRows];
}

describe('split_bdx_by_tenant', () => {
  it('locates the risk-location country column', () => {
    const cols = resolveCountryColumns(buildMatrix([]));
    expect(cols).toContain(1);
  });

  it('routes each jurisdiction to its tenant and excludes Spain by design', () => {
    const matrix = buildMatrix([
      ['BZ/1', 'Cyprus'],
      ['BZ/2', 'Cyprus'],
      ['BZ/3', 'Portugal'],
      ['BZ/4', 'Greece'],
      ['BZ/5', 'Spain'],
      ['BZ/6', 'Spain'],
    ]);
    const result = partitionByTenant(matrix);

    expect(result.totalDataRows).toBe(6);
    expect(result.byTenant.get('abbeygate-cy')!.length - 3).toBe(2); // minus 3 header rows
    expect(result.byTenant.get('abbeygate-pt')!.length - 3).toBe(1);
    expect(result.byTenant.get('abbeygate-gr')!.length - 3).toBe(1);
    expect(result.byTenant.has('abbeygate-es')).toBe(false);
    expect(result.excludedByCountry.spain).toBe(2);
  });

  it('preserves both header rows and the spacer in each tenant file', () => {
    const matrix = buildMatrix([['BZ/1', 'Cyprus']]);
    const cy = partitionByTenant(matrix).byTenant.get('abbeygate-cy')!;
    expect(cy[0]![0]).toBe('Certificate Ref');
    expect(cy.length).toBe(4); // 3 header rows + 1 data row
    expect(cy[3]![0]).toBe('BZ/1');
  });

  it('refuses to guess when a row has no resolvable country', () => {
    const matrix = buildMatrix([['BZ/1', '']]);
    expect(() => partitionByTenant(matrix)).toThrow(/could not resolve a country/i);
  });

  it('fails loudly on an unexpected country that is neither included nor explicitly excluded', () => {
    const matrix = buildMatrix([['BZ/1', 'Italy']]);
    expect(() => partitionByTenant(matrix)).toThrow(/neither in the include map/i);
  });

  it('keeps the include map and exclusion set aligned with the go-live scope', () => {
    expect(Object.keys(COUNTRY_TENANT_MAP).sort()).toEqual(['cyprus', 'greece', 'portugal']);
    expect(EXCLUDED_COUNTRIES.has('spain')).toBe(true);
  });
});
