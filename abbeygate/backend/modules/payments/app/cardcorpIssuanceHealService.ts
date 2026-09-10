import type { Policy } from '@prisma/client';
import { createHash } from 'node:crypto';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { appendDomainEvent, buildDomainEvent } from '../../../platform/events/domainEvents.js';
import { logger } from '../../../platform/utils/logger.js';
import { jsonStringify, parseRecord } from '../../policy/app/shared.js';
import { ProductRegistry } from '../../policy/domain/ProductRegistry.js';
import {
  buildIssuedPackReplayIdempotencyKey,
  enqueueIssuedPolicyPackStandalone,
  isDuplicateIssuedPackEventIdError,
} from '../../policy/app/commands/issuedPackEnqueue.js';
import { runCardcorpPaidIssuance } from './cardcorpPolicyIssuanceService.js';

const POLICY_START_MAX_DAYS_AHEAD = 45;

/**
 * Mirror of `cardcorpPublicRouter.resolveInceptionDateFromRenewalDate`,
 * duplicated here so the heal path doesn't need to import HTTP-layer
 * helpers. Kept BEHAVIOURALLY IDENTICAL — both paths feed
 * `runCardcorpPaidIssuance`, so any drift would risk a different
 * inceptionDate on heal vs original (which would corrupt the
 * `INCEPTION` row's effectiveDate and the issued-pack premium period).
 *
 * Failure mode: if the stored renewalDate is more than
 * POLICY_START_MAX_DAYS_AHEAD in the future, we fall back to "now"
 * instead of throwing — the frontend would have rejected such a date
 * earlier in the flow, and we'd rather heal an issued policy with a
 * sensible inception than refuse to ever heal it.
 */
function resolveInceptionDateFromRenewalDate(renewalDateRaw: unknown): Date {
  const now = new Date();
  if (renewalDateRaw === null || renewalDateRaw === undefined || String(renewalDateRaw).trim() === '') {
    return now;
  }
  const renewalDate = new Date(String(renewalDateRaw));
  if (Number.isNaN(renewalDate.getTime())) return now;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const max = new Date(today);
  max.setDate(max.getDate() + POLICY_START_MAX_DAYS_AHEAD);
  const renewalDateOnly = new Date(renewalDate);
  renewalDateOnly.setHours(0, 0, 0, 0);
  if (renewalDateOnly > max) return now;
  return renewalDate > now ? renewalDate : now;
}

/**
 * In-process per-policy lock to prevent N concurrent polling clients
 * from triggering N concurrent heal transactions for the same zombie.
 * `runCardcorpPaidIssuance` is idempotent at the DB layer (it checks
 * for an existing INCEPTION inside its own transaction and re-enqueues
 * the issued-pack outbox event for it), but the lock saves us from
 * hammering the sanctions API and from contention on the
 * `riskTransaction.unique(policyId, transactionNumber)` index.
 */
const inFlight = new Map<string, Promise<HealResult>>();

export type HealResult =
  | { healed: true; reason: 'spine_re_enqueued' }
  | { healed: true; reason: 'issued_pack_requeued' | 'issued_pack_already_queued' }
  | {
      healed: false;
      reason:
        | 'no_payment'
        | 'payment_not_paid'
        | 'inception_already_present'
        | 'in_flight'
        | 'heal_failed'
        | 'product_not_supported';
      error?: string;
    };

export type IssuanceHealReconciliationResult = {
  scanned: number;
  healed: number;
  unchanged: number;
  failed: number;
  nextCursor: IssuanceHealReconciliationCursor | null;
};

export type IssuanceHealReconciliationCursor = {
  updatedAt: Date;
  id: string;
};

export type IssuanceHealReconciliationCursorInput = {
  updatedAt: string;
  id: string;
};

