import type { CommandHandlerRegistry, WizardEvent } from './types';
import { asRecord } from '@/src/shared/lib/record';

export function createBaseCommandHandlers(): CommandHandlerRegistry {
  return {
    'engine.noop': () => undefined,
    'context.patch': ({ command }) => ({ patch: asRecord(command.payload?.patch) }),
    'emit.goto': ({ command }) => {
      const stepId = String(command.payload?.stepId || '');
      if (!stepId) {
        return undefined;
      }
      const event: WizardEvent = { type: 'NAV.GOTO', stepId };
      return { emit: [event] };
    },
  };
}
