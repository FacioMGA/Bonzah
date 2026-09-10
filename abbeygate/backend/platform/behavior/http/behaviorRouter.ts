/**
 * Behavior Console HTTP router (BO-mounted).
 *
 * Surfaces the projections built by the Behavior layer:
 *   GET /behavior/policies/:id           — Policy view: trajectory + last 20
 *                                          events + intelligence line.
 *   GET /behavior/policies/:id/similar   — Top-N similar policies via cosine
 *                                          on trajectoryEmbedding.
 *   GET /behavior/events                 — Global feed across the tenant for
 *                                          dev/sales verification.
 *   GET /behavior/trajectories           — Trajectory explorer table.
 *   POST /behavior/replay                — Manual backfill trigger (admin).
 *
 * Tenant scoping is automatic: all reads go through `tenantScopedPrisma`
 * which the platform extension scopes to the current operating tenant.
 *
 * Vector reads use raw SQL because Prisma's type system has no native
 * pgvector support — we read `embedding::text` and parse on the boundary,
 * so callers stay typed.
 */
import express, { type Router } from 'express';
import { z } from 'zod';
import { tenantScopedPrisma } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';
import { buildIntelligenceLine } from '../intelligenceLine.js';
import { getOperatingTenantConfig } from '../../tenant/tenantAls.js';
import { findSimilarPolicyTrajectories, serializeSimilarPolicyTrajectory } from '../similarity.js';
import { replayBehaviorForTenant } from '../replay/replayBehavior.js';

const POLICY_VIEW_DEFAULT_LIMIT = 20;
const POLICY_VIEW_MAX_LIMIT = 50;
const FEED_DEFAULT_LIMIT = 50;
const FEED_MAX_LIMIT = 200;
const SIMILAR_DEFAULT_LIMIT = 5;
const SIMILAR_MAX_LIMIT = 25;
const FAILURE_ZONE_DEFAULT_LIMIT = 5;
const FAILURE_ZONE_MAX_LIMIT = 10;
const EXPLORER_DEFAULT_LIMIT = 100;
const EXPLORER_MAX_LIMIT = 500;

const PolicyViewQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(POLICY_VIEW_MAX_LIMIT).optional(),
});
const SimilarQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(SIMILAR_MAX_LIMIT).optional(),
});
const FailureZoneQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(FAILURE_ZONE_MAX_LIMIT).optional(),
});
const FeedQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(FEED_MAX_LIMIT).optional(),
  policyId: z.string().trim().optional(),
});
const ExplorerQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(EXPLORER_MAX_LIMIT).optional(),
  direction: z.string().trim().optional(),
});
const REPLAY_DEFAULT_LIMIT = 100;
const REPLAY_MAX_LIMIT = 1000;
// Exported for regression tests in `__tests__/behaviorRouter.replay.test.ts`.
// Zod schemas are part of the route's public contract — tests assert that
// invalid bodies are rejected at the boundary before any DB access.
export const ReplayBodySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(REPLAY_MAX_LIMIT).optional(),
  })
  .strict();

type SerializedBehaviorEvent = {
  id: string;
  policyId: string;
  behaviorType: string;
  canonicalText: string;
  occurredAt: string;
  deltaMsFromPreviousEvent: number | null;
  sourceEventId: string;
};

type SerializedTrajectory = {
  policyId: string;
  policyNumber: string | null;
  eventCount: number;
  lastEventAt: string | null;
  lastBehaviorTypes: string[];
  direction: string;
  driftScore: number;
  trajectoryWindowSize: number;
  directionWindowSize: number;
  updatedAt: string;
};

type FailureZoneSeverity = 'normal' | 'watch' | 'alert';
type FailureZoneSignal = {
  code: string;
  severity: FailureZoneSeverity;
  message: string;
  details?: Record<string, unknown>;
};

type FailureZoneSnapshot = {
  policyId: string;
  policyNumber: string | null;
  status: string | null;
  severity: FailureZoneSeverity;
  score: number;
  signals: FailureZoneSignal[];
};

