import { describe, expect, it } from 'vitest';
import { evaluateEndorsementDocumentActions } from '../../../modules/documents/app/endorsementDocumentRules.js';

const baseSnapshot = {
  effectiveDate: '2026-01-01',
  expiryDate: '2027-01-01',
  quoteData: {
    registrationNumber: 'ABC123',
    proposer: { firstName: 'John', lastName: 'Doe' },
    coverRequired: ['TPL', 'OWN_DAMAGE'],
    hasClaims: false,
    uwAdjustments: [],
  },
  quoteResponse: {
    primaryOption: {
      costDetails: { totalPremium: 500 },
    },
  },
};

describe('endorsement document rules', () => {
  it('requires evidence pack when dates change', () => {
    const decision = evaluateEndorsementDocumentActions({
      baselineSnapshot: baseSnapshot,
      endorsementSnapshot: {
        ...baseSnapshot,
        expiryDate: '2027-03-01',
      },
    });

    expect(decision.requiresEvidencePack).toBe(true);
    expect(decision.flags.certificateChanged).toBe(true);
    expect(decision.reasons).toContain('certificate_fields_changed');
  });

  it('requires evidence pack when vehicle identity changes', () => {
    const decision = evaluateEndorsementDocumentActions({
      baselineSnapshot: baseSnapshot,
      endorsementSnapshot: {
        ...baseSnapshot,
        quoteData: {
          ...baseSnapshot.quoteData,
          registrationNumber: 'XYZ900',
        },
      },
    });

    expect(decision.requiresEvidencePack).toBe(true);
    expect(decision.flags.greenCardChanged).toBe(true);
  });

  it('keeps note-only UW change as delta-only', () => {
    const decision = evaluateEndorsementDocumentActions({
      baselineSnapshot: baseSnapshot,
      endorsementSnapshot: {
        ...baseSnapshot,
        quoteData: {
          ...baseSnapshot.quoteData,
          uwAdjustments: [
            {
              lineType: 'schedule_note',
              category: 'EXCLUSION',
              text: 'No cover while racing.',
            },
          ],
        },
      },
    });

    expect(decision.requiresEvidencePack).toBe(false);
    expect(decision.flags.scheduleChanged).toBe(false);
  });

  it('flags SoF refresh when disclosure answers change', () => {
    const decision = evaluateEndorsementDocumentActions({
      baselineSnapshot: baseSnapshot,
      endorsementSnapshot: {
        ...baseSnapshot,
        quoteData: {
          ...baseSnapshot.quoteData,
          hasClaims: true,
          claimsDetails: 'Minor windshield claim',
        },
      },
    });

    expect(decision.requiresEvidencePack).toBe(true);
    expect(decision.flags.sofChanged).toBe(true);
    expect(decision.reasons).toContain('statement_of_fact_fields_changed');
  });
});
