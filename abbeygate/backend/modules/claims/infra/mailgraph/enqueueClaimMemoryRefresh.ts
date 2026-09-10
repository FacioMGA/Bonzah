/**
 * enqueueClaimMemoryRefresh — outbox-based fan-out of a
 * `CLAIM_MEMORY.REFRESH` job (ADR-0041).
 *
 * Single point through which manual BO refreshes, MCP
 * `operator.refresh_claim_memory` calls, and the email-arrival hook
 * (Week 2) ask the `CLAIM_MEMORY.REFRESH` BullMQ handler to rebuild a
 * claim's projection.
 *
 * Same pattern as `enqueueAccountIntelligenceProjectionUpdate` in
 * `backend/modules/accounts360/infra/projections/accountIntelligenceProjection.ts`
 * — write the outbox envelope inside the caller's transaction; the
 * outbox relay (`backend/platform/events/relay.ts`) does the actual
 * `queue.add` so the enqueue is consistent with the surrounding write.
 *
 * BullMQ `jobId` defaults to `claim:<claimId>` so duplicate enqueues
 * collapse to a single in-flight job (debounce window enforced by the
 * outbox-relay + queue defaults).  Callers MAY override the reason but
 * must pass one of the canonical `RefreshReason` values.
 */

import type { Prisma } from '@prisma/client';
import { buildDomainEvent } from '../../../../platform/events/domainEvents.js';
import type { RefreshReason } from '../../app/mailgraph/refreshClaimMemoryUseCase.js';

type OutboxClient = {
  outbox?: {
    create?: (args: { data: Prisma.OutboxUncheckedCreateInput }) => Promise<unknown>;
  };
};

export interface EnqueueClaimMemoryRefreshInput {
  claimId: string;
  reason: RefreshReason;
  actorId?: string;
  actorName?: string;
  actorType?: 'USER' | 'SYSTEM';
  correlationId?: string;
  causationId?: string;
}

export async function enqueueClaimMemoryRefresh(db: OutboxClient, input: EnqueueClaimMemoryRefreshInput): Promise<void> {
  const claimId = String(input.claimId || '').trim();
  if (!claimId) return;
  const outboxCreate = db?.outbox?.create;
  if (!outboxCreate) return;

  const envelope = buildDomainEvent({
    eventType: 'CLAIM_MEMORY.REFRESH',
    aggregateType: 'CLAIM',
    aggregateId: claimId,
    aggregateVersion: Date.now(),
    actorType: input.actorType ?? 'SYSTEM',
    actorId: input.actorId ?? 'claim-memory-projection-dispatcher',
    reasonCode: 'CLAIM_MEMORY_REFRESH_REQUESTED',
    correlationId: input.correlationId,
    causationId: input.causationId,
    data: {
      claimId,
      reason: input.reason,
      actorId: input.actorId,
      actorName: input.actorName,
      actorType: input.actorType,
    },
  });

  await outboxCreate({
    data: {
      aggregateId: claimId,
      eventType: envelope.eventType,
      payload: envelope as Prisma.InputJsonValue,
    } as unknown as Prisma.OutboxUncheckedCreateInput,
  });
}