function bigintToNumber(v: bigint | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // Cap at Number.MAX_SAFE_INTEGER for JSON safety. Behavior cadence in ms
  // never approaches this in practice.
  return v > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(v);
}

function decimalToNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : 0;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function parseJsonRecord(v: unknown): Record<string, unknown> {
  if (typeof v === 'string') {
    try {
      return asRecord(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return asRecord(v);
}

function minutesSince(value: Date | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 60000);
}

function severityRank(severity: FailureZoneSeverity): number {
  if (severity === 'alert') return 2;
  if (severity === 'watch') return 1;
  return 0;
}

function maxSeverity(signals: FailureZoneSignal[]): FailureZoneSeverity {
  return signals.reduce<FailureZoneSeverity>((acc, signal) => {
    return severityRank(signal.severity) > severityRank(acc) ? signal.severity : acc;
  }, 'normal');
}

function scoreSignals(signals: FailureZoneSignal[]): number {
  const score = signals.reduce((acc, signal) => {
    return acc + (signal.severity === 'alert' ? 40 : signal.severity === 'watch' ? 20 : 0);
  }, 0);
  return Math.max(0, Math.min(100, score));
}

function welcomeEmailSentFromSnapshot(snapshotValue: unknown): boolean {
  const snapshot = parseJsonRecord(snapshotValue);
  const issuance = asRecord(snapshot.issuance);
  const welcomeEmail = asRecord(issuance.welcomeEmail);
  return Boolean(String(welcomeEmail.sentAt || '').trim());
}

async function loadPolicyTrajectorySerialized(policyId: string): Promise<SerializedTrajectory | null> {
  const traj = await tenantScopedPrisma.policyTrajectory.findUnique({
    where: { policyId },
    select: {
      policyId: true,
      eventCount: true,
      lastEventAt: true,
      lastBehaviorTypes: true,
      direction: true,
      driftScore: true,
      trajectoryWindowSize: true,
      directionWindowSize: true,
      updatedAt: true,
      policy: { select: { policyNumber: true } },
    },
  });
  if (!traj) return null;
  return {
    policyId: traj.policyId,
    policyNumber: traj.policy?.policyNumber ?? null,
    eventCount: traj.eventCount,
    lastEventAt: traj.lastEventAt ? traj.lastEventAt.toISOString() : null,
    lastBehaviorTypes: asStringArray(traj.lastBehaviorTypes),
    direction: traj.direction,
    driftScore: decimalToNumber(traj.driftScore),
    trajectoryWindowSize: traj.trajectoryWindowSize,
    directionWindowSize: traj.directionWindowSize,
    updatedAt: traj.updatedAt.toISOString(),
  };
}

async function loadRecentEventsForPolicy(policyId: string, limit: number): Promise<SerializedBehaviorEvent[]> {
  const rows = await tenantScopedPrisma.behaviorEvent.findMany({
    where: { entityType: 'POLICY', entityId: policyId },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    select: {
      id: true,
      entityId: true,
      behaviorType: true,
      canonicalText: true,
      occurredAt: true,
      deltaMsFromPreviousEvent: true,
      sourceEventId: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    policyId: r.entityId,
    behaviorType: r.behaviorType,
    canonicalText: r.canonicalText,
    occurredAt: r.occurredAt.toISOString(),
    deltaMsFromPreviousEvent: bigintToNumber(r.deltaMsFromPreviousEvent),
    sourceEventId: r.sourceEventId,
  }));
}

/**
 * ABY-268: look for any FAILED FNOL-link email on a claim attached to
 * this policy. The FNOL link is the operator's first customer-facing
 * comm after policy-link, so an undelivered link silently stalls the
 * whole intake. Surface it in the same failure zone that already
 * carries `WELCOME_EMAIL_FAILED`.
 *
 * Cross-table query — claim ↔ communication_thread (`entityType = 'CLAIM'`)
 * ↔ communication_messages — kept narrow by the `CLAIMS_FNOL_LINK`
 * template id (the same canonical set tracked by
 * `loadFnolLinkDeliveryStatus`).
 */
async function loadFailedFnolLinkForPolicy(policyId: string): Promise<{
  claimId: string;
  claimNumber: string | null;
  recipient: string | null;
  failedAt: string | null;
  errorCode: string | null;
} | null> {
  const claims = await tenantScopedPrisma.claim.findMany({
    where: { policyId },
    select: { id: true, claimNumber: true },
  });
  if (claims.length === 0) return null;
  const claimById = new Map(claims.map((c) => [c.id, c]));

  const failedMessage = await tenantScopedPrisma.communicationMessage.findFirst({
    where: {
      status: 'FAILED',
      direction: 'OUTBOUND',
      thread: { entityType: 'CLAIM', entityId: { in: claims.map((c) => c.id) } },
      externalRefs: { path: ['template', 'templateId'], equals: 'CLAIMS_FNOL_LINK' },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      toRecipients: true,
      createdAt: true,
      sentAt: true,
      thread: { select: { entityId: true } },
      deliveryAttempts: {
        orderBy: { attemptedAt: 'desc' },
        select: { errorCode: true, resolvedAt: true },
        take: 1,
      },
    },
  });
  if (!failedMessage) return null;
  const claim = claimById.get(failedMessage.thread.entityId) || null;
  const latestAttempt = failedMessage.deliveryAttempts[0] || null;
  const recipients = Array.isArray(failedMessage.toRecipients) ? failedMessage.toRecipients : [];
  const firstRecipient = recipients.find((r): r is string => typeof r === 'string' && r.trim().length > 0) || null;
  const failedAtSource = latestAttempt?.resolvedAt || failedMessage.sentAt || failedMessage.createdAt;
  return {
    claimId: failedMessage.thread.entityId,
    claimNumber: claim?.claimNumber || null,
    recipient: firstRecipient ? firstRecipient.trim() : null,
    failedAt: failedAtSource ? new Date(failedAtSource).toISOString() : null,
    errorCode: latestAttempt?.errorCode || null,
  };
}

async function loadFailureZoneSnapshot(policyId: string): Promise<FailureZoneSnapshot | null> {
  const slaMinutes = Math.max(5, Number(process.env.BEHAVIOR_FAILURE_ZONE_SLA_MINUTES || 15) || 15);
  const policy = await tenantScopedPrisma.policy.findUnique({
    where: { id: policyId },
    select: {
      id: true,
      policyNumber: true,
      status: true,
      paymentStatus: true,
      stateCurrent: { select: { snapshot: true } },
    },
  });
  if (!policy) return null;

  const [latestPaidPayment, latestInception, issuedDocCount, trajectory, failedFnolLink] = await Promise.all([
    tenantScopedPrisma.payment.findFirst({
      where: { policyId, provider: 'CARDCORP', status: 'PAID' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        events: {
          where: {
            eventType: {
              in: ['WELCOME_EMAIL_SENT', 'WELCOME_EMAIL_FAILED', 'ISSUED_PACK_MISSING_DOC_TYPES'],
            },
          },
          orderBy: { receivedAt: 'desc' },
          select: { eventType: true, payload: true, receivedAt: true },
          take: 10,
        },
      },
    }),
    tenantScopedPrisma.riskTransaction.findFirst({
      where: { policyId, transactionType: 'INCEPTION', status: { in: ['BOUND', 'PENDING_DOCS'] } },
      orderBy: { transactionNumber: 'desc' },
      select: { id: true, status: true, createdAt: true },
    }),
    tenantScopedPrisma.document.count({
      where: { policyId, docPack: 'ISSUED_POLICY_PACK', status: 'GENERATED' },
    }),
    tenantScopedPrisma.policyTrajectory.findUnique({
      where: { policyId },
      select: { direction: true, driftScore: true, eventCount: true },
    }),
    loadFailedFnolLinkForPolicy(policyId),
  ]);

  const signals: FailureZoneSignal[] = [];
  const paidAtMinutes = minutesSince(latestPaidPayment?.createdAt);
  const inceptionAgeMinutes = minutesSince(latestInception?.createdAt);
  const eventTypes = new Set((latestPaidPayment?.events || []).map((event) => event.eventType));
  const welcomeFailure = latestPaidPayment?.events.find((event) => event.eventType === 'WELCOME_EMAIL_FAILED');
  const issuedPackFailure = latestPaidPayment?.events.find((event) => event.eventType === 'ISSUED_PACK_MISSING_DOC_TYPES');
  const welcomeSent = eventTypes.has('WELCOME_EMAIL_SENT') || welcomeEmailSentFromSnapshot(policy.stateCurrent?.snapshot);
  const hasPaidSignal = Boolean(latestPaidPayment?.id || String(policy.paymentStatus || '').toUpperCase() === 'PAID');

  if (hasPaidSignal && !latestInception?.id && (paidAtMinutes ?? 0) >= slaMinutes) {
    signals.push({
      code: 'PAID_WITHOUT_INCEPTION',
      severity: 'alert',
      message: 'Payment is confirmed but no INCEPTION risk transaction is visible after the SLA window.',
      details: { paidAtMinutes, slaMinutes },
    });
  }

  if (latestInception?.status === 'PENDING_DOCS' && (inceptionAgeMinutes ?? 0) >= slaMinutes) {
    signals.push({
      code: 'INCEPTION_PENDING_DOCS_SLA',
      severity: 'alert',
      message: 'INCEPTION is still PENDING_DOCS after the issued-pack SLA window.',
      details: { riskTransactionId: latestInception.id, inceptionAgeMinutes, slaMinutes },
    });
  }

  if (hasPaidSignal && issuedDocCount === 0 && (paidAtMinutes ?? 0) >= slaMinutes) {
    signals.push({
      code: 'ISSUED_DOCS_MISSING_SLA',
      severity: 'alert',
      message: 'Payment is confirmed but no generated issued-policy-pack documents are visible after the SLA window.',
      details: { paidAtMinutes, slaMinutes },
    });
  }

  if (issuedPackFailure) {
    signals.push({
      code: 'ISSUED_PACK_MISSING_DOC_TYPES',
      severity: 'alert',
      message: 'The issued-pack worker recorded missing required document types.',
      details: {
        receivedAt: issuedPackFailure.receivedAt.toISOString(),
        payload: issuedPackFailure.payload,
      },
    });
  }

  // ABY-263 — `welcomeFailure` is any historical WELCOME_EMAIL_FAILED row
  // on the latest paid Payment. `welcomeSent` is true iff a
  // WELCOME_EMAIL_SENT row exists for the same Payment (or the policy
  // state snapshot records `issuance.welcomeEmail.sentAt`).
  // `WELCOME_EMAIL_SENT` is dedup'd at insertion (`maybeRecordWelcomeEmailPaymentEvent`
  // in `policyEmailOrchestration.ts` returns early if any prior row
  // exists), so a single SENT row means the email definitively went
  // through at least once. A subsequent successful retry must
  // therefore suppress the alert — otherwise operators chase resends
  // on policies the customer already received documents for.
  if (welcomeFailure && !welcomeSent) {
    signals.push({
      code: 'WELCOME_EMAIL_FAILED',
      severity: 'alert',
      message: 'The welcome email failed after issued documents were generated.',
      details: {
        receivedAt: welcomeFailure.receivedAt.toISOString(),
        payload: welcomeFailure.payload,
      },
    });
  } else if (issuedDocCount > 0 && !welcomeSent && (paidAtMinutes ?? 0) >= slaMinutes) {
    signals.push({
      code: 'WELCOME_EMAIL_PENDING_SLA',
      severity: 'watch',
      message: 'Issued documents exist but welcome email evidence is still missing after the SLA window.',
      details: { paidAtMinutes, slaMinutes, issuedDocCount },
    });
  }

  // ABY-268 — FNOL link delivery failure. Mirrors WELCOME_EMAIL_FAILED:
  // the trigger is the customer-email worker writing the message row
  // to `status: 'FAILED'` after the retry budget is exhausted (see
  // `backend/workers/handlers/COMMUNICATION_OUTBOUND.ts`). The signal
  // gives the operator a clear next step (resend) rather than letting
  // the claim silently stall in "FNOL sent to policyholder" state.
  if (failedFnolLink) {
    signals.push({
      code: 'FNOL_LINK_DELIVERY_FAILED',
      severity: 'alert',
      message: 'The FNOL intake link email failed to deliver after the worker retry budget was exhausted.',
      details: {
        claimId: failedFnolLink.claimId,
        claimNumber: failedFnolLink.claimNumber,
        recipient: failedFnolLink.recipient,
        failedAt: failedFnolLink.failedAt,
        errorCode: failedFnolLink.errorCode,
      },
    });
  }

  // ABY-263 — `BEHAVIOR_TRAJECTORY_MISSING` is intentionally NOT
  // emitted to the operator-facing failure zone. The signal's own
  // copy was "Diagnostic only — customer unaffected. No customer-facing
  // action needed.", which is the definition of a signal that does
  // not belong in the operator alert UI (it just amplifies signal-to-noise
  // on the Underwriting tab while telling the operator there is
  // nothing to do). Worker lag remains observable in the behavior
  // metrics layer and via the dedicated behavior trajectory
  // explorer; it should not surface as an "Operational watch" banner
  // on a policy.
  //
  // `UNHEALTHY_BEHAVIOR_TRAJECTORY` is kept because it points at a
  // real customer-side concern (the trajectory is drifting) and
  // gives the operator concrete next steps.
  if (trajectory && String(trajectory.direction || '') !== 'HEALTHY' && decimalToNumber(trajectory.driftScore) >= 0.65) {
    signals.push({
      code: 'UNHEALTHY_BEHAVIOR_TRAJECTORY',
      severity: 'watch',
      message: 'The behavior trajectory is already drifting away from healthy.',
      details: {
        direction: trajectory.direction,
        driftScore: decimalToNumber(trajectory.driftScore),
        eventCount: trajectory.eventCount,
      },
    });
  }

  const severity = maxSeverity(signals);
  return {
    policyId,
    policyNumber: policy.policyNumber,
    status: policy.status,
    severity,
    score: scoreSignals(signals),
    signals,
  };
}

async function loadSimilarFailureEvidence(policyId: string, tenantId: string, limit: number) {
  const rows = await findSimilarPolicyTrajectories({ policyId, operatingTenantId: tenantId, limit: limit * 4 });

  const evidence = [];
  for (const row of rows.filter((r) => Number.isFinite(r.distance))) {
    const snapshot = await loadFailureZoneSnapshot(row.policyId);
    if (!snapshot || snapshot.severity === 'normal') continue;
    const serialized = serializeSimilarPolicyTrajectory(row);
    evidence.push({
      ...serialized,
      severity: snapshot.severity,
      score: snapshot.score,
      signals: snapshot.signals.slice(0, 3),
    });
    if (evidence.length >= limit) break;
  }
  return evidence;
}

const router = express.Router();

/**
 * GET /behavior/policies/:id
 *
 * Returns:
 *   {
 *     trajectory: SerializedTrajectory | null,
 *     events: SerializedBehaviorEvent[],   // most-recent-first, default 20
 *     intelligenceLine: string,            // single-sentence narrative
 *   }
 */
router.get('/policies/:id', async (req, res) => {
  try {
    const policyId = String(req.params.id || '').trim();
    if (!policyId) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Missing policy id' } });

    const parsedQuery = PolicyViewQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: parsedQuery.error.message } });
    }
    const limit = parsedQuery.data.limit ?? POLICY_VIEW_DEFAULT_LIMIT;

    const policy = await tenantScopedPrisma.policy.findUnique({
      where: { id: policyId },
      select: { id: true, policyNumber: true, status: true },
    });
    if (!policy) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });
    }

    const [trajectory, events] = await Promise.all([
      loadPolicyTrajectorySerialized(policyId),
      loadRecentEventsForPolicy(policyId, limit),
    ]);

    const intelligenceLine = buildIntelligenceLine({
      direction: trajectory?.direction || 'HEALTHY',
      driftScore: trajectory?.driftScore || 0,
      eventCount: trajectory?.eventCount || events.length,
    });

    return res.json({
      success: true,
      data: {
        policy: { id: policy.id, policyNumber: policy.policyNumber, status: policy.status },
        trajectory,
        events,
        intelligenceLine,
      },
    });
  } catch (err) {
    logger.error({ err }, 'behavior.policy_view.failed');
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to load behavior view' } });
  }
});

