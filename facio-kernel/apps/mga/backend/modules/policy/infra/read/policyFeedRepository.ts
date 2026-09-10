import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import type { GetPolicyFeedRepoPort } from '../../app/read/getPolicyFeedUseCase.js';

export function buildPolicyFeedRepository(): GetPolicyFeedRepoPort {
  return {
    async findPolicyLinkage(args: { policyId: string; tenantId: string }) {
      return tenantScopedPrisma.policy.findFirst({
        where: { id: args.policyId, accountId: args.tenantId },
        select: { policyHolderId: true, binderId: true },
      });
    },
    async listAuditFeedByEntityIds(entityIds: string[]) {
      const rows = await tenantScopedPrisma.auditAction.findMany({
        where: { entityId: { in: entityIds } },
        orderBy: { occurredAt: 'desc' },
        take: 100,
      });
      return rows as Array<Record<string, unknown>>;
    },
  };
}
