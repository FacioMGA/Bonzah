import { runTenantScopedTransaction } from '../../../platform/db/connection.js';
import type { Prisma } from '@prisma/client';

export type WorksheetTx = Prisma.TransactionClient;

export type WorksheetClaim = {
  id: string;
  policyId: string | null;
  claimNumber: string;
  data: unknown;
  documents: unknown;
  events: Array<{
    id: string;
    eventType: string;
    occurredAt: Date;
    payload: unknown;
    actorName: string | null;
  }>;
};

export async function runWorksheetTransaction<T>(fn: (tx: WorksheetTx) => Promise<T>): Promise<T> {
  return runTenantScopedTransaction((_tx) => fn(_tx as unknown as WorksheetTx));
}

export async function loadWorksheetClaim(tx: WorksheetTx, claimId: string): Promise<WorksheetClaim | null> {
  return tx.claim.findUnique({
    where: { id: claimId },
    select: {
      id: true,
      policyId: true,
      claimNumber: true,
      data: true,
      documents: true,
      events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
    },
  });
}

export async function syncClaimStatusField(
  tx: WorksheetTx,
  claimId: string,
  sync: {
    projectedStatus: string;
    updatedClaimData: Record<string, unknown>;
    amountPaid: number;
    amountReserved: number;
  }
): Promise<void> {
  await tx.claim.update({
    where: { id: claimId },
    data: {
      status: sync.projectedStatus,
      amountPaid: sync.amountPaid,
      amountReserved: sync.amountReserved,
      data: sync.updatedClaimData as Prisma.InputJsonValue,
    },
  });
}
