import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import { parseRecord } from '../../http/readRouter.helpers.js';
import type { EmailPolicyDocumentsRepoPort } from '../../app/read/emailPolicyDocumentsUseCase.js';

export function buildPolicyReadRepository(): EmailPolicyDocumentsRepoPort {
  return {
    async findPolicy(args: { policyId: string; tenantId: string }) {
      void args.tenantId;
      const policy = await tenantScopedPrisma.policy.findFirst({
        where: { id: args.policyId },
        include: { policyHolder: true },
      });
      if (!policy) return null;
      return {
        id: policy.id,
        policyNumber: policy.policyNumber,
        quoteData: parseRecord(policy.quoteData),
        policyHolderName: policy.policyHolder?.name || null,
        policyHolderContactRaw: String(policy.policyHolder?.contact || ''),
      };
    },
    async findDocuments(args: { policyId: string; tenantId: string; documentIds: string[] }) {
      void args.tenantId;
      return tenantScopedPrisma.document.findMany({
        where: {
          id: { in: args.documentIds },
          policyId: args.policyId,
        },
        select: {
          id: true,
          filename: true,
          storageUri: true,
          type: true,
          docPack: true,
          status: true,
        },
      });
    },
  };
}
