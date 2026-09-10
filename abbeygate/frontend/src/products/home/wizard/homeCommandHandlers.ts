import type { CommandHandlerRegistry, PublicSessionAdapter } from '@/src/shared/lib/wizard';
import { asRecord } from '@/src/shared/lib/record';

/**
 * Engine command handlers for the Home wizard.
 *
 * Mirrors `createMotorCommandHandlers` in shape: each command is a discrete,
 * idempotent verb the engine can replay or trace. Heavy state (rate result,
 * UI gating) lives in `useHomeQuoteWizardController` because it must drive
 * React state directly; here we keep only the side-effects that belong
 * inside an engine command lifecycle.
 */
export function createHomeCommandHandlers(args: {
  policyId: string;
  sessionAdapter: PublicSessionAdapter;
}): CommandHandlerRegistry {
  const { policyId, sessionAdapter } = args;
  return {
    'home.session.saveDraft': async ({ context }) => {
      const quoteData = asRecord(context.quoteData);
      await sessionAdapter.patch(policyId, { quoteData });
      return undefined;
    },
    'home.session.rate': async () => {
      // Controller drives the rate call so it can capture the response into
      // local React state; the engine just records the intent.
      return { patch: { rateRequested: true } };
    },
  };
}
