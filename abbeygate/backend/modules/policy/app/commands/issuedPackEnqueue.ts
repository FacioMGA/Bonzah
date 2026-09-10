/**
 * Canonical spine: enqueue DOC.GENERATE_ISSUED_POLICY_PACK
 * ---------------------------------------------------------
 * Every policy issuance path in the system — public (CardCorp), BO
 * (BindPolicy / IssuePolicy), endorsement (IssueEndorsement), and the
 * /v1 API router — uses this helper to schedule the issued-pack
 * document generation. The helper writes a single outbox row using
 * `appendDomainEvent`, so the row is committed atomically with the
 * caller's Prisma transaction (e.g. the same transaction that creates
 * the INCEPTION risk-transaction). The outbox relay (already polling
 * for `POLICY.INDEX_UPDATE` and other events) drains the row to
 * `queues.documents` and the BullMQ worker handler picks it up.
 *
 * Architectural invariants this helper enforces:
 *   1. Atomicity: doc-pack scheduling is part of the same transaction
 *      as the policy state change. If the transaction rolls back, no
 *      outbox row exists; if it commits, the relay is guaranteed to
 *      eventually deliver the job.
 *   2. Single shape: the outbox row payload is always a
 *      `DomainEventEnvelope` with the issuance arguments inside
 *      `envelope.data`. The handler reads from `job.data.data.*`. No
 *      caller hand-rolls a flat payload.
 *   3. Single spine: this is the only function in the codebase that
 *      enqueues `DOC.GENERATE_ISSUED_POLICY_PACK`. Direct calls to
 *      `routeEventToQueue('DOC.GENERATE_ISSUED_POLICY_PACK', …)` are
 *      forbidden and guarded by `lint:no-direct-doc-pack-enqueue`.
 *
 * See ADR-0013 for the rationale.
 */

import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import {
  appendDomainEvent,
  buildDomainEvent,
  type OutboxClient,
} from '../../../../platform/events/domainEvents.js';

export type IssuedPackSource = 'SYSTEM' | 'CUSTOMER' | 'BO' | 'API';

export type EnqueueIssuedPolicyPackArgs = {
  policyId: string;
  riskTransactionId?: string | null;
  source: IssuedPackSource;
  generatedByUserId?: string | null;
  /**
   * When provided, used as the outbox `eventId` to make the enqueue
   * idempotent across retries. Falls back to a fresh UUID. Callers
   * that retry from the same logical action (e.g. customer hits
   * /status twice) should pass the same key so the relay only
   * dispatches one job.
   */
  idempotencyKey?: string | null;
  correlationId?: string | null;
};

export type EnqueueIssuedPolicyPackResult = {
  eventId: string;
};

type PrismaLikeError = {
  code?: string;
  message?: string;
  meta?: {
    target?: unknown;
  };
};

const BULLMQ_SAFE_CUSTOM_ID = /^[A-Za-z0-9_-]+$/;

function toTargetList(target: unknown): string[] {
  if (Array.isArray(target)) return target.map((part) => String(part || '').trim().toLowerCase()).filter(Boolean);
  const single = String(target || '').trim().toLowerCase();
  return single ? [single] : [];
}

/**
 * BullMQ rejects custom job IDs containing ":".
 * The outbox relay maps envelope `eventId` -> BullMQ `jobId`,
 * so idempotency keys with separators must be normalized before
 * they become event IDs.
 */
export function buildIssuedPackEventIdFromIdempotencyKey(idempotencyKey: string): string {
  const key = String(idempotencyKey || '').trim();
  if (!key) throw new Error('buildIssuedPackEventIdFromIdempotencyKey: idempotencyKey is required');
  if (BULLMQ_SAFE_CUSTOM_ID.test(key)) return key;
  const hash = createHash('sha256').update(key).digest('hex');
  return `issued_pack_evt_${hash}`;
}

/**
 * Detect duplicate outbox inserts keyed by `eventId`.
 * Used by retry paths to degrade to "already queued" instead of 500.
 */
export function isDuplicateIssuedPackEventIdError(error: unknown): boolean {
  const e = error as PrismaLikeError;
  if (!e || typeof e !== 'object') return false;
  if (String(e.code || '') !== 'P2002') return false;
  const targets = toTargetList(e.meta?.target);
  if (targets.includes('eventid')) return true;
  return String(e.message || '').toLowerCase().includes('eventid');
}

/**
 * Replay key for "docs still missing, queue again" paths.
 * Buckets by time to dedupe concurrent retries while still allowing
 * controlled replays over time if the previous dispatch already ran.
 */
