import type { Prisma } from '@prisma/client';
import { runTenantScopedTransaction } from './connection.js';
import { logger } from '../utils/logger.js';

type TxClient = Prisma.TransactionClient;

async function setTransactionTenant(tx: TxClient, accountId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.current_account_id', ${accountId}, true)`;
}

export async function withTenantContext<T>(
  accountId: string,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  if (!accountId || !String(accountId).trim()) {
    throw new Error('withTenantContext requires a non-empty accountId');
  }

  return runTenantScopedTransaction(async (_tx) => {
    const tx = _tx as unknown as Prisma.TransactionClient;
    await setTransactionTenant(tx, accountId);
    return fn(tx);
  });
}

export async function withSystemContext<T>(
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  logger.warn({ stack: new Error().stack }, 'RLS: Executing with SYSTEM context');
  return withTenantContext('SYSTEM', fn);
}

export async function withCrossTenantAccess<T>(
  accountIds: string[],
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  logger.warn({ accountIds, stack: new Error().stack }, 'RLS: Cross-tenant access granted');
  return withSystemContext(fn);
}
