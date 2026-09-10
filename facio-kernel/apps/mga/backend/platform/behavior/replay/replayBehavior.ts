import type { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../db/connection.js';
import { runWithOperatingTenant } from '../../tenant/tenantAls.js';
import type { TenantConfig } from '../../tenant/tenantConfig.js';
import { normalizeOutboxEvent } from '../normalize/normalizeOutboxEvent.js';
import { updatePolicyTrajectory } from '../trajectory/updatePolicyTrajectory.js';
import { loadPolicyBehaviorManifest } from '../manifest/loadManifest.js';

export type ReplayBehaviorOptions = {
  limit?: number;
  batchSize?: number;
  dryRun?: boolean;
  includeGapReport?: boolean;
  onBatch?: (stats: ReplayBehaviorTenantSummary) => void;
};

export type ReplayBehaviorTenantSummary = {
  tenantSlug: string;
  scanned: number;
  created: number;
  duplicates: number;
  skipped: number;
  trajectoriesUpdated: number;
  missingEventEmbeddings: number;
  missingTrajectoryEmbeddings: number;
};

export function tenantConfigFromBehaviorReplayRow(row: { id: string; slug: string; countryCode: string }): TenantConfig {
  const country = (row.countryCode || 'CY').toUpperCase();
  const cc: TenantConfig['countryCode'] = (['CY', 'PT', 'GR', 'ES', 'IT', 'US'] as const).includes(
    country as TenantConfig['countryCode'],
  )
    ? (country as TenantConfig['countryCode'])
    : 'CY';
  return {
    id: row.id,
    tenantSlug: row.slug,
    countryCode: cc,
    country: row.slug,
    currency: cc === 'US' ? 'USD' : 'EUR',
    ipt: {},
    adminFee: 0,
    publicBaseUrl: '',
    fromEmail: '',
    brandLogo: { white: '', blue: '' },
    legalPack: cc.toLowerCase() as TenantConfig['legalPack'],
  };
}

export async function listBehaviorReplayTenants(slugFilter?: string): Promise<TenantConfig[]> {
  type Row = { id: string; slug: string; countryCode: string };
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT "id" AS id, "slug" AS slug, "countryCode" AS "countryCode" FROM "tenants" WHERE "isActive" = true ORDER BY "slug" ASC`,
  );
  const filtered = slugFilter ? rows.filter((r) => r.slug === slugFilter) : rows;
  return filtered.map(tenantConfigFromBehaviorReplayRow);
}

export async function replayBehaviorForTenant(
  tenant: TenantConfig,
  options: ReplayBehaviorOptions = {},
): Promise<ReplayBehaviorTenantSummary> {
  const batchSize = Math.max(1, Number(options.batchSize || 200) || 200);
  const supportedEventTypes = new Set(loadPolicyBehaviorManifest().entries.map((e) => e.match.eventType));
  const stats: ReplayBehaviorTenantSummary = {
    tenantSlug: tenant.tenantSlug,
    scanned: 0,
    created: 0,
    duplicates: 0,
    skipped: 0,
    trajectoriesUpdated: 0,
    missingEventEmbeddings: 0,
    missingTrajectoryEmbeddings: 0,
  };
  const touchedPolicyIds = new Set<string>();

  await runWithOperatingTenant(tenant, async () => {
    let cursor: { createdAt: Date; id: string } | null = null;
    let processed = 0;
    while (true) {
      if (options.limit && processed >= options.limit) break;
      const remaining = options.limit ? Math.max(0, options.limit - processed) : batchSize;
      const take = Math.min(batchSize, Math.max(1, remaining));
      const where: Prisma.OutboxWhereInput = { eventType: { in: Array.from(supportedEventTypes) } };
      if (cursor) {
        where.OR = [
          { createdAt: { gt: cursor.createdAt } },
          { AND: [{ createdAt: cursor.createdAt }, { id: { gt: cursor.id } }] },
        ];
      }
      const rows = await tenantScopedPrisma.outbox.findMany({
        where,
        select: { id: true, payload: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take,
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        stats.scanned++;
        processed++;
        if (options.dryRun) {
          stats.skipped++;
          continue;
        }
        const result = await normalizeOutboxEvent({ payload: row.payload }).catch((err) => ({
          status: 'skipped' as const,
          reason: `EXCEPTION:${(err as Error).message}`,
        }));
        if (result.status === 'created') {
          stats.created++;
          touchedPolicyIds.add(result.policyId);
        } else if (result.status === 'duplicate') {
          stats.duplicates++;
          touchedPolicyIds.add(result.policyId);
        } else {
          stats.skipped++;
        }
      }
      cursor = { createdAt: rows[rows.length - 1].createdAt, id: rows[rows.length - 1].id };
      options.onBatch?.({ ...stats });
    }

    for (const policyId of touchedPolicyIds) {
      const r = await updatePolicyTrajectory({ policyId }).catch((err) => ({
        status: 'skipped' as const,
        reason: `EXCEPTION:${(err as Error).message}`,
      }));
      if (r.status === 'updated') stats.trajectoriesUpdated++;
    }

    if (!options.dryRun && options.includeGapReport) {
      const [eventGap] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count
           FROM "behavior_events"
          WHERE "operatingTenantId" = $1
            AND "embedding" IS NULL`,
        tenant.id,
      );
      const [trajectoryGap] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count
           FROM "policy_trajectories"
          WHERE "operatingTenantId" = $1
            AND "trajectoryEmbedding" IS NULL`,
        tenant.id,
      );
      stats.missingEventEmbeddings = Number(eventGap?.count || 0n);
      stats.missingTrajectoryEmbeddings = Number(trajectoryGap?.count || 0n);
    }
  });

  return stats;
}
