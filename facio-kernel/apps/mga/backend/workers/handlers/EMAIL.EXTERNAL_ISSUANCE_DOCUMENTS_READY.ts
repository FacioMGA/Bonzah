import { Job } from 'bullmq';
import { z } from 'zod';
import { getTenantConfig } from '../../platform/tenant/tenantConfig.js';
import { runWithPolicyOperatingTenant } from '../../platform/tenant/tenantJobContext.js';
import { logger } from '../../platform/utils/logger.js';
import { emailPolicyDocumentsUseCase } from '../../modules/policy/app/read/emailPolicyDocumentsUseCase.js';
import { buildEmailPolicyDocumentsDeps } from '../../modules/policy/app/read/emailPolicyDocumentsDeps.js';
import { registerHandler, type JobHandler } from '../index.js';

const PayloadSchema = z.object({
  policyId: z.string().min(1),
  documentIds: z.array(z.string().min(1)).min(1),
});
const EnvelopeSchema = z.object({ data: PayloadSchema });

/**
 * ADR-0096 customer-access notification. This intentionally reuses the
 * canonical selected-document email use case; it never regenerates or
 * substitutes the external insurer's documents.
 */
export const handleExternalIssuanceDocumentsReady: JobHandler = async (job: Job<unknown, unknown, string>) => {
  const payload = EnvelopeSchema.parse(job.data).data;
  await runWithPolicyOperatingTenant(payload.policyId, async () => {
    const result = await emailPolicyDocumentsUseCase(
      {
        policyId: payload.policyId,
        tenantId: getTenantConfig().id,
        documentIds: payload.documentIds,
        requireAllDocuments: true,
      },
      buildEmailPolicyDocumentsDeps(),
    );
    if (result.status !== 200) {
      throw new Error(`EMAIL.EXTERNAL_ISSUANCE_DOCUMENTS_READY: ${String(result.body.error || 'email delivery failed')}`);
    }
    logger.info({ policyId: payload.policyId, documentIds: payload.documentIds }, 'email.external_issuance_documents.dispatched');
  });
};

registerHandler('EMAIL.EXTERNAL_ISSUANCE_DOCUMENTS_READY', handleExternalIssuanceDocumentsReady);
