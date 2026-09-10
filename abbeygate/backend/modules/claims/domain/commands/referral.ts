import type { CommandContext } from './shared.js';
import { appendClaimEvent } from './shared.js';

type DispatchResult = { handled: boolean; shortCircuit?: boolean };

export async function handleReferralCommands(ctx: CommandContext): Promise<DispatchResult> {
  if (ctx.type === 'APPROVE_REFERRAL') {
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'REFERRAL_APPROVED',
      payload: {
        approvedAt: new Date().toISOString(),
        note: String(ctx.payload.note || ''),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'SET_REFERRAL') {
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'REFERRED_SET',
      payload: {
        referred: Boolean(ctx.payload.referred ?? true),
        reasonCode: String(ctx.payload.reasonCode || ''),
        summary: String(ctx.payload.summary || ''),
        attachments: Array.isArray(ctx.payload.attachments) ? ctx.payload.attachments : [],
      },
    });
    return { handled: true };
  }

  return { handled: false };
}

