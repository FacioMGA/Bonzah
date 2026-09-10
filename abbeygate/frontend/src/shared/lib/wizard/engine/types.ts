export type WizardProduct = string;

export type WizardEvent =
  | { type: 'NAV.NEXT' }
  | { type: 'NAV.BACK' }
  | { type: 'NAV.GOTO'; stepId: string }
  | { type: 'FLOW.SUBMIT' }
  | { type: 'FLOW.CANCEL' }
  | { type: 'ENGINE.COMMAND_SUCCESS'; commandType: string; patch?: Record<string, unknown> }
  | { type: 'ENGINE.COMMAND_ERROR'; commandType: string; error: string }
  | { type: 'ENGINE.CONTEXT_PATCH'; patch: Record<string, unknown> };

export type GuardName = string;
export type CommandType = string;

export type WizardCommand = {
  id: string;
  type: CommandType;
  payload?: Record<string, unknown>;
};

export type WizardTransition = {
  target: string;
  guards?: GuardName[];
  commands?: Array<{ type: CommandType; payload?: Record<string, unknown> }>;
};

export type WizardStateDefinition = {
  stepId?: string;
  on?: Record<string, WizardTransition | WizardTransition[]>;
};

export type WizardStepDefinition = {
  id: string;
  title: string;
  routeKey: string;
  kind?: 'form' | 'review' | 'payment' | 'terminal';
};

export type WizardFlowDefinition = {
  id: string;
  product: WizardProduct;
  initialState: string;
  states: Record<string, WizardStateDefinition>;
  steps: WizardStepDefinition[];
};

export type WizardRuntimeState = {
  flowId: string;
  product: WizardProduct;
  currentState: string;
  currentStepId: string;
  context: Record<string, unknown>;
  pendingCommands: WizardCommand[];
  commandSeq: number;
  lastError?: string;
};

export type GuardFn = (args: {
  context: Record<string, unknown>;
  event: WizardEvent;
}) => boolean;

export type GuardRegistry = Record<string, GuardFn>;

export type CommandHandlerResult = {
  patch?: Record<string, unknown>;
  emit?: WizardEvent[];
};

export type CommandHandler = (args: {
  command: WizardCommand;
  context: Record<string, unknown>;
}) => Promise<CommandHandlerResult | void> | CommandHandlerResult | void;

export type CommandHandlerRegistry = Record<string, CommandHandler>;

export type TransitionTrace = {
  fromState: string;
  toState: string;
  eventType: string;
  flowId: string;
  product: WizardProduct;
  failedGuards?: string[];
};