/**
 * GET /behavior/policies/:id/similar
 *
 * Returns the top-N policies whose trajectoryEmbedding is closest (cosine)
 * to the given policy's trajectoryEmbedding. The current policy is excluded.
 */
router.get('/policies/:id/similar', async (req, res) => {
  try {
    const policyId = String(req.params.id || '').trim();
    if (!policyId) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Missing policy id' } });

    const parsedQuery = SimilarQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: parsedQuery.error.message } });
    }
    const limit = parsedQuery.data.limit ?? SIMILAR_DEFAULT_LIMIT;

    const tenantConfig = getOperatingTenantConfig();
    if (!tenantConfig) {
      return res.status(401).json({ success: false, error: { code: 'TENANT_REQUIRED', message: 'Tenant context missing' } });
    }

    const rows = await findSimilarPolicyTrajectories({
      policyId,
      operatingTenantId: tenantConfig.id,
      limit,
    });

    const out = rows
      .filter((r) => Number.isFinite(r.distance))
      .map(serializeSimilarPolicyTrajectory);

    return res.json({ success: true, data: { items: out } });
  } catch (err) {
    logger.error({ err }, 'behavior.similar.failed');
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to load similar policies' } });
  }
});

/**
 * GET /behavior/policies/:id/failure-zone
 *
 * Advisory only. Deterministic readiness/issuance gaps decide the current
 * severity; pgvector nearest neighbors provide supporting evidence from
 * policies with similar recent behavior that already showed failure signals.
 */
