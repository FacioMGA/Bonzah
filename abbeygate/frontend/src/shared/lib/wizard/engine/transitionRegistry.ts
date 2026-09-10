import type {
  GuardRegistry,
  WizardCommand,
  WizardEvent,
  WizardFlowDefinition,
  WizardRuntimeState,
  WizardTransition,
} from './types';

const FALLBACK_STEP_ID = 'unknown-step';

export type TransitionResolution = {
  nextState: WizardRuntimeState;
  applied: boolean;
  failedGuards: string[];
};

function toTransitionList(transition: WizardTransition | WizardTransition[]): WizardTransition[] {
  return Array.isArray(transition) ? transition : [transition];
}

function guardsPass(
  transition: WizardTransition,
  guardRegistry: GuardRegistry,
  state: WizardRuntimeState,
  event: WizardEvent
): { ok: boolean; failed: string[] } {
  const guards = transition.guards || [];
  if (guards.length === 0) {
    return { ok: true, failed: [] };
  }
  const failed: string[] = [];
  for (const guardName of guards) {
    const guard = guardRegistry[guardName];
    if (!guard) {
      failed.push(guardName);
      continue;
    }
    const passed = guard({ context: state.context, event });
    if (!passed) {
      failed.push(guardName);
    }
  }
  return { ok: failed.length === 0, failed };
}

function buildCommands(transition: WizardTransition, prevSeq: number): { seq: number; commands: WizardCommand[] } {
  const commandDefs = transition.commands || [];
  let seq = prevSeq;
  const commands = commandDefs.map((commandDef) => {
    seq += 1;
    return {
      id: `cmd-${seq}`,
      type: commandDef.type,
      payload: commandDef.payload,
    };
  });
  return { seq, commands };
}

export function resolveTransition(args: {
  flow: WizardFlowDefinition;
  state: WizardRuntimeState;
  event: WizardEvent;
  guards: GuardRegistry;
}): TransitionResolution {
  const { flow, state, event, guards } = args;
  if (event.type === 'NAV.GOTO') {
    const targetEntry = Object.entries(flow.states).find(([, def]) => def.stepId === event.stepId);
    if (!targetEntry) {
      return { nextState: state, applied: false, failedGuards: [] };
    }
    const [targetStateKey] = targetEntry;
    return {
      applied: true,
      failedGuards: [],
      nextState: {
        ...state,
        currentState: targetStateKey,
        currentStepId: event.stepId,
      },
    };
  }
  const stateDef = flow.states[state.currentState];
  if (!stateDef?.on) {
    return { nextState: state, applied: false, failedGuards: [] };
  }

  const transitions = stateDef.on[event.type];
  if (!transitions) {
    return { nextState: state, applied: false, failedGuards: [] };
  }

  const failedGuards: string[] = [];
  for (const transition of toTransitionList(transitions)) {
    const guardStatus = guardsPass(transition, guards, state, event);
    if (!guardStatus.ok) {
      failedGuards.push(...guardStatus.failed);
      continue;
    }
    const targetStateDef = flow.states[transition.target];
    const nextStepId = targetStateDef?.stepId || state.currentStepId || FALLBACK_STEP_ID;
    const built = buildCommands(transition, state.commandSeq);

    return {
      applied: true,
      failedGuards: [],
      nextState: {
        ...state,
        currentState: transition.target,
        currentStepId: nextStepId,
        commandSeq: built.seq,
        pendingCommands: [...state.pendingCommands, ...built.commands],
        lastError: undefined,
      },
    };
  }

  return { nextState: state, applied: false, failedGuards };
}
