// guard:cross-tenant-intentional
// The outbox relay is a system-level background process that polls and
// processes outbox events for ALL operating tenants.  It must read/update
// rows across every tenant — filtering by operatingTenantId would cause
// cross-tenant events to be silently skipped.  The bare `prisma` client is
// therefore intentional here; no new rows are inserted by the relay.

import { prisma } from '../db/connection.js';
import { routeEventToQueue } from './queue.js';

import { logger } from '../utils/logger.js';
import { startPlatformOutboxRelay } from './platformRelay.js';
const POLL_INTERVAL = Math.max(500, Number(process.env.OUTBOX_RELAY_POLL_INTERVAL_MS || 5000) || 5000);
const OUTBOX_BATCH_SIZE = Math.max(1, Number(process.env.OUTBOX_RELAY_BATCH_SIZE || 50) || 50);
const OUTBOX_PARALLELISM = Math.max(1, Number(process.env.OUTBOX_RELAY_PARALLELISM || 8) || 8);
let isPolling = false;
const RELAY_INSTANCE_ID = `relay-${process.pid}`;

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

function isTransientDbDisconnect(err: unknown) {
    const rec = err && typeof err === 'object' ? (err as Record<string, unknown>) : {};
    const msg = String(rec.message || err || '');
    const code = String(rec.code || '');
    // Prisma commonly throws P1017 for server closed connection.
    return code === 'P1017' || msg.toLowerCase().includes('server has closed the connection');
}

async function reconnectPrismaBestEffort() {
    try { await prisma.$disconnect(); } catch { /* ignore */ }
    try { await prisma.$connect(); } catch { /* ignore */ }
}

