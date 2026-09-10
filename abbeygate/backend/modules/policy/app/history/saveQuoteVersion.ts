import type { Prisma } from '@prisma/client';
import { jsonStringify } from '../shared.js';

type TxClient = {
  policyQuoteHistory: {
    findFirst(args: {
      where: { policyId: string };
      orderBy: { version: 'desc' };
      select: { version: true };
    }): Promise<{ version: number } | null>;
    create(args: {
      data: Prisma.PolicyQuoteHistoryUncheckedCreateInput;
    }): Promise<{ id: string }>;
  };
};

export async function saveQuoteVersion(
  tx: TxClient,
  args: {
    policyId: string;
    quoteData: unknown;
    quoteResponse: unknown;
    isLockedSnapshot: boolean;
    versionOverride?: number;
  },
): Promise<{ id: string; version: number }> {
  const maxAttempts = 5;
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    const version = args.versionOverride ?? await nextVersion(tx, args.policyId);
    try {
      const created = await tx.policyQuoteHistory.create({
        data: {
          policyId: args.policyId,
          version,
          quoteData: jsonStringify(args.quoteData ?? {}),
          quoteResponse: jsonStringify(args.quoteResponse ?? {}),
          isLockedSnapshot: args.isLockedSnapshot,
        } as unknown as Prisma.PolicyQuoteHistoryUncheckedCreateInput,
      });
      return { id: created.id, version };
    } catch (error) {
      const code = String((error as { code?: string })?.code || '');
      const canRetry = !args.versionOverride && code === 'P2002' && attempt < maxAttempts;
      if (!canRetry) throw error;
    }
  }

  throw new Error('Failed to allocate quote version after retries');
}

async function nextVersion(tx: TxClient, policyId: string): Promise<number> {
  const latest = await tx.policyQuoteHistory.findFirst({
    where: { policyId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}
