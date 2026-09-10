/**
 * enqueueSubmissionMemoryRefresh — outbox fan-out of a
 * `SUBMISSION_MEMORY.REFRESH` job (ADR-0044). Mirrors
 * `enqueueClaimMemoryRefresh`: write the envelope inside the caller's
 * transaction; the outbox relay does the actual enqueue.
 */

import type { Prisma } from '@prisma/client';
import { buildDomainEvent } from '../../../../platform/events/domainEvents.js';
import type { WithoutTenantScope } from '../../../../platform/db/tenantExtension.js';

export type SubmissionRefreshReason = 'email_arrived' | 'manual_refresh' | 'backfill' | 'bo_route';

type OutboxClient = {
  outbox?: {
    create?: (args: { data: Prisma.OutboxUncheckedCreateInput }) => Promise<unknown>;
  };
};

export interface EnqueueSubmissionMemoryRefreshInput {
  submissionId: string;
  reason: SubmissionRefreshReason;
  actorId?: string;
  actorName?: string;
  actorType?: 'USER' | 'SYSTEM';
  correlationId?: string;
  causationId?: string;
}

export async function enqueueSubmissionMemoryRefresh(
  db: OutboxClient,
  input: EnqueueSubmissionMemoryRefreshInput,
): Promise<void> {
  const submissionId = String(input.submissionId || '').trim();
  if (!submissionId) return;
  const outboxCreate = db?.outbox?.create;
  if (!outboxCreate) return;

  const envelope = buildDomainEvent({
    eventType: 'SUBMISSION_MEMORY.REFRESH',
    aggregateType: 'POLICY',
    aggregateId: submissionId,
    aggregateVersion: Date.now(),
    actorType: input.actorType ?? 'SYSTEM',
    actorId: input.actorId ?? 'submission-memory-dispatcher',
    reasonCode: 'SUBMISSION_MEMORY_REFRESH_REQUESTED',
    correlationId: input.correlationId,
    causationId: input.causationId,
    data: {
      submissionId,
      reason: input.reason,
      actorId: input.actorId,
      actorName: input.actorName,
      actorType: input.actorType,
    },
  });

  // `operatingTenantId` is injected by the tenant extension at write time;
  // every other required column is supplied here (no laundering cast).
  const outboxData: WithoutTenantScope<Prisma.OutboxUncheckedCreateInput> = {
    eventId: envelope.eventId,
    idempotencyKey: envelope.idempotencyKey ?? null,
    aggregateId: submissionId,
    eventType: envelope.eventType,
    payload: envelope as Prisma.InputJsonValue,
  };
  await outboxCreate({ data: outboxData as Prisma.OutboxUncheckedCreateInput });
}
