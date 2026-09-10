import { describe, expect, it } from 'vitest';
import { baseGuardRegistry } from './guards';
import { wizardEngineReducer } from './WizardEngine';
import type { WizardFlowDefinition, WizardRuntimeState } from './types';

const flow: WizardFlowDefinition = {
  id: 'engine-test-flow',
  product: 'motor',
  initialState: 'start',
  steps: [
    { id: 's1', title: 'S1', routeKey: 's1' },
    { id: 's2', title: 'S2', routeKey: 's2' },
  ],
  states: {
    start: {
      stepId: 's1',
      on: {
        'NAV.NEXT': {
          target: 'second',
          commands: [{ type: 'engine.noop' }],
        },
      },
    },
    second: {
      stepId: 's2',
    },
  },
};

const initialState: WizardRuntimeState = {
  flowId: flow.id,
  product: flow.product,
  currentState: 'start',
  currentStepId: 's1',
  context: {},
  pendingCommands: [],
  commandSeq: 0,
};

describe('wizardEngineReducer', () => {
  it('moves state and queues command', () => {
    const next = wizardEngineReducer({
      flow,
      guards: baseGuardRegistry,
      state: initialState,
      action: { type: 'dispatch', event: { type: 'NAV.NEXT' } },
    });
    expect(next.currentState).toBe('second');
    expect(next.currentStepId).toBe('s2');
    expect(next.pendingCommands).toHaveLength(1);
    expect(next.pendingCommands[0].type).toBe('engine.noop');
  });

  it('applies context patch events', () => {
    const next = wizardEngineReducer({
      flow,
      guards: baseGuardRegistry,
      state: initialState,
      action: { type: 'dispatch', event: { type: 'ENGINE.CONTEXT_PATCH', patch: { foo: 'bar' } } },
    });
    expect(next.context.foo).toBe('bar');
  });
});
