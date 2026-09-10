import type { WizardFlowDefinition, WizardStepDefinition } from '../engine/types';

function assertUniqueStepIds(steps: WizardStepDefinition[]) {
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) {
      throw new Error(`Duplicate step id "${step.id}" in flow definition.`);
    }
    seen.add(step.id);
  }
}

function assertStateShape(flow: WizardFlowDefinition) {
  if (!flow.states[flow.initialState]) {
    throw new Error(`Flow "${flow.id}" initial state "${flow.initialState}" is missing.`);
  }
  const stepIds = new Set(flow.steps.map((step) => step.id));
  for (const [stateKey, stateDef] of Object.entries(flow.states)) {
    if (stateDef.stepId && !stepIds.has(stateDef.stepId)) {
      throw new Error(`Flow "${flow.id}" state "${stateKey}" references unknown step "${stateDef.stepId}".`);
    }
    const transitions = stateDef.on || {};
    for (const transitionOrList of Object.values(transitions)) {
      const list = Array.isArray(transitionOrList) ? transitionOrList : [transitionOrList];
      for (const transition of list) {
        if (!flow.states[transition.target]) {
          throw new Error(`Flow "${flow.id}" transition target "${transition.target}" is missing.`);
        }
      }
    }
  }
}

export function defineFlow(flow: WizardFlowDefinition): WizardFlowDefinition {
  assertUniqueStepIds(flow.steps);
  assertStateShape(flow);
  return flow;
}
