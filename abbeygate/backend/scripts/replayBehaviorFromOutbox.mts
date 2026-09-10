/**
 * Replay BehaviorEvents from the existing Outbox.
 *
 * Why exist?
 *   - The Behavior layer is purely additive — it does not change existing
 *     producers. Replaying the outbox is how we backfill semantic events
 *     for policies whose lifecycles already happened.
 *   - Idempotent: every BehaviorEvent has a unique constraint on
 *     `sourceEventId`, so re-running this script is safe.
 *
 * Strategy:
 *   1. Discover all known operating tenants once.
 *   2. For each tenant, walk its outbox in `createdAt asc` order.
 *   3. For every event whose `eventType` is mapped by the manifest, run
 *      `normalizeOutboxEvent` inside `runWithOperatingTenant(tenant)` so the
 *      Prisma extension auto-scopes both reads and writes.
 *   4. Track the set of policyIds touched per tenant; at the end run
 *      `updatePolicyTrajectory` for each.
 *
 * Usage:
 *   npx tsx backend/scripts/replayBehaviorFromOutbox.mts
 *   npx tsx backend/scripts/replayBehaviorFromOutbox.mts --tenant <slug>
 *   BEHAVIOR_REPLAY_LIMIT=200 npx tsx backend/scripts/replayBehaviorFromOutbox.mts
 */
import { prisma } from '../platform/db/connection.js';
import {
  listBehaviorReplayTenants,
  replayBehaviorForTenant,
  type ReplayBehaviorTenantSummary,
} from '../platform/behavior/replay/replayBehavior.js';

type CliArgs = {
  tenantSlug?: string;
  limit?: number;
  batchSize: number;
  dryRun: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { batchSize: 200, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tenant' || arg === '--tenant-slug') {
      out.tenantSlug = String(argv[++i] || '').trim() || undefined;
    } else if (arg === '--limit') {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) out.limit = n;
    } else if (arg === '--batch-size') {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) out.batchSize = n;
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    }
  }
  if (!out.limit && process.env.BEHAVIOR_REPLAY_LIMIT) {
    const n = Number(process.env.BEHAVIOR_REPLAY_LIMIT);
    if (Number.isFinite(n) && n > 0) out.limit = n;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const tenants = await listBehaviorReplayTenants(args.tenantSlug);
  if (tenants.length === 0) {
    console.error('No active tenants found' + (args.tenantSlug ? ` for slug=${args.tenantSlug}` : ''));
    process.exit(1);
  }
  console.log(JSON.stringify({ phase: 'replay.start', tenants: tenants.map((t) => t.tenantSlug), args }));

  const summaries: ReplayBehaviorTenantSummary[] = [];
  for (const tenant of tenants) {
    const summary = await replayBehaviorForTenant(tenant, {
      ...args,
      includeGapReport: true,
      onBatch: (stats) => {
        console.log(JSON.stringify({
          phase: 'replay.batch',
          tenantSlug: stats.tenantSlug,
          scanned: stats.scanned,
          created: stats.created,
          duplicates: stats.duplicates,
          skipped: stats.skipped,
        }));
      },
    });
    summaries.push(summary);
    console.log(JSON.stringify({ phase: 'replay.tenant.done', ...summary }));
  }
  console.log(JSON.stringify({ phase: 'replay.complete', summaries }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
