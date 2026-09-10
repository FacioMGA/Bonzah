import { Job } from 'bullmq';
import { z } from 'zod';
import { tenantScopedPrisma } from '../../platform/db/connection.js';
import { ProductRegistry } from '../../modules/policy/domain/ProductRegistry.js';
import { resolveImmutablePolicyDocumentConfiguration } from '../../modules/policy/app/productRegistryService.js';
import { runWithPolicyOperatingTenant } from '../../platform/tenant/tenantJobContext.js';
import { registerHandler, type JobHandler } from '../index.js';

const PayloadSchema = z.object({
  policyId: z.string().min(1, 'DOC.GENERATE_RENTAL_DOC_PACK missing policyId'),
  docPack: z.string().min(1, 'DOC.GENERATE_RENTAL_DOC_PACK missing docPack'),
  riskTransactionId: z.string().nullish(),
  source: z.string().optional().default('SYSTEM'),
  generatedByUserId: z.string().nullish(),
  templateVersion: z.string().nullish(),
});

export const handleGenerateRentalDocPack: JobHandler = async (job: Job) => {
  const data = PayloadSchema.parse(job.data);
  return runWithPolicyOperatingTenant(data.policyId, async () => {
    const policy = await tenantScopedPrisma.policy.findUnique({
      where: { id: data.policyId },
      select: { productType: true },
    });
    const productType = String(policy?.productType || '').toUpperCase();
    if (productType !== 'RENTAL')
      throw new Error(
        `DOC.GENERATE_RENTAL_DOC_PACK invoked on non-rental policy (productType='${productType}')`,
      );
    const adapter = ProductRegistry.getInstance().getAdapter('RENTAL');
    if (!adapter)
      throw new Error('DOC.GENERATE_RENTAL_DOC_PACK: no RENTAL product adapter registered');
    const config = await resolveImmutablePolicyDocumentConfiguration({
      policyId: data.policyId,
      riskTransactionId: data.riskTransactionId ?? null,
    });
    return adapter.generateDocPack({
      policyId: data.policyId,
      riskTransactionId: data.riskTransactionId ?? null,
      docPack: data.docPack,
      source: data.source,
      generatedByUserId: data.generatedByUserId ?? null,
      templateVersion: data.templateVersion ?? undefined,
      requiredIssuedDocTypes: config.requiredIssuedDocTypes,
      documentSources: config.documentSources,
    });
  });
};

registerHandler('DOC.GENERATE_RENTAL_DOC_PACK', handleGenerateRentalDocPack);
