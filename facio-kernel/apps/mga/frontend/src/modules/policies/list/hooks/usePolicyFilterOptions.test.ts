import { describe, expect, it } from 'vitest';

import { buildBinderFilterOptions, buildProgramFilterOptions } from './usePolicyFilterOptions';

describe('buildProgramFilterOptions', () => {
  it('collapses duplicate program names and filters all matching program ids together', () => {
    const options = buildProgramFilterOptions([
      { id: 'travel-old', name: 'Abbeygate Travel Standard', status: 'ACTIVE' },
      { id: 'travel-new', name: 'Abbeygate Travel Standard', status: 'DRAFT' },
      { id: 'home', name: 'Abbeygate Home Standard', status: 'ACTIVE' },
      { id: 'archived', name: 'Abbeygate Motor Comprehensive', status: 'ARCHIVED' },
      { id: 'motor', name: 'Abbeygate Motor Comprehensive', status: 'ACTIVE' },
    ]);

    expect(options).toEqual([
      { label: 'Abbeygate Travel Standard', value: 'travel-old,travel-new' },
      { label: 'Abbeygate Home Standard', value: 'home' },
      { label: 'Abbeygate Motor Comprehensive', value: 'motor' },
    ]);
  });
});

describe('buildBinderFilterOptions', () => {
  it('labels binders with leader, UMR, and year', () => {
    const options = buildBinderFilterOptions([
      {
        id: 'binder-1',
        umr: 'B176023EEA6153',
        agreementNumber: 'ABBEYGATE0125',
        startDate: '2026-01-01',
        config: { agreement: { leader: 'Brit' } },
      },
    ]);

    expect(options).toEqual([
      { label: 'Brit · B176023EEA6153 · 2026', value: 'binder-1' },
    ]);
  });
});
