import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { createBaseCommandHandlers } from './commandHandlers';
import { baseGuardRegistry } from './guards';
import { noopTelemetry } from './telemetry';
import { resolveTransition } from './transitionRegistry';
import type {
  CommandHandlerRegistry,
  GuardRegistry,
  WizardEvent,
  WizardFlowDefinition,
  WizardRuntimeState,
} from './types';

type EngineAction =
  | { type: 'dispatch'; event: WizardEvent }
  | { type: 'drop-command'; commandId: string };

function initRuntime(flow: WizardFlowDefinition, context: Record<string, unknown>): WizardRuntimeState {
  const initialStepId = flow.states[flow.initialState]?.stepId || flow.steps[0]?.id || 'unknown-step';
  return {
    flowId: flow.id,
    product: flow.product,
    currentState: flow.initialState,
    currentStepId: initialStepId,
    context,
    pendingCommands: [],
    commandSeq: 0,
  };
}

export function wizardEngineReducer(args: {
  flow: WizardFlowDefinition;
  guards: GuardRegistry;
  state: WizardRuntimeState;
  action: EngineAction;
}) {
  const { flow, guards, state, action } = args;
  if (action.type === 'drop-command') {
    return {
      ...state,
      pendingCommands: state.pendingCommands.filter((command) => command.id !== action.commandId),
    };
  }
  if (action.event.type === 'ENGINE.CONTEXT_PATCH') {
    return {
      ...state,
      context: {
        ...state.context,
        ...action.event.patch,
      },
    };
  }
  if (action.event.type === 'ENGINE.COMMAND_ERROR') {
    return {
      ...state,
      lastError: action.event.error,
    };
  }
  return resolveTransition({
    flow,
    state,
    event: action.event,
    guards,
  }).nextState;
}

export function useWizardEngine(args: {
  flow: WizardFlowDefinition;
  initialContext?: Record<string, unknown>;
  guards?: GuardRegistry;
  handlers?: CommandHandlerRegistry;
  telemetry?: {
    onTransition?: (args: {
      fromState: string;
      toState: string;
      eventType: string;
      flowId: string;
      product: WizardFlowDefinition['product'];
    }) => void;
    onCommandError?: (args: { commandType: string; error: string; flowId: string }) => void;
  };
}) {
  const { flow, initialContext, guards, handlers, telemetry } = args;
  const mergedGuards = guards || baseGuardRegistry;
  const mergedTelemetry = telemetry || noopTelemetry;
  const mergedHandlers = useMemo(
    () => ({ ...createBaseCommandHandlers(), ...(handlers || {}) }),
    [handlers]
  );

  const reducer = useCallback(
    (state: WizardRuntimeState, action: EngineAction) =>
      wizardEngineReducer({
        flow,
        guards: mergedGuards,
        state,
        action,
      }),
    [flow, mergedGuards]
  );

  const [state, dispatchAction] = useReducer(reducer, initRuntime(flow, initialContext || {}));
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatch = useCallback((event: WizardEvent) => {
    dispatchAction({ type: 'dispatch', event });
  }, []);

  useEffect(() => {
    if (state.pendingCommands.length === 0) {
      return;
    }
    const [command] = state.pendingCommands;
    const handler = mergedHandlers[command.type];
    const dropCommand = () => dispatchAction({ type: 'drop-command', commandId: command.id });

    Promise.resolve()
      .then(async () => {
        if (!handler) {
          throw new Error(`No command handler registered for "${command.type}".`);
        }
        const result = await handler({ command, context: state.context });
        if (result?.patch) {
          dispatch({ type: 'ENGINE.CONTEXT_PATCH', patch: result.patch });
        }
        for (const event of result?.emit || []) {
          dispatch(event);
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown command handler error';
        mergedTelemetry.onCommandError?.({
          commandType: command.type,
          error: message,
          flowId: flow.id,
        });
        dispatch({
          type: 'ENGINE.COMMAND_ERROR',
          commandType: command.type,
          error: message,
        });
      })
      .finally(dropCommand);
  }, [dispatch, flow.id, mergedHandlers, mergedTelemetry, state.context, state.pendingCommands]);

  const transition = useCallback(
    (event: WizardEvent) => {
      const fromState = stateRef.current.currentState;
      const projected = resolveTransition({
        flow,
        state: stateRef.current,
        event,
        guards: mergedGuards,
      });
      dispatchAction({ type: 'dispatch', event });
      mergedTelemetry.onTransition?.({
        fromState,
        toState: projected.nextState.currentState,
        eventType: event.type,
        flowId: flow.id,
        product: flow.product,
      });
    },
    [flow, mergedGuards, mergedTelemetry]
  );

  return {
    state,
    dispatch: transition,
  };
}
