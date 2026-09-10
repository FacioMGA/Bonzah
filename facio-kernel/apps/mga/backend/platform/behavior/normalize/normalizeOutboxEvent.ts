/**
 * BEHAVIOR.NORMALIZE — pure async function (also runs as a queue handler).
 *
 * Input:  one outbox event payload (the DomainEventEnvelope JSON we wrote
 *         when the original aggregate change happened).
 * Output: at most one `BehaviorEvent` row, idempotent on `sourceEventId`.
 *
 * Pipeline:
 *   1. Resolve the POLICY entityId (from aggregateId or carried data.policyId).
 *   2. Match the event against the manifest.  Unknown event types are
 *      dropped silently — silence is safer than canonical text we made up.
 *   3. Render canonical text (same shape every run).
 *   4. Embed the canonical text via the configured embedder.
 *   5. Compute deltaMsFromPreviousEvent for that policy (durable cadence).
 *   6. Upsert the BehaviorEvent + write the embedding via raw SQL (pgvector
 *      isn't supported through the typed Prisma client).
 *   7. Return the eventId for downstream BEHAVIOR.TRAJECTORY_UPDATE fan-out.
 *
 * Idempotency: `sourceEventId` is `@unique`; replays simply no-op.
 */
import type { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../db/connection.js';
import { WithoutTenantScope } from '../../db/tenantExtension.js';
import { logger } from '../../utils/logger.js';
import { pgVectorLiteral } from '../vector.js';
import {
  matchManifestEntry,
  readDomainEventLike,
  resolvePolicyEntityId,
  type DomainEventLike,
} from '../manifest/loadManifest.js';
import { renderCanonicalText } from '../manifest/canonicalText.js';
import { getEmbedder } from '../embedding/index.js';

export type NormalizeOutboxEventInput = {
  /** The full domain-event payload, typically `outbox.payload`. */
  payload: unknown;
};

export type NormalizeOutboxEventResult =
  | { status: 'created'; behaviorEventId: string; policyId: string; behaviorType: string }
  | { status: 'duplicate'; policyId: string; behaviorType: string }
  | { status: 'skipped'; reason: string };

type DomainEventEnvelopeShape = DomainEventLike & {
  eventType: string;
  aggregateId: string;
  eventId?: string;
  occurredAt?: string;
};

type LooseEnvelopeIds = {
  eventId?: unknown;
  occurredAt?: unknown;
};

function asEnvelope(payload: unknown): DomainEventEnvelopeShape | null {
  const event = readDomainEventLike(payload);
  if (!event?.eventType?.trim() || !event.aggregateId?.trim()) return null;
  const rec = payload as LooseEnvelopeIds;
  return {
    ...event,
    eventType: event.eventType.trim(),
    aggregateId: event.aggregateId.trim(),
    eventId: typeof rec.eventId === 'string' ? rec.eventId : undefined,
    occurredAt: typeof rec.occurredAt === 'string' ? rec.occurredAt : undefined,
  };
}

async function getPreviousOccurredAt(policyId: string, before: Date): Promise<Date | null> {
  const prev = await tenantScopedPrisma.behaviorEvent.findFirst({
    where: {
      entityType: 'POLICY',
      entityId: policyId,
      occurredAt: { lt: before },
    },
    orderBy: { occurredAt: 'desc' },
    select: { occurredAt: true },
  });
  return prev?.occurredAt ?? null;
}

export async function normalizeOutboxEvent(
  input: NormalizeOutboxEventInput,
): Promise<NormalizeOutboxEventResult> {
  const envelope = asEnvelope(input.payload);
  if (!envelope) return { status: 'skipped', reason: 'INVALID_ENVELOPE' };
  if (!envelope.eventId) return { status: 'skipped', reason: 'MISSING_EVENT_ID' };

  const entry = matchManifestEntry(envelope);
  if (!entry) return { status: 'skipped', reason: 'NO_MANIFEST_MATCH' };

  const policyId = resolvePolicyEntityId(envelope);
  if (!policyId) return { status: 'skipped', reason: 'NO_POLICY_ID' };

  // Idempotency short-circuit. The unique constraint on sourceEventId would
  // catch this anyway, but answering early avoids paying the embedding round-trip.
  const existing = await tenantScopedPrisma.behaviorEvent.findUnique({
    where: { sourceEventId: envelope.eventId },
    select: { id: true },
  });
  if (existing) {
    return { status: 'duplicate', policyId, behaviorType: entry.behaviorType };
  }

  const policy = await tenantScopedPrisma.policy.findUnique({
    where: { id: policyId },
    select: { id: true, operatingTenantId: true, policyNumber: true },
  });
  if (!policy) {
    // The behavior layer is purely additive — never fabricate a policy reference.
    return { status: 'skipped', reason: 'POLICY_NOT_FOUND' };
  }

  const canonicalText = renderCanonicalText(entry, {
    policyId: policy.id,
    policyNumber: policy.policyNumber,
  });

  const occurredAt = envelope.occurredAt ? new Date(envelope.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    return { status: 'skipped', reason: 'INVALID_OCCURRED_AT' };
  }

  const previousAt = await getPreviousOccurredAt(policyId, occurredAt);
  const deltaMs: bigint | null = previousAt
    ? BigInt(Math.max(0, occurredAt.getTime() - previousAt.getTime()))
    : null;

  const embedder = getEmbedder();
  let embedding: number[];
  try {
    embedding = await embedder.embed(canonicalText);
  } catch (err) {
    logger.error({ err, behaviorType: entry.behaviorType, policyId }, 'behavior.normalize.embed_failed');
    throw err;
  }

  // Two-step write so we keep the typed Prisma path for the row and isolate
  // pgvector to a single raw UPDATE. The unique constraint on sourceEventId
  // collapses concurrent racers into one winner; the loser surfaces as a
  // duplicate result on retry.
  // operatingTenantId is auto-injected by the tenant-scoped extension at
  // runtime, so we type the data with `WithoutTenantScope<...>` and cast only
  // at the boundary into Prisma's API.
  const data: WithoutTenantScope<Prisma.BehaviorEventUncheckedCreateInput> = {
    entityType: 'POLICY',
    entityId: policyId,
    behaviorType: entry.behaviorType,
    canonicalText,
    occurredAt,
    deltaMsFromPreviousEvent: deltaMs,
    sourceEventId: envelope.eventId,
    payload: (envelope.data ?? null) as Prisma.InputJsonValue,
  };
  const created = await tenantScopedPrisma.behaviorEvent.create({
    data: data as Prisma.BehaviorEventUncheckedCreateInput,
    select: { id: true, operatingTenantId: true },
  });

  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "behavior_events"
        SET "embedding" = $1::vector
      WHERE "id" = $2
        AND "operatingTenantId" = $3`,
    pgVectorLiteral(embedding),
    created.id,
    created.operatingTenantId,
  );
  if (updated !== 1) {
    throw new Error(`behavior.normalize.vector_update_miss: behaviorEventId=${created.id}`);
  }
  logger.info({
    event: 'behavior.embedding.stored',
    policyId,
    behaviorEventId: created.id,
    behaviorType: entry.behaviorType,
    operatingTenantId: created.operatingTenantId,
    embedder: embedder.name,
  }, 'behavior.embedding.stored');

  return {
    status: 'created',
    behaviorEventId: created.id,
    policyId,
    behaviorType: entry.behaviorType,
  };
}
