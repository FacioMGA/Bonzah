/**
 * resolveClaimLinkage — pipeline step 1 (ADR-0041).
 *
 * Multi-signal claim linking — turns a refresh trigger into a confirmed
 * claim identity.  In V1 the trigger already carries the `claimId`
 * (manual refresh from BO, MCP tool call, BullMQ nightly backfill, or
 * the email-arrival path which uses `CommunicationThread.entityId`),
 * so this step is a strict existence + tenant check.
 *
 * The "unlinked communications" queue path described in ADR-0041 §3 lives
 * in the email-arrival handler — when an inbound email cannot be tied to
 * a `CommunicationThread` whose `entityType='CLAIM'`, that handler is the
 * one that drops the message into the operator-review queue.  This
 * function only runs once a claim id is in hand.
 */

import { tenantScopedPrisma } from '../../../../platform/db/connection.js';

export type ResolveClaimLinkageResult =
  | { ok: true; claimId: string; matchedBy: 'explicit_trigger' }
  | { ok: false; code: 'CLAIM_NOT_FOUND'; claimId: string };

export async function resolveClaimLinkage(input: { claimId: string }): Promise<ResolveClaimLinkageResult> {
  const exists = await tenantScopedPrisma.claim.findUnique({
    where: { id: input.claimId },
    select: { id: true },
  });

  if (!exists) {
    return { ok: false, code: 'CLAIM_NOT_FOUND', claimId: input.claimId };
  }

  return { ok: true, claimId: input.claimId, matchedBy: 'explicit_trigger' };
}
