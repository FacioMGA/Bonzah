/**
 * Verify the behavior-similarity query plan.
 *
 * Usage:
 *   npx tsx backend/scripts/explainBehaviorSimilarity.mts
 *   npx tsx backend/scripts/explainBehaviorSimilarity.mts --tenant-id <id> --policy-id <id> --limit 10
 *
 * The script intentionally uses the same SQL shape as the BO endpoint so ops
 * can confirm whether Postgres is using the HNSW cosine index at real scale.
 */
import { prisma } from '../platform/db/connection.js';
import { explainSimilarPolicyTrajectories } from '../platform/behavior/similarity.js';

type Args = {
  tenantId?: string;
  policyId?: string;
  limit: number;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { limit: 10 };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tenant-id') {
      out.tenantId = String(argv[++i] || '').trim() || undefined;
    } else if (arg === '--policy-id') {
      out.policyId = String(argv[++i] || '').trim() || undefined;
    } else if (arg === '--limit') {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) out.limit = Math.min(100, Math.floor(n));
    }
  }
  return out;
}

async function resolveTarget(args: Args): Promise<{ tenantId: string; policyId: string }> {
  if (args.tenantId && args.policyId) {
    return { tenantId: args.tenantId, policyId: args.policyId };
  }

  const whereTenant = args.tenantId ? 'AND "operatingTenantId" = $1' : '';
  const params = args.tenantId ? [args.tenantId] : [];
  const rows = await prisma.$queryRawUnsafe<Array<{ policyId: string; tenantId: string }>>(
    `SELECT "policyId" AS "policyId",
            "operatingTenantId" AS "tenantId"
       FROM "policy_trajectories"
      WHERE "trajectoryEmbedding" IS NOT NULL
        ${whereTenant}
      ORDER BY "updatedAt" DESC
      LIMIT 1`,
    ...params,
  );
  const row = rows[0];
  if (!row) {
    throw new Error('No policy_trajectories row with a trajectoryEmbedding was found');
  }
  return { tenantId: args.tenantId || row.tenantId, policyId: args.policyId || row.policyId };
}

async function main() {
  const args = parseArgs(process.argv);
  const target = await resolveTarget(args);
  const plan = await explainSimilarPolicyTrajectories({
    policyId: target.policyId,
    operatingTenantId: target.tenantId,
    limit: args.limit,
  });
  const usesHnsw = /policy_trajectories_embedding_hnsw_cosine_idx|hnsw/i.test(plan);
  console.log(JSON.stringify({ ...target, limit: args.limit, usesHnsw }, null, 2));
  console.log(plan);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
