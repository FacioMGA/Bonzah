import { describe, expect, it } from 'vitest';
import {
  buildBusinessProposalRowsFromQuoteData,
  effectiveCoverageSelectionFromPolicy,
  manualProposalCompleteness,
  mergeManualProposalRowsFromQuestionnaire,
  normalizeManualProposalRows,
  selectedCoverageCodesFromSelection,
  seedManualProposalRows,
} from './manualProposal';

const businessQuoteData = {
  coverage: {
    buildings: 150000,
    stock: 25000,
    equipment: 10000,
    publicLiability: 'yes',
    publicLiabilityLimit: 1000000,
    employersLiability: 'yes',
    employersLiabilityLimit: 500000,
    businessInterruption: 'yes',
    businessInterruptionLimit: 75000,
    businessInterruptionIndemnityMonths: 12,
    legalAssistance: 'yes',
  },
};

describe('manualProposal model', () => {
  it('builds Business proposal rows from questionnaire coverage fields', () => {
    const rows = buildBusinessProposalRowsFromQuoteData(businessQuoteData);

    expect(rows.map((row) => row.coverage)).toEqual([
      'Property cover',
      'Stock cover',
      'Equipment cover',
      'Public liability',
      'Employers liability',
      'Business interruption',
      'Legal assistance',
    ]);
    expect(rows.find((row) => row.coverage === 'Public liability')).toMatchObject({
      code: 'BUSINESS-PUBLIC-LIABILITY',
      limit: '1,000,000',
      notes: '',
      source: 'questionnaire',
    });
    expect(rows.find((row) => row.coverage === 'Business interruption')?.notes).toBe('');
    expect(rows.find((row) => row.coverage === 'Legal assistance')?.limit).toBe('Included');
  });

  it('does not seed Open Market rows from Business questionnaire fields', () => {
    expect(seedManualProposalRows(businessQuoteData, 'OPEN_MARKET')).toEqual([]);
  });

  it('preserves underwriter limit, premium, and excess when syncing questionnaire rows', () => {
    const seedRows = buildBusinessProposalRowsFromQuoteData(businessQuoteData);
    const merged = mergeManualProposalRowsFromQuestionnaire(
      [
        {
          code: 'BUSINESS-PUBLIC-LIABILITY',
          coverage: 'Public liability',
          limit: '900,000',
          excess: '500',
          premium: '250',
          notes: 'Subject to clean claims history',
          source: 'questionnaire',
        },
      ],
      seedRows,
    );

    const publicLiability = merged.find((row) => row.code === 'BUSINESS-PUBLIC-LIABILITY');
    expect(publicLiability).toMatchObject({
      limit: '900,000',
      excess: '500',
      premium: '250',
      notes: 'Subject to clean claims history',
    });
  });

  it('adds selected Coverage-tab Business rows while preserving existing underwriter edits', () => {
    const savedRows = normalizeManualProposalRows([
      {
        code: 'BUSINESS-PUBLIC-LIABILITY',
        coverage: 'Public liability',
        limit: '1,000,000',
        excess: '500',
        premium: '250',
        notes: 'Underwriter terms',
        source: 'questionnaire',
      },
    ]);
    const seedRows = seedManualProposalRows(
      { coverage: { publicLiability: 'yes', publicLiabilityLimit: 1000000 } },
      'BUSINESS',
      { selected: { 'BUSINESS-LEGAL-ASSISTANCE': true } },
    );

    const merged = mergeManualProposalRowsFromQuestionnaire(savedRows, seedRows);

    expect(merged.map((row) => row.code)).toEqual([
      'BUSINESS-PUBLIC-LIABILITY',
      'BUSINESS-LEGAL-ASSISTANCE',
    ]);
    expect(merged[0]).toMatchObject({
      excess: '500',
      premium: '250',
      notes: 'Underwriter terms',
    });
  });

  it('extracts selected coverage codes from saved and resolved coverage selections', () => {
    expect(
      selectedCoverageCodesFromSelection({
        selected: { 'BUSINESS-PUBLIC-LIABILITY': true, 'BUSINESS-STOCK': false },
        defaults: { selected: { 'BUSINESS-EMPLOYERS-LIABILITY': true } },
        resolvedCoverageSet: { selectedCodes: ['BUSINESS-LEGAL-ASSISTANCE'] },
        applied: [{ code: 'BUSINESS-PROPERTY' }],
      }),
    ).toEqual([
      'BUSINESS-PUBLIC-LIABILITY',
      'BUSINESS-EMPLOYERS-LIABILITY',
      'BUSINESS-LEGAL-ASSISTANCE',
      'BUSINESS-PROPERTY',
    ]);
  });

  it('falls back to stateSnapshot coverage selection when direct selection is empty', () => {
    const effective = effectiveCoverageSelectionFromPolicy({
      coverageSelection: {},
      stateSnapshot: {
        coverageSelection: {
          selected: {
            'BUSINESS-PROPERTY': true,
            'BUSINESS-EMPLOYERS-LIABILITY': true,
          },
        },
      },
    });

    expect(selectedCoverageCodesFromSelection(effective)).toEqual([
      'BUSINESS-PROPERTY',
      'BUSINESS-EMPLOYERS-LIABILITY',
    ]);
  });

  it('reports missing proposal data before send', () => {
    const rows = normalizeManualProposalRows([
      { coverage: 'Public liability', limit: '1,000,000', premium: 0, excess: '' },
    ]);

    const summary = manualProposalCompleteness({ proposal: {} }, rows);
    expect(summary.readyToSend).toBe(false);
    expect(summary.missing).toContain('Add market / insurer');
    expect(summary.missing).toContain('Add premium for Public liability');
    expect(summary.missing).toContain('Add excess for Public liability');
  });

  it('marks a complete manual proposal as ready to send', () => {
    const rows = normalizeManualProposalRows([
      { coverage: 'Public liability', limit: '1,000,000', premium: 250, excess: '500' },
    ]);

    const summary = manualProposalCompleteness({ proposal: { marketName: 'Manual Market' } }, rows);
    expect(summary).toMatchObject({
      readyToSend: true,
      totalPremium: 250,
      missing: [],
    });
  });
});
