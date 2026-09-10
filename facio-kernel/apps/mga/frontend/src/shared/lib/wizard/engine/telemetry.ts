import type { TransitionTrace } from './types';

export type WizardTelemetry = {
  onTransition?: (trace: TransitionTrace) => void;
  onCommandError?: (args: { commandType: string; error: string; flowId: string }) => void;
};

export const noopTelemetry: WizardTelemetry = {};
