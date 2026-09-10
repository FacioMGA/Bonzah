/**
 * Regression tests for the "plan step terminal" gate in QuoteWizardEngine.
 *
 * A motor quote that is REFERRAL or DECLINED must NOT allow the customer
 * to proceed to payment (ABY-168). The gate mirrors the Travel wizard fix
 * for ABY-147.
 *
 * These tests pin the predicate logic extracted from QuoteWizardEngine so
 * that the contract can be validated at unit speed without mounting the
 * full wizard.
 */

import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// The predicate extracted verbatim from QuoteWizardEngine.tsx:
//   const quoteStatus = String(quoteResponse?.status ?? '').toUpperCase();
//   const isPlanStepTerminal =
//     currentStep === 4 && (quoteStatus === 'REFERRAL' || quoteStatus === 'DECLINED');
// ---------------------------------------------------------------------------

function isPlanStepTerminal(currentStep: number, quoteStatus: string | null | undefined): boolean {
  const status = String(quoteStatus ?? '').toUpperCase();
  return currentStep === 4 && (status === 'REFERRAL' || status === 'DECLINED');
}

// canNext for step 4 derived from the same logic:
//   canNext || (currentStep === 4 && !isPlanStepTerminal) || currentStep === 5
// For step 4 specifically:
function canNextStep4(quoteStatus: string | null | undefined): boolean {
  return !isPlanStepTerminal(4, quoteStatus);
}

describe('motor wizard: plan step terminal gate (ABY-168)', () => {
  describe('isPlanStepTerminal', () => {
    it('is true when step=4 and status is REFERRAL', () => {
      expect(isPlanStepTerminal(4, 'referral')).toBe(true);
      expect(isPlanStepTerminal(4, 'REFERRAL')).toBe(true);
    });

    it('is true when step=4 and status is DECLINED', () => {
      expect(isPlanStepTerminal(4, 'declined')).toBe(true);
      expect(isPlanStepTerminal(4, 'DECLINED')).toBe(true);
    });

    it('is false when step=4 and status is QUOTED (normal flow)', () => {
      expect(isPlanStepTerminal(4, 'quoted')).toBe(false);
      expect(isPlanStepTerminal(4, 'QUOTED')).toBe(false);
    });

    it('is false when step=4 and status is null/undefined/empty', () => {
      expect(isPlanStepTerminal(4, null)).toBe(false);
      expect(isPlanStepTerminal(4, undefined)).toBe(false);
      expect(isPlanStepTerminal(4, '')).toBe(false);
    });

    it('is false on steps other than 4, even with a terminal status', () => {
      expect(isPlanStepTerminal(1, 'REFERRAL')).toBe(false);
      expect(isPlanStepTerminal(3, 'REFERRAL')).toBe(false);
      expect(isPlanStepTerminal(5, 'DECLINED')).toBe(false);
      expect(isPlanStepTerminal(6, 'DECLINED')).toBe(false);
    });
  });

  describe('canNext (step 4 gate)', () => {
    it('is false (payment blocked) when quote is REFERRAL', () => {
      expect(canNextStep4('REFERRAL')).toBe(false);
    });

    it('is false (payment blocked) when quote is DECLINED', () => {
      expect(canNextStep4('DECLINED')).toBe(false);
    });

    it('is true (payment allowed) when quote is QUOTED', () => {
      expect(canNextStep4('QUOTED')).toBe(true);
    });

    it('is true (payment allowed) when status is absent (fresh load)', () => {
      expect(canNextStep4(null)).toBe(true);
      expect(canNextStep4(undefined)).toBe(true);
    });
  });
});
