
import { PrismaClient } from '@prisma/client';
import { getCorrelationId } from '../observability/context.js';
import { getOperatingTenantConfig } from '../tenant/tenantAls.js';
import { logger } from '../utils/logger.js';
import {
  buildTenantExtension,
  runInsideTenantTransaction,
  TENANT_GUC_TX_OPTIONS,
  TenantContextError,
} from './tenantExtension.js';
// Postgres-only: require DATABASE_URL to avoid accidentally running against SQLite.
if (!process.env.DATABASE_URL) {
  throw new Error('FATAL: DATABASE_URL environment variable is not defined.');
}

const CONNECTION_LIMIT = Number(process.env.PRISMA_CONNECTION_LIMIT) || 10;
const POOL_TIMEOUT = Number(process.env.PRISMA_POOL_TIMEOUT) || 10;

const databaseUrl = new URL(process.env.DATABASE_URL!);
if (!databaseUrl.searchParams.has('connection_limit')) {
  databaseUrl.searchParams.set('connection_limit', String(CONNECTION_LIMIT));
}
if (!databaseUrl.searchParams.has('pool_timeout')) {
  databaseUrl.searchParams.set('pool_timeout', String(POOL_TIMEOUT));
}

const configuredConnectionLimit = Number(databaseUrl.searchParams.get('connection_limit'));
if (!Number.isInteger(configuredConnectionLimit) || configuredConnectionLimit < 2) {
  throw new Error('FATAL: effective Prisma connection_limit must be an integer of at least 2.');
}
export const EFFECTIVE_PRISMA_CONNECTION_LIMIT = configuredConnectionLimit;

export const prisma = new PrismaClient({
  datasources: {
    db: { url: databaseUrl.toString() },
  },
});

// Optional, low-noise Prisma query timing (enable via env var).
// Helpful for diagnosing Azure latency without changing behavior.
const ENABLE_QUERY_TIMING = String(process.env.PRISMA_QUERY_TIMING || '').toLowerCase() === '1'
  || String(process.env.PRISMA_QUERY_TIMING || '').toLowerCase() === 'true';
const SLOW_QUERY_MS = Number(process.env.PRISMA_SLOW_QUERY_MS || 200);

if (ENABLE_QUERY_TIMING) {
  prisma.$use(async (params, next) => {
    const start = Date.now();
    const result = await next(params);
    const ms = Date.now() - start;
    if (ms >= (Number.isFinite(SLOW_QUERY_MS) ? SLOW_QUERY_MS : 200)) {
      const cid = getCorrelationId();
      const model = params.model || 'raw';
      const action = params.action || 'query';
      logger.info({
        event: 'db.prisma.slow_query',
        durationMs: ms,
        model,
        action,
        cid,
      }, 'db.prisma.slow_query');
    }
    return result;
  });
}

/**
 * Tenant-scoped Prisma client (fail-closed).
 *
 * Use this for all queries on models that carry `operatingTenantId` (Sprint 2+).
 * It automatically injects `where: { operatingTenantId }` and `data.operatingTenantId`
 * from the current per-request ALS context, and throws `TenantContextError` if
 * no context is present.
 *
 * The base `prisma` export remains unchanged for models that are not yet
 * tenant-scoped and for admin/system operations via `withSystemContext`.
 */
export const tenantScopedPrisma = prisma.$extends(
  buildTenantExtension({ failClosed: true, baseClient: prisma }),
);

/**
 * The transaction-client type produced by `tenantScopedPrisma.$transaction(async (tx) => ...)`.
 * Use this instead of `Prisma.TransactionClient` in function signatures that receive
 * a `tx` from a tenant-scoped transaction.
 *
 * Uses conditional type inference to extract the callback-argument type from
 * the interactive-transaction overload of `$transaction` on the extended client.
 */
type _ExtractTx<T> = T extends {
  $transaction: (fn: (tx: infer TX) => Promise<unknown>) => Promise<unknown>;
} ? TX : never;
export type TenantScopedTx = _ExtractTx<typeof tenantScopedPrisma>;

/**
 * Run an atomic tenant-scoped unit of work on one Prisma connection.
 *
 * The transaction-local RLS GUC is set on the callback transaction itself.
 * Model operations retain the tenant extension's application-level filters,
 * while `runInsideTenantTransaction` prevents each operation from opening a
 * second top-level transaction solely to set the same GUC.
 */
export async function runTenantScopedTransaction<T>(
  fn: (tx: TenantScopedTx) => Promise<T>,
): Promise<T> {
  const tenant = getOperatingTenantConfig();
  if (!tenant) {
    throw new TenantContextError('$transaction', 'runTenantScopedTransaction');
  }

  return tenantScopedPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', ${tenant.id}, true)`;
    return runInsideTenantTransaction(() => fn(tx));
  }, TENANT_GUC_TX_OPTIONS);
}

export const connectToDatabase = async () => {
  try {
    await prisma.$connect();
    logger.info('Connected to Database (Prisma)');
  } catch (error) {
    logger.error({ err: error }, 'Database connection failed:');
    process.exit(1);
  }
};
