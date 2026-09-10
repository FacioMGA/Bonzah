import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import type { ListPolicyDocumentsRepoPort } from '../../app/read/listPolicyDocumentsUseCase.js';

export function buildPolicyDocumentsRepository(): ListPolicyDocumentsRepoPort {
  return {
    async listDocumentsByPolicy(args: { policyId: string; tenantId: string }) {
      // Policy access (customer ownership vs BO staff) is enforced by
      // requirePolicyAccess on GET /api/policies/:id/documents. Scope by
      // policyId only so staff INTERNAL accounts can list customer-owned docs.
      void args.tenantId;
      return tenantScopedPrisma.document.findMany({
        // Only successfully generated files are customer-visible. Historical
        // superseded versions and failed attempts remain in the audit trail;
        // returning them made recovery retries appear as duplicate packs.
        where: { policyId: args.policyId, status: 'GENERATED' },
        orderBy: { createdAt: 'desc' },
      });
    },
  };
}
