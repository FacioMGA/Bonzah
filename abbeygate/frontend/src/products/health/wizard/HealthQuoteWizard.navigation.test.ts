import { describe, expect, it } from 'vitest';
import { healthManifest } from '@facio/products';
import { HEALTH_WIZARD_STEP_IDS } from './HealthQuoteWizard';

/**
 * ABY-518 — Health Immigration Medical journey opens on proposer
 * contact details so abandoned sessions retain a reachable email/phone.
 * Declarations stay immediately before payment (after the quote step).
 */
describe('HealthQuoteWizard navigation (ABY-518)', () => {
  it('opens the wizard on your-details before eligibility questions', () => {
    expect(HEALTH_WIZARD_STEP_IDS[0]).toBe('your-details');
    expect(HEALTH_WIZARD_STEP_IDS[1]).toBe('eligibility');
  });

  it('keeps declarations immediately before payment after the quote step', () => {
    expect(HEALTH_WIZARD_STEP_IDS).toEqual([
      'your-details',
      'eligibility',
      'insured-persons',
      'period-and-ghs',
      'quote',
      'declarations',
      'payment',
    ]);
  });

  it('aligns the BO questionnaire section order with the customer journey', () => {
    const sectionIds = healthManifest.questionnaire.sections
      .slice()
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .map((section) => section.id);

    expect(sectionIds).toEqual([
      'your-details',
      'eligibility',
      'insured-persons',
      'period-and-ghs',
      'quote',
      'declarations',
    ]);
  });
});
