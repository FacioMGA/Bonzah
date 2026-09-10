import { prisma } from '../db/connection.js';

export type SimilarPolicyTrajectoryRow = {
  policyId: string;
  policyNumber: string | null;
  direction: string;
  eventCount: number;
  lastEventAt: Date | null;
  distance: number;
};

export const SIMILAR_POLICY_TRAJECTORIES_SQL = `
SELECT pt."policyId" AS "policyId",
       p."policyNumber" AS "policyNumber",
       pt."direction" AS "direction",
       pt."eventCount" AS "eventCount",
       pt."lastEventAt" AS "lastEventAt",
       (pt."trajectoryEmbedding" <=> (
           SELECT "trajectoryEmbedding"
             FROM "policy_trajectories"
            WHERE "policyId" = $1
              AND "operatingTenantId" = $2
              AND "trajectoryEmbedding" IS NOT NULL
       ))::float8 AS distance
  FROM "policy_trajectories" pt
  LEFT JOIN "policies" p ON p."id" = pt."policyId"
 WHERE pt."operatingTenantId" = $2
   AND pt."policyId" <> $1
   AND pt."trajectoryEmbedding" IS NOT NULL
 ORDER BY distance ASC
 LIMIT $3`;

export function serializeSimilarPolicyTrajectory(row: SimilarPolicyTrajectoryRow) {
  return {
    policyId: row.policyId,
    policyNumber: row.policyNumber,
    direction: row.direction,
    eventCount: row.eventCount,
    lastEventAt: row.lastEventAt ? new Date(row.lastEventAt).toISOString() : null,
    distance: row.distance,
    similarity: 1 - row.distance,
  };
}

export async function findSimilarPolicyTrajectories(args: {
  policyId: string;
  operatingTenantId: string;
  limit: number;
}): Promise<SimilarPolicyTrajectoryRow[]> {
  return prisma.$queryRawUnsafe<SimilarPolicyTrajectoryRow[]>(
    SIMILAR_POLICY_TRAJECTORIES_SQL,
    args.policyId,
    args.operatingTenantId,
    args.limit,
  );
}

export async function explainSimilarPolicyTrajectories(args: {
  policyId: string;
  operatingTenantId: string;
  limit: number;
}): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${SIMILAR_POLICY_TRAJECTORIES_SQL}`,
    args.policyId,
    args.operatingTenantId,
    args.limit,
  );
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}