/**
 * ABY-70 — durable self-healing for payment issuance zombies.
 *
 * Background
 * ──────────
 * `applyCardcorpVerifiedStatus` commits the PAID payment row in one
 * transaction and then runs `runCardcorpPaidIssuance` (which writes
 * the INCEPTION row + the `DOC.GENERATE_ISSUED_POLICY_PACK` outbox
 * event) in a SEPARATE transaction. If anything between those two
 * commits fails — sanctions API timeout, premium drift detection,
 * P2002 collision on `transactionNumber`, container OOM-killed
 * mid-flight, ECONNRESET to the DB, etc. — the customer is left in a
 * durable zombie state: payment captured, no documents, no welcome
 * email, no way to recover from any subsequent UX path because:
 *   - Repeated `/cardcorp/.../status` calls short-circuit on
 *     `payment.status === 'PAID'` (until the in-router ABY-54 check
 *     flips them through to apply, but only if the customer's URL
 *     still has gateway query params — which the frontend strips
 *     immediately on the first successful `/status` response).
 *   - The `pending_issuance` UI's `Re-check` button only re-fetches
 *     `issue-readiness`, which is a pure read and never triggers
 *     the issuance spine.
 *
 * The only HTTP surface every customer reliably re-hits in the
 * "pending issuance" UI is `GET .../issue-readiness`. So the durable
 * fix is to attach a tiny self-heal probe to that route: before
 * evaluating readiness, detect zombies and idempotently re-trigger
 * the canonical issuance/doc-pack spine.
 *
 * Idempotency contract
 * ────────────────────
 * `runCardcorpPaidIssuance` already detects a pre-existing INCEPTION
 * row inside its own transaction and returns early after re-enqueueing
 * the issued-pack outbox event with a deterministic `idempotencyKey`
 * (`issued-pack:<policyId>:<riskTransactionId>`). The enqueue spine
 * derives a queue-safe deterministic eventId from that key, and the
 * relay's `event_processing_log` then dedupes the actual job. So if the heal
 * runs concurrently with the original issuance (race) or re-runs after
 * a previous heal succeeded, the worst case is one extra outbox-row
 * insert + one event-log dedupe — no duplicate billing, no duplicate
 * INCEPTION, no duplicate doc generation, no duplicate welcome email.
 *
 * Bounded blast radius
 * ────────────────────
 * - Heal NEVER fires unless `payment.status === 'PAID'`.
 * - If no INCEPTION exists, we re-run the full canonical issuance spine.
 * - If INCEPTION exists but required issued docs are still missing, we
 *   enqueue a time-bucketed issued-pack replay event.
 * - In-process lock prevents N concurrent polls from stacking N
 *   concurrent heal transactions for the same policy.
 * - Errors are logged but never rethrown — the caller still serves
 *   the readiness response, so a failed heal degrades to "still
 *   pending" instead of breaking the polling UX.
 */
