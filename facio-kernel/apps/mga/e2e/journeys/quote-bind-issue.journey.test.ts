// Journey contract: motor quote -> bind -> issue.
//
// Bound to the canonical motor wizard flow definition. Deep proof of
// each phase lives at tier 2/3 (binding_integrity, policies_bind,
// endorsements.issue-doc-orchestration). This file fails compile or
// test the moment the canonical step ladder loses any of the
// quote / payment / success seams customers depend on.

import { describe, expect, it } from 'vitest';
import { motorFlow } from '../../frontend/src/products/motor/wizard/flows/motor.flow';

describe('journey: quote-bind-issue', () => {
  it('motorFlow exposes the quote -> bind -> issue step ladder', () => {
    const stepsById = new Map(motorFlow.steps.map((step) => [step.id, step]));
    expect(stepsById.get('your-quote')?.kind).toBe('review');
    expect(stepsById.get('payment')?.kind).toBe('payment');
    expect(stepsById.get('success')?.kind).toBe('terminal');
  });

  it('payment step submits into the terminal success state with paymentConfirmed guard', () => {
    const paymentState = motorFlow.states.payment;
    const submitTransitions = paymentState?.on?.['FLOW.SUBMIT'];
    const list = Array.isArray(submitTransitions) ? submitTransitions : [submitTransitions];
    const successTransition = list.find((t) => t?.target === 'success');
    expect(successTransition).toBeDefined();
    expect(successTransition?.guards).toContain('paymentConfirmed');
  });
});
