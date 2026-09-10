/**
 * loadClaimContext — pipeline step 2 (ADR-0041).
 *
 * Deterministic Postgres reads.  Loads the canonical "ground truth" used
 * by every downstream extraction + aggregation step.  No LLM, no Neo4j,
 * no external IO.
 */

import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import type {
  Claim,
  ClaimEvent,
  ClaimReserveTransaction,
  ClaimCounterparty,
  Policy,
  PolicyHolder,
  CommunicationThread,
  CommunicationMessage,
} from '@prisma/client';

export interface ClaimContext {
  claim: Claim;
  policy: Policy | null;
  policyHolder: PolicyHolder | null;
  events: ClaimEvent[];
  reserves: ClaimReserveTransaction[];
  counterparties: ClaimCounterparty[];
  threads: Array<CommunicationThread & { messages: CommunicationMessage[] }>;
}

export type LoadClaimContextResult =
  | { ok: true; context: ClaimContext }
  | { ok: false; code: 'NOT_FOUND'; claimId: string };

export async function loadClaimContext(input: { claimId: string }): Promise<LoadClaimContextResult> {
  const claim = await tenantScopedPrisma.claim.findUnique({
    where: { id: input.claimId },
    include: {
      events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
      reserves: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
      counterparties: { orderBy: [{ createdAt: 'asc' }] },
      policy: { include: { policyHolder: true } },
    },
  });

  if (!claim) {
    return { ok: false, code: 'NOT_FOUND', claimId: input.claimId };
  }

  const threads = await tenantScopedPrisma.communicationThread.findMany({
    where: { entityType: 'CLAIM', entityId: input.claimId },
    include: {
      messages: { orderBy: [{ sentAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] },
    },
    orderBy: [{ lastActivityAt: 'asc' }],
  });

  return {
    ok: true,
    context: {
      claim,
      policy: claim.policy ?? null,
      policyHolder: claim.policy?.policyHolder ?? null,
      events: claim.events,
      reserves: claim.reserves,
      counterparties: claim.counterparties,
      threads,
    },
  };
}
