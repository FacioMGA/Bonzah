import { ALL_BUCKETS } from './types.js';
import type { CommandContext } from './shared.js';
import { appendClaimEvent } from './shared.js';

type DispatchResult = { handled: boolean; shortCircuit?: boolean };

export async function handleClosureCommands(ctx: CommandContext): Promise<DispatchResult> {
  if (ctx.type === 'CLOSE') {
    const expectedRecoveryOutstanding = ctx.projection.recoveriesExpected + ctx.projection.salvageExpected;
    if (ctx.projection.totalOutstanding > 0 || expectedRecoveryOutstanding > 0) {
      throw new Error('Claim cannot be closed while outstanding reserve or expected recovery remains.');
    }
    const closureReason = String(ctx.payload.closureReason || '').trim().toUpperCase();
    const summary = String(ctx.payload.summary || '').trim();
    if (!closureReason) throw new Error('closureReason is required');
    if (!summary) throw new Error('summary is required');
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'CLAIM_CLOSED',
      payload: {
        closedAt: new Date().toISOString(),
        closureReason,
        summary,
        note: String(ctx.payload.note || '').trim(),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'REOPEN') {
    const reopenReason = String(ctx.payload.reopenReason || '').trim().toUpperCase();
    const summary = String(ctx.payload.summary || '').trim();
    if (!reopenReason) throw new Error('reopenReason is required');
    if (!summary) throw new Error('summary is required');
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'CLAIM_REOPENED',
      payload: {
        reopenedAt: new Date().toISOString(),
        reopenReason,
        summary,
        note: String(ctx.payload.note || '').trim(),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'WITHDRAW') {
    if (ctx.projection.totalPaid > 0 && !Boolean(ctx.payload.allowWithdrawWithPayments)) {
      throw new Error('Cannot withdraw claim with payments recorded');
    }
    for (const bucket of ALL_BUCKETS) {
      await appendClaimEvent({
        tx: ctx.tx,
        claimId: ctx.claim.id,
        claimNumber: ctx.claimNumber,
        command: 'SET_RESERVE',
        input: ctx.input,
        eventType: 'RESERVE_SET',
        payload: {
          bucket,
          newOutstandingAmount: 0,
          reasonCode: 'WITHDRAW_ZERO_OUTSTANDING',
          effectiveDate: String(ctx.payload.withdrawnAt || new Date().toISOString().slice(0, 10)),
        },
      });
    }
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'CLAIM_WITHDRAWN',
      payload: {
        withdrawnAt: String(ctx.payload.withdrawnAt || new Date().toISOString().slice(0, 10)),
        reason: String(ctx.payload.reason || ''),
      },
    });
    return { handled: true };
  }

  return { handled: false };
}