router.get('/policies/:id/failure-zone', async (req, res) => {
  try {
    const policyId = String(req.params.id || '').trim();
    if (!policyId) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Missing policy id' } });

    const parsedQuery = FailureZoneQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: parsedQuery.error.message } });
    }
    const limit = parsedQuery.data.limit ?? FAILURE_ZONE_DEFAULT_LIMIT;

    const tenantConfig = getOperatingTenantConfig();
    if (!tenantConfig) {
      return res.status(401).json({ success: false, error: { code: 'TENANT_REQUIRED', message: 'Tenant context missing' } });
    }

    const current = await loadFailureZoneSnapshot(policyId);
    if (!current) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });
    }
    const [trajectory, similarFailureEvidence] = await Promise.all([
      loadPolicyTrajectorySerialized(policyId),
      loadSimilarFailureEvidence(policyId, tenantConfig.id, limit),
    ]);
    const evidenceBoost = current.severity === 'normal' && similarFailureEvidence.length > 0;
    const severity: FailureZoneSeverity = evidenceBoost ? 'watch' : current.severity;
    const score = Math.max(current.score, evidenceBoost ? 20 : 0);

    return res.json({
      success: true,
      data: {
        policy: {
          id: current.policyId,
          policyNumber: current.policyNumber,
          status: current.status,
        },
        severity,
        score,
        signals: current.signals,
        trajectory,
        similarFailureEvidence,
      },
    });
  } catch (err) {
    logger.error({ err }, 'behavior.failure_zone.failed');
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to load behavior failure-zone signal' } });
  }
});

