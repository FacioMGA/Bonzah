import type { Prisma } from '@prisma/client';
import { runTenantScopedTransaction } from '../../../../platform/db/connection.js';

export async function cleanupImportedPolicy(args: { policyId: string; policyHolderId: string }): Promise<void> {
  await runTenantScopedTransaction(async (_tx) => {
    const tx = _tx as unknown as Prisma.TransactionClient;
    await tx.policy.delete({ where: { id: args.policyId } });
    const holderPolicies = await tx.policy.count({ where: { policyHolderId: args.policyHolderId } });
    if (holderPolicies === 0) {
      await tx.policyHolder.delete({ where: { id: args.policyHolderId } }).catch(() => undefined);
    }
  });
}
