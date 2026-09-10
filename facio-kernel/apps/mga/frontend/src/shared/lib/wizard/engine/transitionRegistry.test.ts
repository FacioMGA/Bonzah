import { describe, expect, it } from 'vitest';
import { baseGuardRegistry } from './guards';
import { resolveTransition } from './transitionRegistry';
import type { WizardFlowDefinition, WizardRuntimeState } from './types';

const testFlow: WizardFlowDefinition = {
  id: 'test-flow',
  product: 'motor',
  initialState: 'a',
  steps: [
    { id: 'step-a', title: 'A', routeKey: 'a' },
    { id: 'step-b', title: 'B', routeKey: 'b' },
  ],
  states: {
    a: {
      stepId: 'step-a',
      on: {
        'NAV.NEXT': [
          { target: 'b', guards: ['hasQuote'] },
          { target: 'a', guards: ['always'] },
        ],
      },
    },
    b: {
      stepId: 'step-b',
    },
  },
};

function makeState(context: Record<string, unknown>): WizardRuntimeState {
  return {
    flowId: testFlow.id,
    product: 'motor',
    currentState: 'a',
    currentStepId: 'step-a',
    context,
    pendingCommands: [],
    commandSeq: 0,
  };
}

describe('transitionRegistry', () => {
  it('applies first matching guarded transition', () => {
    const result = resolveTransition({
      flow: testFlow,
      state: makeState({ quoteReady: true }),
      event: { type: 'NAV.NEXT' },
      guards: baseGuardRegistry,
    });
    expect(result.applied).toBe(true);
    expect(result.nextState.currentState).toBe('b');
    expect(result.nextState.currentStepId).toBe('step-b');
  });

  it('falls back when first transition guard fails', () => {
    const result = resolveTransition({
      flow: testFlow,
      state: makeState({ quoteReady: false }),
      event: { type: 'NAV.NEXT' },
      guards: baseGuardRegistry,
    });
    expect(result.applied).toBe(true);
    expect(result.nextState.currentState).toBe('a');
  });
});