export function buildIssuedPackReplayIdempotencyKey(args: {
  policyId: string;
  riskTransactionId?: string | null;
  now?: Date;
  bucketSeconds?: number;
}): string {
  const policyId = String(args.policyId || '').trim();
  if (!policyId) throw new Error('buildIssuedPackReplayIdempotencyKey: policyId is required');
  const riskTransactionId = String(args.riskTransactionId || '').trim() || 'no-rt';
  const bucketSecondsRaw = Number(args.bucketSeconds ?? 60);
  const bucketSeconds = Number.isFinite(bucketSecondsRaw) && bucketSecondsRaw > 0 ? Math.floor(bucketSecondsRaw) : 60;
  const bucket = Math.floor((args.now ? args.now.getTime() : Date.now()) / (bucketSeconds * 1000));
  return `issued-pack-replay:${policyId}:${riskTransactionId}:${bucket}`;
}

/**
 * Build the canonical envelope for DOC.GENERATE_ISSUED_POLICY_PACK.
 * Exposed for tests; production callers should use
 * `enqueueIssuedPolicyPack` and never construct envelopes by hand.
 */
export function buildIssuedPolicyPackEnvelope(args: EnqueueIssuedPolicyPackArgs) {
  const policyId = String(args.policyId || '').trim();
  if (!policyId) {
    throw new Error('enqueueIssuedPolicyPack: policyId is required');
  }
  const source: IssuedPackSource = args.source || 'SYSTEM';
  const data: Prisma.InputJsonValue = {
    policyId,
    riskTransactionId: args.riskTransactionId ? String(args.riskTransactionId) : null,
    source,
    generatedByUserId: args.generatedByUserId ? String(args.generatedByUserId) : null,
  };
  // `buildDomainEvent` spreads `...input` after its computed defaults,
  // so passing an explicit `undefined` would clobber the ALS-derived
  // correlationId / freshly-generated eventId. We only include
  // optional fields when the caller actually set them.
  const correlationId = String(args.correlationId || '').trim();
  const idempotencyKey = String(args.idempotencyKey || '').trim();
  const eventId = idempotencyKey
    ? buildIssuedPackEventIdFromIdempotencyKey(idempotencyKey)
    : undefined;
  return buildDomainEvent({
    eventType: 'DOC.GENERATE_ISSUED_POLICY_PACK',
    aggregateType: 'POLICY',
    aggregateId: policyId,
    aggregateVersion: Date.now(),
    actorType: source === 'CUSTOMER' ? 'CUSTOMER' : source === 'BO' ? 'USER' : 'SYSTEM',
    actorId: args.generatedByUserId || (source === 'CUSTOMER' ? 'customer' : 'system'),
    reasonCode: 'ISSUED_PACK_REQUESTED',
    ...(correlationId ? { correlationId } : {}),
    ...(idempotencyKey ? { idempotencyKey, eventId } : {}),
    data,
  });
}

/**
 * Schedule generation of the issued-policy pack for a policy.
 *
 * `db` MUST be a transaction client obtained from the same
 * `$transaction` block that performed the policy state change (e.g.
 * created the INCEPTION risk-transaction). The `OutboxClient`
 * structural type accepts both `Prisma.TransactionClient` (raw
 * Prisma) and `TenantScopedTx` (tenant-scoped extended client) — the
 * helper writes through whichever the caller provides, so the
 * outbox row commits atomically with the issuance.
 *
 * The outbox relay will dispatch the row to the documents queue;
 * the `DOC.GENERATE_ISSUED_POLICY_PACK` worker handler will generate
 * the pack and trigger the welcome-email orchestration.
 */
export async function enqueueIssuedPolicyPack(
  db: OutboxClient,
  args: EnqueueIssuedPolicyPackArgs,
): Promise<EnqueueIssuedPolicyPackResult> {
  const envelope = buildIssuedPolicyPackEnvelope(args);
  await appendDomainEvent(db, envelope);
  return { eventId: envelope.eventId };
}

/**
 * Convenience overload for callers that operate outside any
 * transaction (e.g. backfill / "I noticed missing docs, please
 * regenerate" paths). Writes the outbox row through
 * `tenantScopedPrisma` so it remains tenant-scoped, but does so as
 * a standalone insert. Prefer the transactional form
 * (`enqueueIssuedPolicyPack`) wherever possible — the outbox is
 * only as durable as the surrounding transaction.
 */
export async function enqueueIssuedPolicyPackStandalone(
  args: EnqueueIssuedPolicyPackArgs,
): Promise<EnqueueIssuedPolicyPackResult> {
  return await tenantScopedPrisma.$transaction(async (tx) => {
    return await enqueueIssuedPolicyPack(tx, args);
  });
}
