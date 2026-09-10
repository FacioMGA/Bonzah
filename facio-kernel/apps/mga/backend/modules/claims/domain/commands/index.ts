import type { CommandContext } from './shared.js';
import { handleClosureCommands } from './closure.js';
import { handleFinancialCommands } from './financial.js';
import { handleIntakeCommands } from './intake.js';
import { handleMiscCommands } from './misc.js';
import { handleReferralCommands } from './referral.js';

export type DispatchResult = { handled: boolean; shortCircuit?: boolean };

export async function dispatchClaimCommand(ctx: CommandContext): Promise<DispatchResult> {
  const handlers = [
    handleIntakeCommands,
    handleFinancialCommands,
    handleReferralCommands,
    handleClosureCommands,
    handleMiscCommands,
  ];
  for (const handler of handlers) {
    const result = await handler(ctx);
    if (result.handled) return result;
  }
  return { handled: false };
}

