import { prisma } from '../db/connection.js';
import { routeEventToQueue } from './queue.js';
import { logger } from '../utils/logger.js';
import type { Prisma } from '@prisma/client';

async function scoped<T>(tenantId: string, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', ${tenantId}, true)`;
    return work(tx);
  }, { timeout: 20_000 });
}

/** Same outbox/queues, with an explicit transaction-local RLS scope for every tenant. */
export async function pollPlatformOutbox(): Promise<number> {
  let cursor: string | undefined;
  let processed = 0;
  for (;;) {
    const tenants = await prisma.tenant.findMany({ where: { status: 'ACTIVE', parentOrganization: { active: true } },
      select: { id: true }, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const tenant of tenants) {
      const events = await scoped(tenant.id, tx => tx.outbox.findMany({ where: { processed: false }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: 50 }));
      for (const event of events) {
        try {
          processed += await scoped(tenant.id, async tx => {
            const locked = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`platform-outbox:${event.id}`}, 0)) AS locked`;
            if (!locked[0]?.locked) return 0;
            const row = await tx.outbox.findUnique({ where: { id: event.id } });
            if (!row || row.processed) return 0;
            const durableEventId = row.eventId || row.id;
            const prior = await tx.eventProcessingLog.findUnique({ where: { eventId_consumerName: { eventId: durableEventId, consumerName: 'outbox_relay' } } });
            if (!prior) {
              if (!row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) throw new Error('Invalid durable outbox envelope');
              // The durable row is the authority. A payload can never redirect a job to another MGA.
              await routeEventToQueue(row.eventType, { ...row.payload, eventId: durableEventId, operatingTenantId: tenant.id });
              await tx.eventProcessingLog.create({ data: { eventId: durableEventId, consumerName: 'outbox_relay' } });
            }
            await tx.outbox.update({ where: { id: row.id }, data: { processed: true, processedAt: new Date() } });
            return 1;
          });
        } catch (error) {
          logger.error({ err: error, tenantId: tenant.id, eventId: event.id }, 'platform.outbox.relay_failed');
        }
      }
    }
    if (tenants.length < 100) return processed;
    cursor = tenants[tenants.length - 1]!.id;
  }
}

export function startPlatformOutboxRelay(): NodeJS.Timeout {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await pollPlatformOutbox(); }
    catch (error) { logger.error({ err: error }, 'platform.outbox.poll_failed'); }
    finally { running = false; }
  }, Math.max(500, Number(process.env.OUTBOX_RELAY_POLL_INTERVAL_MS || 2000)));
  timer.unref();
  return timer;
}
