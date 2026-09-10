import { describe, expect, it } from 'vitest';

import { registerAllProducts } from '../../../../../products/registerProducts.js';
import { evaluateBdxMigrationRows } from '../service.js';

registerAllProducts();

describe('bdx import term keys', () => {
  it('assigns policy term keys so same policy number renewals are distinct terms', async () => {
    const base = {
      Id: 'term-1',
      Entry: 'NB',
      Insured: 'Term Driver',
      Policy: 'ABLVTERM001',
      Inception: '2025-01-01',
      Expiry: '2026-01-01',
      'Date Of Birth': '1980-01-01',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      Make: 'FORD',
      Model: 'FOCUS',
      'Engine Size': 1400,
      'Vehicle Value': 9000,
      Year: 2018,
      Registration: 'TERM001',
      Excess: 250,
      'Premium Payable': 300,
      'Gross  Premium': 289,
      'MIF Payable': 9,
      'Stamp Payable': 2,
      'Comm.': 86.7,
      'Pay able to ARB': 202.3,
    };

    const evaluations = await evaluateBdxMigrationRows({
      rows: [
        base,
        { ...base, Id: 'term-2', Entry: 'RNL', Inception: '2026-01-01', Expiry: '2027-01-01' },
      ],
      request: { sourceFilePath: 'ignored.xlsx', dryRun: true, productLine: 'motor' },
      program: { id: 'prog-1', metadata: {} },
    });

    expect(evaluations[0]?.dto.termKey).toContain('ABLVTERM001::2025-01-01_2026-01-01');
    expect(evaluations[1]?.dto.termKey).toContain('ABLVTERM001::2026-01-01_2027-01-01');
    expect(evaluations[0]?.dto.termKey).not.toBe(evaluations[1]?.dto.termKey);
  });
});
