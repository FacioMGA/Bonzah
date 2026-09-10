// Journey contract: public quote questionnaire (motor + home).
//
// Bound to both canonical product flow definitions. Each must expose
// a questionnaire-entry step (policy-holder), a review step
// (your-quote), and a payment step. Removing or renaming any of
// these breaks the customer's quote -> submit path.

import { describe, expect, it } from 'vitest';
import { motorFlow } from '../../frontend/src/products/motor/wizard/flows/motor.flow';
import { homeFlow } from '../../frontend/src/products/home/wizard/flows/home.flow';

const flows = [motorFlow, homeFlow];

describe('journey: public-quote-questionnaire', () => {
  it('every product flow exposes the questionnaire entry, review, and payment steps', () => {
    for (const flow of flows) {
      const ids = new Set(flow.steps.map((step) => step.id));
      expect(ids.has('policy-holder')).toBe(true);
      expect(ids.has('your-quote')).toBe(true);
      expect(ids.has('payment')).toBe(true);
    }
  });

  it('every product flow declares policyHolder as its initial state', () => {
    for (const flow of flows) {
      expect(flow.initialState).toBe('policyHolder');
    }
  });
});
