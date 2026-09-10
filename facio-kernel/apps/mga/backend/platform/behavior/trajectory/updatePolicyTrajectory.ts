/**
 * BEHAVIOR.TRAJECTORY_UPDATE — pure async function (also runs as a queue handler).
 *
 * Recomputes one policy's trajectory projection. Called after each new
 * BehaviorEvent for that policy.
 *
 * Definition (locked, do not silently change):
 *   trajectoryEmbedding =
 *     L2Normalize(mean(last TRAJECTORY_WINDOW_SIZE BehaviorEvent.embedding
 *                      ordered by occurredAt desc))
 *
 *   direction = computeDirection(
 *     last DIRECTION_WINDOW_SIZE behaviorTypes, ordered by occurredAt desc
 *   )
 *
 * The window sizes are read from the existing PolicyTrajectory row when
 * present (so per-row A/B testing is possible), otherwise from the locked
 * defaults.
 */
import type { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../db/connection.js';
import { WithoutTenantScope } from '../../db/tenantExtension.js';
import { logger } from '../../utils/logger.js';
import { meanPoolNormalized } from './meanPool.js';
import { DIRECTION_WINDOW_SIZE, computeDirection } from './computeDirection.js';
import { pgVectorLiteral } from '../vector.js';

const DEFAULT_TRAJECTORY_WINDOW_SIZE = 50;

export type UpdatePolicyTrajectoryInput = { policyId: string };
export type UpdatePolicyTrajectoryResult =
  | { status: 'updated'; policyId: string; eventCount: number; direction: string; driftScore: number }
  | { status: 'skipped'; reason: string };

function parseEmbeddingText(value: string | null | undefined): number[] | null {
  if (!value) return null;
  try {
    const arr = JSON.parse(value) as unknown;
    if (!Array.isArray(arr)) return null;
    const out: number[] = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      const n = Number(arr[i]);
      if (!Number.isFinite(n)) return null;
      out[i] = n;
    }
    return out;
  } catch {
    return null;
  }
}