async function tryAcquireEventLock(eventId: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_lock(hashtext(${`outbox:${eventId}`})) as locked
    `;
    return Boolean(rows?.[0]?.locked);
}

async function releaseEventLock(eventId: string): Promise<void> {
    await prisma.$queryRaw`
      SELECT pg_advisory_unlock(hashtext(${`outbox:${eventId}`}))
    `;
}

async function wasRelayed(eventId: string): Promise<boolean> {
    try {
        const rows = await prisma.$queryRaw<Array<{ found: number }>>`
          SELECT 1 as found
          FROM "event_processing_log"
          WHERE "eventId" = ${eventId}
            AND "consumerName" = ${'outbox_relay'}
          LIMIT 1
        `;
        return Boolean(rows?.[0]?.found);
    } catch {
        return false;
    }
}

async function markRelayed(eventId: string): Promise<void> {
    try {
        await prisma.$executeRaw`
          INSERT INTO "event_processing_log" ("eventId", "consumerName", "jobId", "processedAt")
          VALUES (${eventId}, ${'outbox_relay'}, ${null}, NOW())
          ON CONFLICT ("eventId", "consumerName") DO NOTHING
        `;
    } catch {
        // no-op
    }
}

// ─── Injected deps type (enables unit testing without real DB/queue) ─────────

export type OutboxRelayDeps = {
    acquireLock: (eventId: string) => Promise<boolean>;
    releaseLock: (eventId: string) => Promise<void>;
    wasRelayed: (eventId: string) => Promise<boolean>;
    markRelayed: (eventId: string) => Promise<void>;
    findOutboxRow: (eventId: string) => Promise<{ processed: boolean; eventType: string; payload: unknown; createdAt: Date } | null>;
    markOutboxProcessed: (eventId: string) => Promise<void>;
    dispatch: (eventType: string, payload: unknown) => Promise<unknown>;
    onError: (eventId: string, err: unknown) => void;
};

/**
 * Process a single outbox event.
 * Exported for unit testing — pass injected deps to avoid real DB/queue.
 * The relay calls this with the default prod deps.
 *
 * Invariant: markRelayed is called BEFORE markOutboxProcessed.
 * If the process crashes after markRelayed, the next poll cycle detects wasRelayed=true
 * and skips dispatch (cleans up the outbox row without re-dispatching).
 */
export async function processOutboxEvent(
    event: { id: string; eventType: string; payload: unknown },
    deps: OutboxRelayDeps,
): Promise<void> {
    const claimed = await deps.acquireLock(event.id).catch(() => false);
    if (!claimed) return;

    try {
        const current = await deps.findOutboxRow(event.id);

        // Already processed by a previous cycle — clean up and skip.
        if (!current || current.processed) {
            await deps.releaseLock(event.id).catch(() => undefined);
            return;
        }

        // Already dispatched to queue (relay logged it) — mark outbox and skip.
        if (await deps.wasRelayed(event.id)) {
            await deps.markOutboxProcessed(event.id);
            await deps.releaseLock(event.id).catch(() => undefined);
            return;
        }

        // Dispatch to queue.
        const payload = current.payload && typeof current.payload === 'object'
            ? current.payload
            : event.payload;
        await deps.dispatch(current.eventType, payload);

        // ── Ordering invariant ────────────────────────────────────────────────
        // markRelayed MUST happen before markOutboxProcessed.
        // If the process crashes here, the next cycle finds wasRelayed=true and
        // skips dispatch — preventing duplicate delivery.
        await deps.markRelayed(event.id);
        await deps.markOutboxProcessed(event.id);

        const ageMs = Date.now() - new Date(current.createdAt).getTime();
        logger.info({ eventId: event.id, eventType: current.eventType, ageMs }, 'relay.event.processed');
        await deps.releaseLock(event.id).catch(() => undefined);
    } catch (jobError) {
        deps.onError(event.id, jobError);
        // Do not mark processed — event will retry on the next poll cycle.
        await deps.releaseLock(event.id).catch(() => undefined);
    }
}

// ─── Production deps wired to real Prisma + queue ────────────────────────────

function buildProdDeps(): OutboxRelayDeps {
    return {
        acquireLock: tryAcquireEventLock,
        releaseLock: releaseEventLock,
        wasRelayed,
        markRelayed,
        findOutboxRow: async (eventId) => {
            const row = await prisma.outbox.findUnique({
                where: { id: eventId },
                select: { processed: true, payload: true, eventType: true, createdAt: true },
            });
            return row as { processed: boolean; eventType: string; payload: unknown; createdAt: Date } | null;
        },
        markOutboxProcessed: async (eventId) => {
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    await prisma.outbox.update({
                        where: { id: eventId },
                        data: { processed: true, processedAt: new Date() },
                    });
                    return;
                } catch (e) {
                    if (!isTransientDbDisconnect(e) || attempt === 2) throw e;
                    logger.error({ err: e }, `❌ Relay DB update failed (will retry) for Event ${eventId}:`);
                    await reconnectPrismaBestEffort();
                    await sleep(250 * (attempt + 1));
                }
            }
        },
        dispatch: routeEventToQueue,
        onError: (eventId, err) => {
            logger.error({ err }, `❌ Relay Failed for Event ${eventId}:`);
        },
    };
}

export function startOutboxRelay() {
    if (process.env.KERNEL_PLATFORM_MODE === 'true') return startPlatformOutboxRelay();
    logger.info('🔄 Starting Outbox Relay...');

    setInterval(async () => {
        if (isPolling) return;
        isPolling = true;

        try {
            // 1. Fetch unprocessed events (Limit 50 to avoid creating massive backlog)
            let events: Array<{ id: string; eventType: string; payload: unknown }> = [];
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    events = (await prisma.outbox.findMany({
                        where: { processed: false },
                        take: OUTBOX_BATCH_SIZE,
                        orderBy: { createdAt: 'asc' },
                    })) as Array<{ id: string; eventType: string; payload: unknown }>;
                    break;
                } catch (e) {
                    if (!isTransientDbDisconnect(e) || attempt === 2) throw e;
                    logger.error({ err: e }, '❌ Relay DB connection dropped (will retry):');
                    await reconnectPrismaBestEffort();
                    await sleep(250 * (attempt + 1));
                }
            }

            if (events.length === 0) {
                isPolling = false;
                return;
            }

            logger.info({
                pendingCount: events.length,
                relayInstanceId: RELAY_INSTANCE_ID,
                batchSize: OUTBOX_BATCH_SIZE,
                parallelism: OUTBOX_PARALLELISM,
            }, 'relay.poll.found_events');

            const deps = buildProdDeps();
            for (let i = 0; i < events.length; i += OUTBOX_PARALLELISM) {
                const chunk = events.slice(i, i + OUTBOX_PARALLELISM);
                await Promise.all(chunk.map((event) => processOutboxEvent(event, deps)));
            }
            logger.info({ count: events.length, relayInstanceId: RELAY_INSTANCE_ID }, 'relay.poll.complete');
        } catch (err) {
            logger.error({ err: err }, '❌ Relay Error:');
            if (isTransientDbDisconnect(err)) {
                await reconnectPrismaBestEffort();
            }
        } finally {
            isPolling = false;
        }
    }, POLL_INTERVAL);
}
