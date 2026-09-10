import { prisma } from './connection.js';
import { logger } from '../utils/logger.js';

type BootstrapMode = 'off' | 'best-effort' | 'strict';

function resolveMode(): BootstrapMode {
  const raw = String(process.env.DB_INDEX_BOOTSTRAP || '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'disabled') return 'off';
  if (raw === 'strict' || raw === 'required') return 'strict';
  if (raw === 'best-effort' || raw === 'besteffort') return 'best-effort';
  // default
  return 'best-effort';
}

async function exec(sql: string, mode: BootstrapMode) {
  try {
    await prisma.$executeRawUnsafe(sql);
    return true;
  } catch (err: unknown) {
    const errRecord = err && typeof err === 'object' ? (err as Record<string, unknown>) : {};
    const message = String(errRecord.message || err);
    if (mode === 'strict') {
      throw err;
    }
    logger.warn({ sql, message }, 'db.index_bootstrap.failed');
    return false;
  }
}

/**
 * Best-effort DB index bootstrap.
 *
 * Why: Prisma `db push` does not create specialized indexes (GIN/HNSW) automatically.
 * This keeps query and vector search performance predictable as data grows.
 *
 * Controlled by env:
 * - `DB_INDEX_BOOTSTRAP=off|best-effort|strict` (default: best-effort)
 */
export async function ensureDbIndexes() {
  const mode = resolveMode();
  if (mode === 'off') return;

  const startedAt = Date.now();
  logger.info({ mode }, 'db.index_bootstrap.start');

  // JSONB GIN indexes (fast @>, ?, ?|, ?& queries)
  await exec(`CREATE INDEX IF NOT EXISTS "policies_quoteData_gin_idx" ON "policies" USING GIN ("quoteData");`, mode);
  await exec(`CREATE INDEX IF NOT EXISTS "policies_vehicleInfo_gin_idx" ON "policies" USING GIN ("vehicleInfo");`, mode);
  await exec(`CREATE INDEX IF NOT EXISTS "policies_driverInfo_gin_idx" ON "policies" USING GIN ("driverInfo");`, mode);

  // Lightweight expression indexes for common reporting filters.
  await exec(`CREATE INDEX IF NOT EXISTS "policies_qd_make_idx" ON "policies" ((("quoteData"->>'make')));`, mode);
  await exec(`CREATE INDEX IF NOT EXISTS "policies_qd_model_idx" ON "policies" ((("quoteData"->>'model')));`, mode);
  await exec(`CREATE INDEX IF NOT EXISTS "policies_qd_vehicle_type_idx" ON "policies" ((("quoteData"->>'vehicleType')));`, mode);

  // Behavior intelligence — HNSW cosine on per-event embeddings and per-entity
  // (recent) trajectory embeddings. Both are L2-normalized at write time, so
  // cosine distance via the `<=>` operator is the correct similarity metric.
  await exec(
    `CREATE INDEX IF NOT EXISTS "behavior_events_embedding_hnsw_cosine_idx" ON "behavior_events" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16, ef_construction=64);`,
    mode
  );
  await exec(
    `CREATE INDEX IF NOT EXISTS "policy_trajectories_embedding_hnsw_cosine_idx" ON "policy_trajectories" USING hnsw ("trajectoryEmbedding" vector_cosine_ops) WITH (m=16, ef_construction=64);`,
    mode
  );

  // PolicyListIndex hot-list paths (PR3 of policies-list-perf).
  // CREATE INDEX CONCURRENTLY for online creation on a large table; column
  // order matches the default BO list sort + keyset tie-break (see
  // `docs/architecture/contracts/database-indexes.md`). Prisma's `db push`
  // mirrors the same shape via `@@index` in `schema.prisma` for fresh dev DBs.
  await exec(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "policy_list_index_tenant_default_sort_keyset_idx" ON "policy_list_index" ("operatingTenantId", "attentionScore" DESC, "lastActivityAt" DESC, "policyNumber" DESC, "policyId" DESC);`,
    mode
  );
  await exec(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "policy_list_index_tenant_lastactivity_keyset_idx" ON "policy_list_index" ("operatingTenantId", "lastActivityAt" DESC, "policyId" DESC);`,
    mode
  );

  logger.info({ mode, durationMs: Date.now() - startedAt }, 'db.index_bootstrap.done');
}

