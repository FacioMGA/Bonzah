
import { Queue, QueueEvents, Worker, type ConnectionOptions } from 'bullmq';
import { type Cluster, type Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { EFFECTIVE_PRISMA_CONNECTION_LIMIT, prisma, tenantScopedPrisma } from '../db/connection.js';
import { captureBackgroundException } from '../observability/sentry.js';
import { createBullMqConnection } from '../redis/connectionOptions.js';
import { logger } from '../utils/logger.js';
import { buildDomainEvent } from './domainEvents.js';
import { buildIssuedPackReconcileEvent, isUniqueOutboxEventIdError } from './issuedPackReconcileSchedule.js';
import { getHandler } from '../../workers/index.js';
import { runWithOperatingTenant } from '../tenant/tenantAls.js';
import { buildTenantConfigFromEnv } from '../tenant/tenantConfigForCli.js';
import { runWithOperatingTenantById } from '../tenant/tenantJobContext.js';
import type { Prisma } from '@prisma/client';

// BullMQ creates internal ioredis connections at Queue/QueueEvents construction time.
// Azure Redis Enterprise can return transient EPIPE/ECONNRESET during the initial
// cluster handshake. Without this guard, those unhandled errors crash the process
// before the HTTP health port is bound.
const transientRedisErrors = new Set(['ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'ETIMEDOUT']);
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    if (transientRedisErrors.has(err.code || '')) {
        logger.warn({ err: { code: err.code, message: err.message, syscall: err.syscall } }, 'redis.transient_uncaught_suppressed');
        // Suppress the crash but keep Sentry visibility — without this, a
        // sustained EPIPE/ECONNRESET storm against Redis is invisible to
        // the observability stack (only Pino warns get written). The
        // rate-limit helper folds repeated occurrences into a single
        // event per fingerprint per minute so we don't burn quota.
        captureBackgroundException(err, {
            tag: 'redis.transient_uncaught_suppressed',
            extra: { code: err.code, syscall: err.syscall },
        });
        return;
    }
    logger.fatal({ err }, 'process.uncaught_exception');
    process.exit(1);
});

// --- REDIS CONNECTION SETUP ---
/**
 * Normalise a boolean-ish env var so trailing whitespace pasted into a
 * Kubernetes Secret (e.g. `"true\n"`) does not silently disable features.
 * Accepts `true`/`1`/`yes`/`on` (case-insensitive) as truthy; anything else
 * (including empty/undefined) is falsy.
 */
function envFlag(value: string | undefined): boolean {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

const isProdLike = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const resolvedRedisHost = String(process.env.REDIS_HOST || '').trim() || (isProdLike ? '' : '127.0.0.1');
const redisHost = resolvedRedisHost || undefined;
const redisPort = parseInt(String(process.env.REDIS_PORT || '6379').trim(), 10);
const redisPassword = process.env.REDIS_PASSWORD;
const redisTls = envFlag(process.env.REDIS_TLS);
const queueModeRaw = String(process.env.QUEUE_MODE || '').trim().toLowerCase(); // 'redis' | 'noop' | 'auto' (default)
const queueMode: 'redis' | 'noop' | 'auto' =
    queueModeRaw === 'redis' ? 'redis' : queueModeRaw === 'noop' ? 'noop' : 'auto';
if (!process.env.REDIS_HOST && !isProdLike) {
    logger.info({ host: resolvedRedisHost, port: redisPort }, 'redis.dev_default_applied');
}

// IMPORTANT:
// Do NOT auto-enable cluster mode based on hostname.
// If you really run Redis Cluster, set REDIS_ENABLE_CLUSTER=true (or REDIS_CLUSTERED=true) explicitly.
const redisEnableCluster = envFlag(process.env.REDIS_ENABLE_CLUSTER) || envFlag(process.env.REDIS_CLUSTERED);

const debugRedis = envFlag(process.env.DEBUG_REDIS);
if (debugRedis) {
    logger.debug({
        host: redisHost,
        port: redisPort,
        tlsEnv: process.env.REDIS_TLS,
        computedTls: redisTls,
        hasPassword: !!redisPassword,
        enableCluster: redisEnableCluster
    }, 'redis.config');
}

// Lazy connection: defer all Redis/ioredis side effects until ensureQueueRedisReady()
// is called. This prevents module-scope EPIPE/ECONNRESET from blocking or crashing
// the process before the HTTP health port is bound.
let connection: unknown = null;
let runtimeConnection: Redis | Cluster | null = null;
let redisReadyPromise: Promise<void> | null = null;
let connectionInitialized = false;

function initializeConnection(): void {
    if (connectionInitialized) return;
    connectionInitialized = true;

    if (queueMode === 'noop') {
        if ((process.env.NODE_ENV || 'development') !== 'test') {
            throw new Error('FATAL: QUEUE_MODE=noop is only allowed in test mode.');
        }
        connection = null;
        return;
    }
    if (queueMode === 'redis' && !redisHost) {
        throw new Error('FATAL: QUEUE_MODE=redis requires REDIS_HOST to be set.');
    }
    if (!redisHost) {
        throw new Error('FATAL: REDIS_HOST is required.');
    }

    // Single canonical factory — branches on REDIS_ENABLE_CLUSTER
    // internally so callers can't drift like pdfWorker did before
    // 2026-05-17 (commit `ec118964` standalone-against-cluster bug).
    logger.info(
        { mode: redisEnableCluster ? 'cluster' : 'standalone', host: redisHost, port: redisPort, tls: redisTls },
        'redis.connecting',
    );
    runtimeConnection = createBullMqConnection();

    if (runtimeConnection) {
        runtimeConnection.on('error', (err: unknown) => {
            logger.error({ err }, 'redis.connection_error');
            captureBackgroundException(err, { tag: 'queue.redis.connection_error' });
        });
        runtimeConnection.on('connect', () => {
            logger.info('redis.connected');
        });
        redisReadyPromise = (async () => {
            const maxAttempts = 10;
            const baseDelayMs = 500;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    const client = runtimeConnection as { connect?: () => Promise<unknown>; status?: unknown } | null;
                    const status = String(client?.status || '').toLowerCase();
                    if (typeof client?.connect === 'function' && (status === '' || status === 'wait' || status === 'end' || status === 'close')) {
                        await client.connect();
                    }
                    if (typeof (runtimeConnection as { ping?: () => Promise<unknown> }).ping === 'function') {
                        await (runtimeConnection as { ping: () => Promise<unknown> }).ping();
                    }
                    return;
                } catch (err: unknown) {
                    const code = (err as NodeJS.ErrnoException)?.code || '';
                    const isTransient = ['ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'ETIMEDOUT'].includes(code);
                    if (!isTransient || attempt === maxAttempts) {
                        throw err;
                    }
                    const delayMs = baseDelayMs * attempt;
                    logger.warn({ attempt, maxAttempts, code, delayMs }, 'redis.startup_retry');
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                }
            }
        })();
        connection = runtimeConnection;
    }

    if (!connection) {
        if ((process.env.NODE_ENV || 'development') !== 'test') {
            logger.warn({ reason: 'REDIS_HOST not set' }, 'queue.noop_mode');
        }
    }
}

export function getConnection(): unknown { initializeConnection(); return connection; }
export { connection };
let workersInitialized = false;

export async function ensureQueueRedisReady(): Promise<void> {
    if ((process.env.NODE_ENV || 'development') === 'test') return;
    initializeConnection();
    if (!connection || !redisReadyPromise) {
        throw new Error('FATAL: Redis connection is not configured for queues.');
    }
    await redisReadyPromise;
}

// Queue names must be wrapped in {} for Redis Cluster compatibility (CROSSSLOT fix)
export const QUEUE_NAMES = {
    NOTIFICATIONS: '{notifications}',
    DOCUMENTS: '{documents}',
    DATA_SYNC: '{data-sync}',
};

// --- NO-QUEUE IMPLEMENTATION ---
class NoopQueue {
    name: string;
    constructor(name: string) {
        this.name = name;
    }
    async add(name: string, data: unknown, _opts?: unknown) {
        if (debugRedis) {
            logger.debug({ queue: this.name, name, data }, 'queue.noop_job_added');
        }
        return { id: 'mock-job-id', name, data };
    }
}

// Lazy Queue/QueueEvents creation — deferred until first access so module-scope
// import does not trigger ioredis Cluster connections during process bootstrap.
let _queuesInitialized = false;
const _queues = {
    notifications: null as Queue | NoopQueue | null,
    documents: null as Queue | NoopQueue | null,
    dataSync: null as Queue | NoopQueue | null,
};
const _queueEvents = {
    documents: null as QueueEvents | null,
};

function ensureQueuesCreated(): void {
    if (_queuesInitialized) return;
    _queuesInitialized = true;
    initializeConnection();
    _queues.notifications = connection ? new Queue(QUEUE_NAMES.NOTIFICATIONS, { connection: connection as ConnectionOptions }) : new NoopQueue(QUEUE_NAMES.NOTIFICATIONS);
    _queues.documents = connection ? new Queue(QUEUE_NAMES.DOCUMENTS, { connection: connection as ConnectionOptions }) : new NoopQueue(QUEUE_NAMES.DOCUMENTS);
    _queues.dataSync = connection ? new Queue(QUEUE_NAMES.DATA_SYNC, { connection: connection as ConnectionOptions }) : new NoopQueue(QUEUE_NAMES.DATA_SYNC);
    _queueEvents.documents = connection ? new QueueEvents(QUEUE_NAMES.DOCUMENTS, { connection: connection as ConnectionOptions }) : null;
}

export const queues = new Proxy(_queues, {
    get(target, prop, receiver) {
        ensureQueuesCreated();
        return Reflect.get(target, prop, receiver);
    },
}) as { notifications: Queue | NoopQueue; documents: Queue | NoopQueue; dataSync: Queue | NoopQueue };

export const queueEvents = new Proxy(_queueEvents, {
    get(target, prop, receiver) {
        ensureQueuesCreated();
        return Reflect.get(target, prop, receiver);
    },
}) as { documents: QueueEvents | null };

export async function addJobAndWait<T = unknown>(
    eventType: string,
    payload: unknown,
    opts?: { timeoutMs?: number }
): Promise<T> {
    if (!connection || !queueEvents.documents || !(queues.documents instanceof Queue)) {
        throw new Error('Queues are not configured (missing Redis connection / QueueEvents).');
    }
    const job = await queues.documents.add(eventType, payload, {
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
    });
    const timeoutMs = opts?.timeoutMs ?? Number(process.env.DOC_QUEUE_WAIT_TIMEOUT_MS || 120_000);
    return (await job.waitUntilFinished(queueEvents.documents, timeoutMs)) as T;
}

// ─── Re-exports for backward compatibility (extracted to separate modules) ───
// CHAMPS: SMTP client extracted to smtpClient.ts
export { smtpSendMail } from './smtpClient.js';
// CHAMPS: Policy email orchestration extracted to policyEmailOrchestration.ts
export { maybeSendWelcomeEmailForIssuedPack, sendEndorsementIssueEmailWithAttachments, missingIssuedDocTypes, promoteIssuedLifecycle, recordIssuedPackFailurePaymentEvent } from './policyEmailOrchestration.js';

// ── Behavior layer fan-out ────────────────────────────────────────────────────
// Lazily-loaded set of eventTypes the policy behavior manifest cares about.
// We compute it once and reuse the cache. Loading is intentionally lazy so
// that a misconfigured manifest never blocks the queue from starting.
let _behaviorEventTypeSet: Set<string> | null = null;
async function loadBehaviorEventTypeSet(): Promise<Set<string> | null> {
    if (_behaviorEventTypeSet) return _behaviorEventTypeSet;
    try {
        const mod = await import('../behavior/manifest/loadManifest.js');
        const manifest = mod.loadPolicyBehaviorManifest();
        _behaviorEventTypeSet = new Set(manifest.entries.map((e) => e.match.eventType));
        return _behaviorEventTypeSet;
    } catch (err) {
        logger.warn({ err }, 'behavior.manifest.load_failed');
        _behaviorEventTypeSet = new Set();
        return _behaviorEventTypeSet;
    }
}

function bullMqSafeJobId(value: string | undefined): string | undefined {
    const raw = String(value || '').trim();
    if (!raw) return undefined;
    if (/^[A-Za-z0-9_-]+$/.test(raw)) return raw;
    return `safe_job_${createHash('sha256').update(raw).digest('hex')}`;
}

// Audit-only event types. These are written to the outbox table for
// compliance / observability but have no worker handler by design —
// `emitCommAuditEvent` in `backend/modules/communications/infra/audit/
// commAuditEvents.ts` and the matching docstring there are the
// emitting side. Before 2026-05-17 the relay defaulted these to the
// data-sync queue, which then threw `Unsupported data-sync queue job:
// COMM.MESSAGE_SENT` (ABBEYGATE-7: 91 exhausted jobs / 15h). Routing
// them through `kind: 'audit_only'` keeps the outbox row marked
// processed without burning a Redis round-trip.
//
// Per `docs/architecture/contracts/events-and-projections.md`,
// `platform/` cannot import from `modules/`, so this set is the
// canonical owner of the "no worker handler expected" decision and
// the communications module's audit comment references this file.
const AUDIT_ONLY_EVENT_TYPES: ReadonlySet<string> = new Set([
    'COMM.MESSAGE_SENT',
    'COMM.MESSAGE_DELIVERED',
    'COMM.MESSAGE_FAILED',
    'COMM.MESSAGE_RECEIVED',
    'COMM.NOTE_CREATED',
    // Domain status events (P1 2026-07-21): these have NO data-sync worker
    // handler, so the default `dataSync` route made every one throw
    // `Unsupported data-sync queue job: POLICY.STATUS_CHANGED`, exhaust its
    // retries, and accrue failed jobs until the (noeviction) Redis OOM'd and
    // wedged all queues. They are consumed only via the behavior fan-out
    // (BEHAVIOR.NORMALIZE), which now runs for audit-only events too, so
    // routing them audit-only stops the failure storm without losing behavior.
    'POLICY.STATUS_CHANGED',
    'PAYMENT.STATUS_CHANGED',
    'RISK_TRANSACTION.STATUS_CHANGED',
    'DOCUMENT_SET.STATUS_CHANGED',
    // Same class (2026-07-21): the sanctions decision is already persisted
    // (compliance_decisions) at decision time; the emitted event has NO
    // data-sync handler, so the default route threw `Unsupported data-sync
    // queue job: POLICY.COMPLIANCE.SANCTIONS_DECIDED` and fast-failed. It is
    // audit/behavior-only — route audit-only (behavior fan-out still runs).
    'POLICY.COMPLIANCE.SANCTIONS_DECIDED',
    // Same class (2026-08-14, ABBEYGATE-7 recurrence): the CardCorp webhook
    // receiver (`cardcorpWebhookProcessingService`) does ALL of its real work
    // inline — replay-guard, AES-GCM decrypt, and the `WEBHOOK_RECEIVED`
    // paymentEvent write. These `WEBHOOK.CARDCORP.*` outbox rows are pure
    // audit/observability records with NO worker handler, so the default
    // `dataSync` route threw `Unsupported data-sync queue job:
    // WEBHOOK.CARDCORP.DECRYPTED` on every live payment notification, burned 3
    // retries, and accrued failed jobs (the exact retention pressure that
    // OOM'd Redis on 2026-07-21). Route audit-only; issuance is unaffected
    // because it is driven by the CardCorp status-verify path, not by any
    // consumer of these events.
    'WEBHOOK.CARDCORP.DECRYPTED',
    'WEBHOOK.CARDCORP.DUPLICATE',
    'WEBHOOK.CARDCORP.ENCRYPTED',
    'WEBHOOK.CARDCORP.ERROR',
]);

export type EventRoute =
    | { kind: 'enqueue'; queue: 'notifications' | 'documents' | 'dataSync' }
    | { kind: 'audit_only' };

// Pure routing decision. Exported for test — `routeEventToQueue`
// applies the decision against the real BullMQ queues.
export function decideEventRoute(eventType: string): EventRoute {
    if (AUDIT_ONLY_EVENT_TYPES.has(eventType)) {
        return { kind: 'audit_only' };
    }
    if (
        eventType.startsWith('EMAIL.') ||
        eventType.startsWith('RENEWAL.') ||
        eventType.startsWith('SLACK.') ||
        eventType === 'COMM.OUTBOUND_QUEUED'
    ) {
        return { kind: 'enqueue', queue: 'notifications' };
    }
    if (eventType.startsWith('DOC.') || eventType.startsWith('PDF.') || eventType.startsWith('XLSX.')) {
        return { kind: 'enqueue', queue: 'documents' };
    }
    return { kind: 'enqueue', queue: 'dataSync' };
}

// Failed-job retention (P1 2026-07-21 Redis OOM). Without a `removeOnFail`
// bound, failed BullMQ jobs accrue forever; on a `noeviction` cache that
// eventually fills Redis and wedges every queue. Cap retained failures so a
// routing bug or poison job can never exhaust Redis again.
const FAILED_JOB_RETENTION = { age: 24 * 60 * 60, count: 1000 } as const;

// Behavior-layer fan-out: if the manifest maps this eventType, emit a sibling
// BEHAVIOR.NORMALIZE job carrying the original payload. Runs for BOTH enqueued
// and audit-only events, so routing a domain status event (e.g.
// POLICY.STATUS_CHANGED) audit-only does not silently drop behavior
// normalization. Strictly additive — must NEVER affect primary dispatch.
async function dispatchBehaviorFanout(eventType: string, payload: unknown, eventId: string | undefined): Promise<void> {
    try {
        const set = await loadBehaviorEventTypeSet();
        if (set && set.has(eventType)) {
            await queues.dataSync.add('BEHAVIOR.NORMALIZE', payload, {
                jobId: bullMqSafeJobId(eventId ? `behavior:${eventId}` : undefined),
                removeOnComplete: true,
                removeOnFail: FAILED_JOB_RETENTION,
                attempts: 3,
                backoff: { type: 'exponential', delay: 1000 },
            });
        }
    } catch (err) {
        logger.warn({ err, eventType }, 'behavior.fanout.failed');
    }
}

// Idempotent per-aggregate projection rebuilds. Each of these worker jobs
// fully rebuilds a projection/index from current source state, so only the
// newest rebuild for a given aggregate matters. We coalesce every pending
// rebuild for one aggregate onto a single BullMQ jobId (derived from the
// aggregateId) instead of the per-event eventId. This caps same-aggregate
// rebuilds to one in flight, which both collapses backlog storms and removes
// the row-lock contention that blew the tenant transaction timeout (Prisma
// P2028) during the 2026-07-21 Redis-incident backlog drain. Any tail-race
// drift (an event that lands mid-rebuild and is coalesced away) is healed by
// the periodic *.PROJECTION_RECONCILE / *.INDEX_RECONCILE workers scheduled in
// this file.
const COALESCE_REBUILD_BY_AGGREGATE: ReadonlySet<string> = new Set([
    'ACCOUNTS360.PROJECTION_UPDATE',
    'ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE',
    'POLICY.INDEX_UPDATE',
]);

// Returns a deterministic per-aggregate coalescing key for the rebuild event
// types above, or undefined for every other event (which keeps its per-event
// eventId jobId). Exported for unit coverage.
export function rebuildCoalesceJobKey(eventType: string, payload: unknown): string | undefined {
    if (!COALESCE_REBUILD_BY_AGGREGATE.has(eventType)) return undefined;
    if (!payload || typeof payload !== 'object') return undefined;
    const envelope = payload as { aggregateId?: unknown; data?: unknown };
    const data =
        envelope.data && typeof envelope.data === 'object'
            ? (envelope.data as { accountId?: unknown; policyId?: unknown })
            : {};
    const aggregateId =
        [envelope.aggregateId, data.accountId, data.policyId]
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .find((value) => value.length > 0) || '';
    if (!aggregateId) return undefined;
    return `rebuild_${eventType}_${aggregateId}`;
}

// Helper: Route event type to correct queue
export async function routeEventToQueue(eventType: string, payload: unknown): Promise<{ id: string; name: string }> {
    const route = decideEventRoute(eventType);
    const payloadRecord = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const eventId = typeof payloadRecord.eventId === 'string' ? payloadRecord.eventId : undefined;
    const correlationId = typeof payloadRecord.correlationId === 'string' ? payloadRecord.correlationId : undefined;

    if (route.kind === 'audit_only') {
        // No primary worker job. The relay still marks the outbox row
        // processed via its normal flow; we return a synthetic job
        // descriptor so the relay's logging stays uniform. The behavior
        // fan-out still runs so audit-only domain events keep normalizing.
        logger.info({
            event: 'relay.audit_only',
            eventType,
            eventId,
            correlationId,
        }, 'relay.audit_only');
        await dispatchBehaviorFanout(eventType, payload, eventId);
        return { id: '', name: eventType };
    }

    const queue = queues[route.queue];
    // Coalesce idempotent per-aggregate rebuilds onto one jobId per aggregate;
    // every other event keeps its unique per-event id.
    const coalesceKey = rebuildCoalesceJobKey(eventType, payload);
    const job = await queue.add(eventType, payload, {
        jobId: bullMqSafeJobId(coalesceKey ?? eventId),
        removeOnComplete: true,
        removeOnFail: FAILED_JOB_RETENTION,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
    });
    if (eventType === 'COMM.OUTBOUND_QUEUED') {
        logger.info({
            event: 'comms.queue.enqueued',
            eventType,
            eventId,
            correlationId,
            jobId: (job as { id?: string | number }).id,
            queue: queue.name,
        }, 'comms.queue.enqueued');
    }

    await dispatchBehaviorFanout(eventType, payload, eventId);

    return {
        id: String((job as { id?: string | number }).id ?? ''),
        name: eventType,
    };
}

function eventIdFromJob(job: { id?: string | number; data?: unknown }): string {
    const record = job.data && typeof job.data === 'object' ? (job.data as Record<string, unknown>) : {};
    if (typeof record.eventId === 'string' && record.eventId.trim()) return record.eventId.trim();
    return String(job.id ?? '').trim();
}

async function wasEventProcessedByConsumer(consumerName: string, job: { id?: string | number; data?: unknown }): Promise<boolean> {
    const eventId = eventIdFromJob(job);
    if (!eventId) return false;
    try {
        const rows = await prisma.$queryRaw<Array<{ found: number }>>`
          SELECT 1 as found
          FROM "event_processing_log"
          WHERE "eventId" = ${eventId}
            AND "consumerName" = ${consumerName}
          LIMIT 1
        `;
        return Boolean(rows?.[0]?.found);
    } catch {
        // Table may not exist yet during rollout.
        return false;
    }
}

async function markEventProcessedByConsumer(consumerName: string, job: { id?: string | number; data?: unknown }): Promise<void> {
    const eventId = eventIdFromJob(job);
    if (!eventId) return;
    const jobId = String(job.id ?? '').trim() || null;
    try {
        await prisma.$executeRaw`
          INSERT INTO "event_processing_log" ("eventId", "consumerName", "jobId", "processedAt")
          VALUES (${eventId}, ${consumerName}, ${jobId}, NOW())
          ON CONFLICT ("eventId", "consumerName") DO NOTHING
        `;
    } catch {
        // Ignore if table isn't created yet; fallback to queue-level dedupe.
    }
}

/**
 * Fire-and-forget helper for system-level outbox writes that run outside any
 * HTTP request context (bootstrap at startup, periodic reconcile timers).
 *
 * System-only callers use the deployment tenant; tenant-meaningful callers provide an explicit operating tenant id.
 */
function enqueueOutboxEvent(
    data: Omit<Prisma.OutboxUncheckedCreateInput, 'operatingTenantId'>,
    operatingTenantId?: string,
): void {
    // The tenant extension injects operatingTenantId from the selected ALS runner.
    const write = async () => {
        // Prisma returns a thenable, not a native Promise. Await it inside
        // the tenant ALS scope so the tenant extension injects the operating
        // tenant before Prisma starts the write.
        await tenantScopedPrisma.outbox.create({
            data: data as Prisma.OutboxUncheckedCreateInput,
        });
    };
    const scheduledWrite = operatingTenantId
        ? runWithOperatingTenantById(operatingTenantId, write)
        : runWithOperatingTenant(buildTenantConfigFromEnv(), write);
    void scheduledWrite.catch((err: unknown) => {
        if (data.eventId && isUniqueOutboxEventIdError(err)) {
            logger.debug(
                {
                    event: 'queue.system_outbox.enqueue_duplicate',
                    eventId: data.eventId,
                    eventType: data.eventType,
                    aggregateId: data.aggregateId,
                    operatingTenantId,
                },
                'queue.system_outbox.enqueue_duplicate',
            );
            return;
        }
        logger.error(
            {
                event: 'queue.system_outbox.enqueue_failed',
                eventType: data.eventType,
                aggregateId: data.aggregateId,
                operatingTenantId,
                err,
            },
            'queue.system_outbox.enqueue_failed',
        );
    });
}

function enqueueIssuedPackReconcileForActiveProductionTenants(args: {
    actorId: 'queue-bootstrap' | 'queue-reconcile';
    scheduleKey: string;
}): void {
    void prisma.tenant.findMany({ // guard:cross-tenant-intentional - scheduler enumerates active production tenants before restoring each explicit tenant context.
        where: { kind: 'PRODUCTION', status: 'ACTIVE' },
        select: { id: true },
    }).then((tenants) => {
        for (const tenant of tenants) {
            const envelope = buildIssuedPackReconcileEvent({
                tenantId: tenant.id,
                actorId: args.actorId,
                scheduleKey: args.scheduleKey,
                limit: Number(process.env.POLICY_ISSUED_PACK_RECONCILE_LIMIT || 100),
            });
            enqueueOutboxEvent({
                eventId: envelope.eventId,
                idempotencyKey: envelope.idempotencyKey || null,
                aggregateId: envelope.aggregateId,
                eventType: envelope.eventType,
                payload: envelope as Prisma.InputJsonValue,
            }, tenant.id);
        }
    }).catch((err: unknown) => {
        logger.error({ event: 'queue.issued_pack_reconcile.schedule_failed', err }, 'queue.issued_pack_reconcile.schedule_failed');
    });
}

export function initWorkers() {
    if (workersInitialized) {
        logger.warn('queue.workers.already_initialized');
        return;
    }
    initializeConnection();
    // Register built-in handlers lazily here instead of at module scope
    // to break the circular import chain that caused module-scope Redis
    // side effects during process bootstrap.
    import('../../workers/registerBuiltInHandlers.js').catch((err: unknown) => {
        logger.error({ err }, 'Failed to register built-in worker handlers');
    });
    if (!connection) {
        logger.info({ reason: 'redis_not_configured' }, 'queue.workers.skipped');
        return;
    }

    const enabledRaw = String(process.env.QUEUE_WORKERS_ENABLED || '').trim().toLowerCase();
    const enabled =
        enabledRaw === 'true'
            ? true
            : enabledRaw === 'false'
                ? false
                : (String(process.env.NODE_ENV || '').toLowerCase() !== 'production'); // default: enabled in dev, disabled in prod

    if (!enabled) {
        logger.info({ reason: 'QUEUE_WORKERS_ENABLED=false' }, 'queue.workers.skipped');
        return;
    }

    const role = String(process.env.WORKER_ROLE || 'all').trim().toLowerCase();
    const enabledQueues = role === 'all'
        ? ['notifications', 'documents', 'data-sync']
        : role.split(',').map((value) => value.trim()).filter(Boolean);
    const queueEnabled = (queueName: string) => enabledQueues.includes(queueName);
    // One process serves all enabled queues against one Prisma pool. Derive the
    // default from the effective URL value (which can override the env default),
    // and reserve at least one connection for non-worker/coordination work.
    const enabledQueueCount = enabledQueues.filter((queueName) =>
        ['notifications', 'documents', 'data-sync'].includes(queueName),
    ).length;
    const safeDefaultConcurrency = Math.max(
        1,
        Math.min(2, Math.floor((EFFECTIVE_PRISMA_CONNECTION_LIMIT - 1) / Math.max(1, enabledQueueCount))),
    );
    const baseConcurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY || safeDefaultConcurrency) || safeDefaultConcurrency);
    const notificationsConcurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY_NOTIFICATIONS || baseConcurrency) || baseConcurrency);
    const documentsConcurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY_DOCUMENTS || baseConcurrency) || baseConcurrency);
    const dataSyncConcurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY_DATA_SYNC || baseConcurrency) || baseConcurrency);

    const activeConcurrency =
        (queueEnabled('notifications') ? notificationsConcurrency : 0)
        + (queueEnabled('documents') ? documentsConcurrency : 0)
        + (queueEnabled('data-sync') ? dataSyncConcurrency : 0);
    if (activeConcurrency >= EFFECTIVE_PRISMA_CONNECTION_LIMIT) {
        throw new Error(
            `Worker concurrency ${activeConcurrency} must remain below effective Prisma connection limit ${EFFECTIVE_PRISMA_CONNECTION_LIMIT}.`,
        );
    }

    workersInitialized = true;

    logger.info({
        role,
        queues: [QUEUE_NAMES.NOTIFICATIONS, QUEUE_NAMES.DOCUMENTS, QUEUE_NAMES.DATA_SYNC],
        enabledQueues,
        concurrency: {
            notifications: notificationsConcurrency,
            documents: documentsConcurrency,
            dataSync: dataSyncConcurrency,
        },
        effectivePrismaConnectionLimit: EFFECTIVE_PRISMA_CONNECTION_LIMIT,
    }, 'queue.workers.starting');

    let notificationsWorker: Worker | null = null;
    let documentsWorker: Worker | null = null;
    let dataSyncWorker: Worker | null = null;

    if (queueEnabled('notifications')) {
      notificationsWorker = new Worker(QUEUE_NAMES.NOTIFICATIONS, async (job) => {
        const data = job.data && typeof job.data === 'object' ? (job.data as Record<string, unknown>) : {};
        logger.info({
            event: 'queue.job.notifications.start',
            name: job.name,
            jobId: job.id,
            eventId: data.eventId,
            correlationId: data.correlationId,
        }, 'queue.job.notifications.start');
        if (await wasEventProcessedByConsumer('notifications', job)) {
            logger.info({ name: job.name, jobId: job.id }, 'queue.job.notifications.duplicate_skipped');
            return;
        }

        const handler = getHandler(job.name);
        if (handler) {
            return await handler(job);
        }
        throw new Error(`Unsupported notifications queue job: ${job.name}`);
      }, { connection: connection as ConnectionOptions, concurrency: notificationsConcurrency });

      notificationsWorker.on('failed', (job, err) => {
          const attempts = Number(job?.attemptsMade || 0);
          const maxAttempts = Number(job?.opts?.attempts || 1);
          const exhausted = attempts >= maxAttempts;
          logger.error({
              event: exhausted ? 'queue.job.notifications.exhausted' : 'queue.job.notifications.failed',
              name: job?.name,
              jobId: job?.id,
              attemptsMade: attempts,
              maxAttempts,
              exhausted,
              err,
          }, exhausted ? 'queue.job.notifications.exhausted' : 'queue.job.notifications.failed');
          // Only escalate exhausted jobs to Sentry — transient failures
          // BullMQ will retry are noise; the final exhaustion is the
          // signal worth alerting on.
          if (exhausted) {
              captureBackgroundException(err, {
                  tag: 'queue.notifications.exhausted',
                  extra: { name: job?.name, jobId: job?.id, attemptsMade: attempts, maxAttempts },
              });
          }
      });
      notificationsWorker.on('completed', (job) => {
          void markEventProcessedByConsumer('notifications', job || {});
          logger.info({ name: job?.name, jobId: job?.id }, 'queue.job.notifications.completed');
      });
    }

    if (queueEnabled('documents')) {
      documentsWorker = new Worker(QUEUE_NAMES.DOCUMENTS, async (job) => {
        const data = job.data && typeof job.data === 'object' ? (job.data as Record<string, unknown>) : {};
        logger.info({
            event: 'queue.job.documents.start',
            name: job.name,
            jobId: job.id,
            eventId: data.eventId,
            correlationId: data.correlationId,
        }, 'queue.job.documents.start');
        if (await wasEventProcessedByConsumer('documents', job)) {
            logger.info({ name: job.name, jobId: job.id }, 'queue.job.documents.duplicate_skipped');
            return;
        }

        const handler = getHandler(job.name);
        if (handler) {
            return await handler(job);
        }
          throw new Error(`Unsupported documents queue job: ${job.name}`);
      }, { connection: connection as ConnectionOptions, concurrency: documentsConcurrency });

      documentsWorker.on('failed', (job, err) => {
          const attempts = Number(job?.attemptsMade || 0);
          const maxAttempts = Number(job?.opts?.attempts || 1);
          const exhausted = attempts >= maxAttempts;
          logger.error({
              event: exhausted ? 'queue.job.documents.exhausted' : 'queue.job.documents.failed',
              name: job?.name,
              jobId: job?.id,
              attemptsMade: attempts,
              maxAttempts,
              exhausted,
              err,
          }, exhausted ? 'queue.job.documents.exhausted' : 'queue.job.documents.failed');
          if (exhausted) {
              captureBackgroundException(err, {
                  tag: 'queue.documents.exhausted',
                  extra: { name: job?.name, jobId: job?.id, attemptsMade: attempts, maxAttempts },
              });
          }
      });
      documentsWorker.on('completed', (job) => {
          void markEventProcessedByConsumer('documents', job || {});
          logger.info({ name: job?.name, jobId: job?.id }, 'queue.job.documents.completed');
      });
    }

    if (queueEnabled('data-sync')) {
      dataSyncWorker = new Worker(QUEUE_NAMES.DATA_SYNC, async (job) => {
        const data = job.data && typeof job.data === 'object' ? (job.data as Record<string, unknown>) : {};
        logger.info({
            event: 'queue.job.data_sync.start',
            name: job.name,
            jobId: job.id,
            eventId: data.eventId,
            correlationId: data.correlationId,
        }, 'queue.job.data_sync.start');
        if (await wasEventProcessedByConsumer('data_sync', job)) {
            logger.info({ name: job.name, jobId: job.id }, 'queue.job.data_sync.duplicate_skipped');
            return;
        }

        let handler = getHandler(job.name);
        if (!handler) {
            await import('../../workers/registerBuiltInHandlers.js');
            handler = getHandler(job.name);
        }
        if (handler) {
            return await handler(job);
        }
        throw new Error(`Unsupported data-sync queue job: ${job.name}`);
      }, {
        connection: connection as ConnectionOptions,
        concurrency: dataSyncConcurrency,
        // Long-running data-sync jobs (BDX import validates the whole XLSX
        // synchronously, often minutes) must not be marked "stalled" by
        // BullMQ's default 30s lock. Extend to 60 minutes — enough for
        // the largest BDX runs we have, and bounded by the K8s Job
        // deadline above. Stalled-job detection still works once the
        // lock actually expires, so worker crashes are detected.
        lockDuration: 60 * 60 * 1000,
        maxStalledCount: 1,
      });

      dataSyncWorker.on('failed', (job, err) => {
          const attempts = Number(job?.attemptsMade || 0);
          const maxAttempts = Number(job?.opts?.attempts || 1);
          const exhausted = attempts >= maxAttempts;
          logger.error({
              event: exhausted ? 'queue.job.data_sync.exhausted' : 'queue.job.data_sync.failed',
              name: job?.name,
              jobId: job?.id,
              attemptsMade: attempts,
              maxAttempts,
              exhausted,
              err,
          }, exhausted ? 'queue.job.data_sync.exhausted' : 'queue.job.data_sync.failed');
          if (exhausted) {
              captureBackgroundException(err, {
                  tag: 'queue.data_sync.exhausted',
                  extra: { name: job?.name, jobId: job?.id, attemptsMade: attempts, maxAttempts },
              });
          }
      });
      dataSyncWorker.on('completed', (job) => {
          void markEventProcessedByConsumer('data_sync', job || {});
          logger.info({ name: job?.name, jobId: job?.id }, 'queue.job.data_sync.completed');
      });
    }

    const bootstrapPolicyIndex = String(process.env.POLICY_INDEX_BOOTSTRAP || 'true').toLowerCase() === 'true';
    if (bootstrapPolicyIndex) {
        const envelope = buildDomainEvent({
            eventType: 'POLICY.INDEX_BACKFILL',
            aggregateType: 'POLICY',
            aggregateId: 'system',
            aggregateVersion: Date.now(),
            actorType: 'SYSTEM',
            actorId: 'queue-bootstrap',
            data: {
                batchSize: Number(process.env.POLICY_INDEX_BACKFILL_BATCH_SIZE || 500),
                maxBatches: Number(process.env.POLICY_INDEX_BACKFILL_MAX_BATCHES || 200),
            },
        });
        enqueueOutboxEvent({
            aggregateId: envelope.aggregateId,
            eventType: envelope.eventType,
            payload: envelope as never,
        });
    }
    const bootstrapAccounts360 = String(process.env.ACCOUNTS360_BOOTSTRAP || 'true').toLowerCase() === 'true';
    if (bootstrapAccounts360) {
        const envelope = buildDomainEvent({
            eventType: 'ACCOUNTS360.PROJECTION_BACKFILL',
            aggregateType: 'ACCOUNT',
            aggregateId: 'system',
            aggregateVersion: Date.now(),
            actorType: 'SYSTEM',
            actorId: 'queue-bootstrap',
            data: {
                batchSize: Number(process.env.ACCOUNTS360_BACKFILL_BATCH_SIZE || 250),
                maxBatches: Number(process.env.ACCOUNTS360_BACKFILL_MAX_BATCHES || 400),
            },
        });
        enqueueOutboxEvent({
            aggregateId: envelope.aggregateId,
            eventType: envelope.eventType,
            payload: envelope as never,
        });
    }
    const bootstrapAccountIntelligence = String(process.env.ACCOUNT_INTELLIGENCE_BOOTSTRAP || 'true').toLowerCase() === 'true';
    if (bootstrapAccountIntelligence) {
        const envelope = buildDomainEvent({
            eventType: 'ACCOUNT_INTELLIGENCE.PROJECTION_BACKFILL',
            aggregateType: 'ACCOUNT',
            aggregateId: 'system',
            aggregateVersion: Date.now(),
            actorType: 'SYSTEM',
            actorId: 'queue-bootstrap',
            data: {
                batchSize: Number(process.env.ACCOUNT_INTELLIGENCE_BACKFILL_BATCH_SIZE || 250),
                maxBatches: Number(process.env.ACCOUNT_INTELLIGENCE_BACKFILL_MAX_BATCHES || 400),
            },
        });
        enqueueOutboxEvent({
            aggregateId: envelope.aggregateId,
            eventType: envelope.eventType,
            payload: envelope as never,
        });
    }
    const bootstrapIssuedPackReconcile = String(process.env.POLICY_ISSUED_PACK_RECONCILE_BOOTSTRAP || 'true').toLowerCase() === 'true';
    if (bootstrapIssuedPackReconcile) {
        enqueueIssuedPackReconcileForActiveProductionTenants({ actorId: 'queue-bootstrap', scheduleKey: `bootstrap:${new Date().toISOString().slice(0, 13)}` });
    }

    const reconcileMinutes = Number(process.env.POLICY_INDEX_RECONCILE_INTERVAL_MINUTES || 30);
    if (Number.isFinite(reconcileMinutes) && reconcileMinutes > 0) {
        const intervalMs = Math.max(60_000, reconcileMinutes * 60_000);
        setInterval(() => {
            const reconcileEnvelope = buildDomainEvent({
                eventType: 'POLICY.INDEX_RECONCILE',
                aggregateType: 'POLICY',
                aggregateId: 'system',
                aggregateVersion: Date.now(),
                actorType: 'SYSTEM',
                actorId: 'queue-reconcile',
                data: {
                    limit: Number(process.env.POLICY_INDEX_RECONCILE_LIMIT || 500),
                },
            });
            const stateReconcileEnvelope = buildDomainEvent({
                eventType: 'POLICY.STATE_RECONCILE',
                aggregateType: 'POLICY',
                aggregateId: 'system',
                aggregateVersion: Date.now(),
                actorType: 'SYSTEM',
                actorId: 'queue-reconcile',
                data: {
                    limit: Number(process.env.POLICY_STATE_RECONCILE_LIMIT || 500),
                },
            });
            const accountsReconcileEnvelope = buildDomainEvent({
                eventType: 'ACCOUNTS360.PROJECTION_RECONCILE',
                aggregateType: 'ACCOUNT',
                aggregateId: 'system',
                aggregateVersion: Date.now(),
                actorType: 'SYSTEM',
                actorId: 'queue-reconcile',
                data: {
                    limit: Number(process.env.ACCOUNTS360_RECONCILE_LIMIT || 300),
                },
            });
            const accountIntelligenceReconcileEnvelope = buildDomainEvent({
                eventType: 'ACCOUNT_INTELLIGENCE.PROJECTION_RECONCILE',
                aggregateType: 'ACCOUNT',
                aggregateId: 'system',
                aggregateVersion: Date.now(),
                actorType: 'SYSTEM',
                actorId: 'queue-reconcile',
                data: {
                    limit: Number(process.env.ACCOUNT_INTELLIGENCE_RECONCILE_LIMIT || 300),
                },
            });
            enqueueOutboxEvent({
                aggregateId: reconcileEnvelope.aggregateId,
                eventType: reconcileEnvelope.eventType,
                payload: reconcileEnvelope as never,
            });
            enqueueOutboxEvent({
                aggregateId: stateReconcileEnvelope.aggregateId,
                eventType: stateReconcileEnvelope.eventType,
                payload: stateReconcileEnvelope as never,
            });
            enqueueIssuedPackReconcileForActiveProductionTenants({ actorId: 'queue-reconcile', scheduleKey: `reconcile:${Math.floor(Date.now() / intervalMs)}` });
            enqueueOutboxEvent({
                aggregateId: accountsReconcileEnvelope.aggregateId,
                eventType: accountsReconcileEnvelope.eventType,
                payload: accountsReconcileEnvelope as never,
            });
            enqueueOutboxEvent({
                aggregateId: accountIntelligenceReconcileEnvelope.aggregateId,
                eventType: accountIntelligenceReconcileEnvelope.eventType,
                payload: accountIntelligenceReconcileEnvelope as never,
            });
        }, intervalMs);
    }

    const renewalScanMinutes = Number(process.env.RENEWAL_EMAIL_SCAN_INTERVAL_MINUTES || 60);
    if (Number.isFinite(renewalScanMinutes) && renewalScanMinutes > 0) {
        const intervalMs = Math.max(60_000, renewalScanMinutes * 60_000);
        setInterval(() => {
            const renewalEnvelope = buildDomainEvent({
                eventType: 'RENEWAL.EMAIL_SCAN',
                aggregateType: 'POLICY',
                aggregateId: 'system',
                aggregateVersion: Date.now(),
                actorType: 'SYSTEM',
                actorId: 'queue-renewal-scan',
                idempotencyKey: `renewal-scan:${new Date().toISOString().slice(0, 13)}`,
                data: {
                    scheduledAt: new Date().toISOString(),
                },
            });
            enqueueOutboxEvent({
                eventId: renewalEnvelope.eventId,
                idempotencyKey: renewalEnvelope.idempotencyKey || null,
                aggregateId: renewalEnvelope.aggregateId,
                eventType: renewalEnvelope.eventType,
                payload: renewalEnvelope as never,
            });
        }, intervalMs);
    }

    logger.info('queue.workers.started');
}