export async function updatePolicyTrajectory(
  input: UpdatePolicyTrajectoryInput,
): Promise<UpdatePolicyTrajectoryResult> {
  const policyId = String(input.policyId || '').trim();
  if (!policyId) return { status: 'skipped', reason: 'MISSING_POLICY_ID' };

  const policy = await tenantScopedPrisma.policy.findUnique({
    where: { id: policyId },
    select: { id: true, operatingTenantId: true },
  });
  if (!policy) return { status: 'skipped', reason: 'POLICY_NOT_FOUND' };

  // Read window-size metadata from the existing row so per-row tuning works,
  // but stay tolerant when no row exists yet (first-ever event).
  const existing = await tenantScopedPrisma.policyTrajectory.findUnique({
    where: { policyId },
    select: { trajectoryWindowSize: true, directionWindowSize: true },
  });
  const trajWindow = existing?.trajectoryWindowSize || DEFAULT_TRAJECTORY_WINDOW_SIZE;
  const dirWindow = existing?.directionWindowSize || DIRECTION_WINDOW_SIZE;
  const fetchSize = Math.max(trajWindow, dirWindow);

  // Pull most-recent-first, capped at the larger of the two windows. We need
  // the typed columns (occurredAt, behaviorType) AND the raw vector text — so
  // we use a single raw query that returns embedding as text.
  type Row = {
    id: string;
    behaviorType: string;
    occurredAt: Date;
    embeddingText: string | null;
  };
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT "id" AS id,
            "behaviorType" AS "behaviorType",
            "occurredAt" AS "occurredAt",
            "embedding"::text AS "embeddingText"
       FROM "behavior_events"
      WHERE "entityType" = 'POLICY'
        AND "entityId" = $1
        AND "operatingTenantId" = $2
      ORDER BY "occurredAt" DESC, "createdAt" DESC
      LIMIT $3`,
    policyId,
    policy.operatingTenantId,
    fetchSize,
  );

  if (rows.length === 0) {
    return { status: 'skipped', reason: 'NO_BEHAVIOR_EVENTS' };
  }

  // Total count for the projection's eventCount field. Tracked separately
  // because we only fetch a window above.
  const eventCount = await tenantScopedPrisma.behaviorEvent.count({
    where: { entityType: 'POLICY', entityId: policyId },
  });

  // Direction: deterministic, runs over the configured small window.
  const recentBehaviorTypes = rows.slice(0, dirWindow).map((r) => r.behaviorType);
  const direction = computeDirection(recentBehaviorTypes);

  // Trajectory embedding: L2-normalized mean of the last `trajWindow` event
  // embeddings. If too few events have an embedding (e.g. mid-replay), we
  // skip the vector update but still write the deterministic projection.
  const eventEmbeddings: number[][] = [];
  for (const r of rows.slice(0, trajWindow)) {
    const v = parseEmbeddingText(r.embeddingText);
    if (v && v.length === 1536) eventEmbeddings.push(v);
  }
  let trajectoryEmbedding: number[] | null = null;
  if (eventEmbeddings.length > 0) {
    try {
      trajectoryEmbedding = meanPoolNormalized(eventEmbeddings);
    } catch (err) {
      logger.warn({ err, policyId }, 'behavior.trajectory.meanpool_failed');
    }
  }
  if (eventEmbeddings.length < Math.min(rows.length, trajWindow)) {
    logger.warn({
      event: 'behavior.trajectory.embedding_gap',
      policyId,
      operatingTenantId: policy.operatingTenantId,
      rows: Math.min(rows.length, trajWindow),
      eventEmbeddings: eventEmbeddings.length,
    }, 'behavior.trajectory.embedding_gap');
  }

  const driftScoreNumeric = Number.isFinite(direction.driftScore)
    ? Math.max(0, Math.min(1, direction.driftScore))
    : 0;

  // Persist the typed projection. lastBehaviorTypes is stored chronological
  // (oldest → newest) per the schema doc; rows are most-recent-first, so we
  // reverse the slice.
  const chronological = recentBehaviorTypes.slice().reverse();

  // operatingTenantId is auto-injected by the tenant-scoped extension at
  // runtime, so we type the create payload with `WithoutTenantScope<...>` and
  // cast only at the boundary into Prisma's API.
  const create: WithoutTenantScope<Prisma.PolicyTrajectoryUncheckedCreateInput> = {
    policyId,
    eventCount,
    lastEventAt: rows[0].occurredAt,
    lastBehaviorTypes: chronological as unknown as Prisma.InputJsonValue,
    direction: direction.direction,
    driftScore: driftScoreNumeric.toString(),
  };
  const update: Prisma.PolicyTrajectoryUpdateInput = {
    eventCount,
    lastEventAt: rows[0].occurredAt,
    lastBehaviorTypes: chronological as unknown as Prisma.InputJsonValue,
    direction: direction.direction,
    driftScore: driftScoreNumeric.toString(),
  };
  await tenantScopedPrisma.policyTrajectory.upsert({
    where: { policyId },
    create: create as Prisma.PolicyTrajectoryUncheckedCreateInput,
    update,
  });

  if (trajectoryEmbedding) {
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE "policy_trajectories"
          SET "trajectoryEmbedding" = $1::vector
        WHERE "policyId" = $2
          AND "operatingTenantId" = $3`,
      pgVectorLiteral(trajectoryEmbedding),
      policyId,
      policy.operatingTenantId,
    );
    if (updated !== 1) {
      throw new Error(`behavior.trajectory.vector_update_miss: policyId=${policyId}`);
    }
  }
  logger.info({
    event: 'behavior.trajectory.updated',
    policyId,
    operatingTenantId: policy.operatingTenantId,
    eventCount,
    direction: direction.direction,
    driftScore: driftScoreNumeric,
    trajectoryEmbeddingStored: Boolean(trajectoryEmbedding),
  }, 'behavior.trajectory.updated');

  return {
    status: 'updated',
    policyId,
    eventCount,
    direction: direction.direction,
    driftScore: driftScoreNumeric,
  };
}