export async function attemptIssuanceHealForPolicy(args: {
  policy: Pick<Policy, 'id' | 'policyNumber' | 'productType'>;
  correlationId?: string;
}): Promise<HealResult> {
  const policyId = args.policy.id;

  const pending = inFlight.get(policyId);
  if (pending) {
    try {
      return await pending;
    } catch {
      return { healed: false, reason: 'in_flight' };
    }
  }

  const work = (async (): Promise<HealResult> => {
    try {
      const payment = await tenantScopedPrisma.payment.findFirst({
        where: { policyId, provider: 'CARDCORP' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, paymentId: true, status: true, raw: true, checkoutId: true },
      });
      if (!payment) return { healed: false, reason: 'no_payment' };
      if (payment.status !== 'PAID') return { healed: false, reason: 'payment_not_paid' };

      const inception = await tenantScopedPrisma.riskTransaction.findFirst({
        where: { policyId, transactionType: 'INCEPTION' },
        select: { id: true },
      });
      if (inception) {
        const productType = String(args.policy.productType || '').trim().toUpperCase();
        const adapter = ProductRegistry.getInstance().getAdapter(productType);
        if (!adapter) return { healed: false, reason: 'product_not_supported' };

        const requiredDocTypes = adapter.getRequiredIssuedDocTypes();
        if (requiredDocTypes.length === 0) return { healed: false, reason: 'inception_already_present' };

        const generatedDocs = await tenantScopedPrisma.document.findMany({
          where: {
            policyId,
            riskTransactionId: inception.id,
            docPack: 'ISSUED_POLICY_PACK',
            status: 'GENERATED',
            type: { in: requiredDocTypes },
          },
          select: { type: true },
        });
        const generatedTypes = new Set(generatedDocs.map((doc) => String(doc.type || '').trim()).filter(Boolean));
        const missingTypes = requiredDocTypes.filter((docType) => !generatedTypes.has(docType));
        if (missingTypes.length === 0) return { healed: false, reason: 'inception_already_present' };

        const replayKey = buildIssuedPackReplayIdempotencyKey({
          policyId,
          riskTransactionId: inception.id,
          bucketSeconds: 60,
        });
        try {
          await enqueueIssuedPolicyPackStandalone({
            policyId,
            riskTransactionId: inception.id,
            source: 'SYSTEM',
            idempotencyKey: replayKey,
            correlationId: args.correlationId || `issuance-heal:${policyId}`,
          });
          logger.warn(
            { policyId, riskTransactionId: inception.id, missingDocTypes: missingTypes, replayKey },
            'cardcorp.issuance_heal.issued_pack_requeued',
          );
          return { healed: true, reason: 'issued_pack_requeued' };
        } catch (error) {
          if (isDuplicateIssuedPackEventIdError(error)) {
            return { healed: true, reason: 'issued_pack_already_queued' };
          }
          throw error;
        }
      }

      const rawRecord = parseRecord(payment.raw);
      const resultRecord = parseRecord(rawRecord.result);
      const amount = typeof rawRecord.amount === 'string' ? rawRecord.amount : undefined;
      const currency = typeof rawRecord.currency === 'string' ? rawRecord.currency : undefined;
      const paymentIdFromRaw = typeof rawRecord.id === 'string' ? rawRecord.id : undefined;
      const correlationId = args.correlationId || `issuance-heal:${policyId}:${payment.id}`;

      logger.warn(
        {
          policyId,
          paymentId: payment.id,
          checkoutId: payment.checkoutId,
          paymentResultCode: typeof resultRecord.code === 'string' ? resultRecord.code : undefined,
        },
        'cardcorp.issuance_heal.firing',
      );

      await runCardcorpPaidIssuance({
        policy: { id: policyId, policyNumber: args.policy.policyNumber ?? null },
        updatedPayment: { id: payment.id },
        status: {
          paymentId: payment.paymentId || paymentIdFromRaw,
          amount,
          currency,
        },
        checkoutId: payment.checkoutId || '',
        correlationId,
        baseUrl: '',
        parseRecord,
        jsonStringify,
        resolveInceptionDateFromRenewalDate,
      });

      logger.info(
        { policyId, paymentId: payment.id, correlationId },
        'cardcorp.issuance_heal.completed',
      );
      return { healed: true, reason: 'spine_re_enqueued' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { err: error, policyId, productType: args.policy.productType, message },
        'cardcorp.issuance_heal.failed',
      );
      return { healed: false, reason: 'heal_failed', error: message };
    }
  })();

  inFlight.set(policyId, work);
  try {
    return await work;
  } finally {
    inFlight.delete(policyId);
  }
}

/**
 * Finds every paid CardCorp policy whose issuance evidence is incomplete and
 * delegates each candidate to the canonical healing path. This is deliberately
 * a reconciliation, not a second issuance implementation: all replays still
 * pass through `attemptIssuanceHealForPolicy` and its idempotency contract.
 *
 * The candidate query covers both failure classes that matter operationally:
 * a paid policy with no INCEPTION transaction, and an INCEPTION whose issued
 * document set is absent or whose payment audit records an issued-pack
 * failure. There is intentionally no age cut-off: a missed job must remain
 * recoverable until its canonical issuance evidence is complete. The bounded
 * batch is safe to repeat; once the required documents exist the canonical
 * heal returns an unchanged result.
 */
