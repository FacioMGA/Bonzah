/**
 * Per-product flow contract conformance for the Home wizard.
 *
 * Lives next to the flow it exercises (Amendment #6 — `shared/lib/wizard/`
 * may not import `@/src/products/**`). Mirrors the motor counterpart at
 * `products/motor/wizard/flows/__tests__/motor.flow.contracts.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { homeFlow } from '../home.flow';
import {
  homeInformationSubsectionByStepId,
  homeInformationStepIds,
  homeJourneyStageByStepId,
  wizardSteps,
} from '../../quoteWizard.constants';

const flows = [homeFlow];

describe('home flow contracts', () => {
  it('all step ids are unique per flow', () => {
    for (const flow of flows) {
      const ids = flow.steps.map((step) => step.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('all transition targets exist', () => {
    for (const flow of flows) {
      const stateKeys = new Set(Object.keys(flow.states));
      for (const state of Object.values(flow.states)) {
        const on = state.on || {};
        for (const transitionOrList of Object.values(on)) {
          const list = Array.isArray(transitionOrList) ? transitionOrList : [transitionOrList];
          for (const transition of list) {
            expect(stateKeys.has(transition.target)).toBe(true);
          }
        }
      }
    }
  });

  it('initial state is policyHolder and maps to the policy-holder step', () => {
    expect(homeFlow.initialState).toBe('policyHolder');
    expect(homeFlow.states.policyHolder?.stepId).toBe('policy-holder');
  });

  it('quote -> acceptance transition is gated by hasQuote', () => {
    const transitions = homeFlow.states.quote?.on?.['NAV.NEXT'];
    const list = Array.isArray(transitions) ? transitions : [transitions];
    expect(list[0]?.guards).toContain('hasQuote');
  });

  it('projects the existing internal steps into the approved four-stage customer journey', () => {
    expect(wizardSteps).toEqual([
      'Your details',
      'Your quote',
      'Acceptance',
      'Payment',
    ]);
    expect(homeJourneyStageByStepId).toMatchObject({
      'policy-holder': 1,
      property: 1,
      'construction-risk': 1,
      'sums-insured': 1,
      security: 1,
      'your-quote': 2,
      acceptance: 3,
      payment: 4,
    });
    expect(homeInformationSubsectionByStepId).toEqual({
      'policy-holder': 'Your details',
      property: 'Property',
      'construction-risk': 'Construction',
      'sums-insured': 'Sums insured',
      security: 'Security',
    });
    expect(homeInformationStepIds).toEqual([
      'policy-holder',
      'property',
      'construction-risk',
      'sums-insured',
      'security',
    ]);
  });

  it('keeps the original Home step IDs available for validation and resume links', () => {
    expect(homeFlow.steps.map((step) => step.id)).toEqual([
      'policy-holder',
      'property',
      'construction-risk',
      'sums-insured',
      'security',
      'your-quote',
      'acceptance',
      'payment',
      'success',
    ]);
  });
});