/**
 * GET /behavior/events
 *
 * Global behavior feed across the tenant. Optionally filter to a single
 * policyId. Default limit 50, max 200.
 */
router.get('/events', async (req, res) => {
  try {
    const parsedQuery = FeedQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: parsedQuery.error.message } });
    }
    const limit = parsedQuery.data.limit ?? FEED_DEFAULT_LIMIT;
    const policyId = parsedQuery.data.policyId?.trim();

    const where: Record<string, unknown> = { entityType: 'POLICY' };
    if (policyId) where.entityId = policyId;

    const rows = await tenantScopedPrisma.behaviorEvent.findMany({
      where: where as never,
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        entityId: true,
        behaviorType: true,
        canonicalText: true,
        occurredAt: true,
        deltaMsFromPreviousEvent: true,
        sourceEventId: true,
      },
    });
    const items: SerializedBehaviorEvent[] = rows.map((r) => ({
      id: r.id,
      policyId: r.entityId,
      behaviorType: r.behaviorType,
      canonicalText: r.canonicalText,
      occurredAt: r.occurredAt.toISOString(),
      deltaMsFromPreviousEvent: bigintToNumber(r.deltaMsFromPreviousEvent),
      sourceEventId: r.sourceEventId,
    }));
    return res.json({ success: true, data: { items } });
  } catch (err) {
    logger.error({ err }, 'behavior.feed.failed');
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to load behavior feed' } });
  }
});