export async function reconcileCardcorpPaidIssuanceBatch(
  limit = 100,
  cursor?: IssuanceHealReconciliationCursor,
): Promise<IssuanceHealReconciliationResult> {
  const candidates = await tenantScopedPrisma.policy.findMany({
    where: {
      payments: {
        some: { provider: 'CARDCORP', status: 'PAID' },
      },
      OR: [
        {
          riskTransactions: { none: { transactionType: 'INCEPTION' } },
        },
        {
          documents: {
            none: { docPack: 'ISSUED_POLICY_PACK', status: 'GENERATED' },
          },
        },
        {
          payments: {
            some: {
              events: {
                some: {
                  eventType: {
                    in: ['ISSUED_PACK_GENERATION_FAILED', 'ISSUED_PACK_MISSING_DOC_TYPES'],
                  },
                },
              },
            },
          },
        },
      ],
      ...(cursor
        ? {
            AND: [
              {
                OR: [
                  { updatedAt: { gt: cursor.updatedAt } },
                  { updatedAt: cursor.updatedAt, id: { gt: cursor.id } },
                ],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true, policyNumber: true, productType: true, updatedAt: true },
  });

  const result: IssuanceHealReconciliationResult = {
    scanned: candidates.length,
    healed: 0,
    unchanged: 0,
    failed: 0,
    nextCursor: candidates.length === limit
      ? { updatedAt: candidates[candidates.length - 1]!.updatedAt, id: candidates[candidates.length - 1]!.id }
      : null,
  };

  for (const policy of candidates) {
    const outcome = await attemptIssuanceHealForPolicy({
      policy,
      correlationId: `issuance-reconcile:${policy.id}`,
    });
    if (outcome.healed) {
      result.healed += 1;
    } else if (outcome.reason === 'heal_failed') {
      result.failed += 1;
    } else {
      result.unchanged += 1;
    }
  }

  logger.info(result, 'cardcorp.issuance_heal.reconciled');
  return result;
}

/**
 * Continue a full reconciliation page through the canonical outbox relay.
 *
 * A deterministic event id makes a retried worker safe: if it already wrote
 * this continuation before crashing, the retry observes the unique event and
 * treats the work as queued. The cursor is an ordered `(updatedAt, id)` pair,
 * so later incomplete policies cannot be starved by an earlier failed row.
 */
export async function enqueueCardcorpPaidIssuanceReconciliationContinuation(args: {
  operatingTenantId: string;
  cursor: IssuanceHealReconciliationCursor;
  limit: number;
  sweepId: string;
  correlationId?: string;
}): Promise<void> {
  const cursor: IssuanceHealReconciliationCursorInput = {
    updatedAt: args.cursor.updatedAt.toISOString(),
    id: args.cursor.id,
  };
  const key = `issued-pack-reconcile:${args.sweepId}:${cursor.updatedAt}:${cursor.id}`;
  const eventId = `issued-pack-reconcile:${createHash('sha256').update(key).digest('hex')}`;
  const envelope = buildDomainEvent({
    eventId,
    eventType: 'POLICY.ISSUED_PACK_RECONCILE',
    aggregateType: 'POLICY',
    aggregateId: 'system',
    aggregateVersion: Date.now(),
    actorType: 'SYSTEM',
    actorId: 'issued-pack-reconcile-continuation',
    idempotencyKey: key,
    correlationId: args.correlationId,
    data: {
      operatingTenantId: args.operatingTenantId,
      limit: args.limit,
      cursor,
      sweepId: args.sweepId,
    },
  });

  try {
    await appendDomainEvent(tenantScopedPrisma, envelope);
  } catch (error) {
    if (isUniqueOutboxEventIdError(error)) return;
    throw error;
  }
}

function isUniqueOutboxEventIdError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002';
}

/**
 * Test-only escape hatch — clears the in-flight lock map between
 * tests so each spec starts from a clean slate. Production code
 * never calls this.
 */
export function __resetIssuanceHealForTests(): void {
  inFlight.clear();
}