/**
 * GET /behavior/trajectories
 *
 * Trajectory explorer table. Optional `?direction=DRIFT_TO_CANCELLATION`
 * filter; otherwise sorts by lastEventAt desc.
 */
router.get('/trajectories', async (req, res) => {
  try {
    const parsedQuery = ExplorerQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: parsedQuery.error.message } });
    }
    const limit = parsedQuery.data.limit ?? EXPLORER_DEFAULT_LIMIT;
    const direction = parsedQuery.data.direction?.trim().toUpperCase();

    const where: Record<string, unknown> = {};
    if (direction) where.direction = direction;

    const rows = await tenantScopedPrisma.policyTrajectory.findMany({
      where: where as never,
      orderBy: [{ lastEventAt: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
      select: {
        policyId: true,
        eventCount: true,
        lastEventAt: true,
        direction: true,
        driftScore: true,
        lastBehaviorTypes: true,
        trajectoryWindowSize: true,
        directionWindowSize: true,
        updatedAt: true,
        policy: { select: { policyNumber: true } },
      },
    });
    const items = rows.map<SerializedTrajectory>((r) => ({
      policyId: r.policyId,
      policyNumber: r.policy?.policyNumber ?? null,
      eventCount: r.eventCount,
      lastEventAt: r.lastEventAt ? r.lastEventAt.toISOString() : null,
      lastBehaviorTypes: asStringArray(r.lastBehaviorTypes),
      direction: r.direction,
      driftScore: decimalToNumber(r.driftScore),
      trajectoryWindowSize: r.trajectoryWindowSize,
      directionWindowSize: r.directionWindowSize,
      updatedAt: r.updatedAt.toISOString(),
    }));
    return res.json({ success: true, data: { items } });
  } catch (err) {
    logger.error({ err }, 'behavior.explorer.failed');
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to load trajectories' } });
  }
});

/**
 * POST /behavior/replay
 *
 * Triggers an inline replay of the outbox into the behavior layer. Useful
 * when live fan-out has not populated rows yet. This is
 * synchronous and tenant-scoped — for big backfills, prefer the CLI script.
 */
router.post('/replay', async (req, res) => {
  try {
    const parsed = ReplayBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BODY',
          message: 'Invalid request body',
          details: parsed.error.flatten(),
        },
      });
    }
    const limit = parsed.data.limit ?? REPLAY_DEFAULT_LIMIT;

    const tenantConfig = getOperatingTenantConfig();
    if (!tenantConfig) {
      return res.status(401).json({ success: false, error: { code: 'TENANT_REQUIRED', message: 'Tenant context missing' } });
    }

    const stats = await replayBehaviorForTenant(tenantConfig, {
      limit,
      batchSize: limit,
      includeGapReport: false,
    });
    return res.json({ success: true, data: stats });
  } catch (err) {
    logger.error({ err }, 'behavior.replay.failed');
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to replay outbox' } });
  }
});

export default router;
export const behaviorRouter: Router = router;
