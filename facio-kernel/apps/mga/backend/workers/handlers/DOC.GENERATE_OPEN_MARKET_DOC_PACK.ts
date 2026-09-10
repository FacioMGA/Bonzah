import type { Job } from 'bullmq';
import { z } from 'zod';
import { tenantScopedPrisma } from '../../platform/db/connection.js';
import { ProductRegistry } from '../../modules/policy/domain/ProductRegistry.js';
import { resolveImmutablePolicyDocumentConfiguration } from '../../modules/policy/app/productRegistryService.js';
import { runWithPolicyOperatingTenant } from '../../platform/tenant/tenantJobContext.js';
import { registerHandler, JobHandler } from '../index.js';

const PayloadSchema = z.object({
  policyId: z.string().min(1, 'DOC.GENERATE_OPEN_MARKET_DOC_PACK missing policyId'),
  docPack: z.string().min(1, 'DOC.GENERATE_OPEN_MARKET_DOC_PACK missing docPack'),
  riskTransactionId: z.string().nullish(),
  source: z.string().optional().default('SYSTEM'),
  generatedByUserId: z.string().nullish(),
  templateVersion: z.string().nullish(),
});

export const handleGenerateOpenMarketDocPack: JobHandler = async (job: Job<unknown, unknown, string>) => {
  const data = PayloadSchema.parse(job.data);

  return runWithPolicyOperatingTenant(data.policyId, async () => {
    const policy = await tenantScopedPrisma.policy.findUnique({
      where: { id: data.policyId },
      select: { productType: true },
    });
    const productType = String(policy?.productType || '').toUpperCase();
    if (productType !== 'OPEN_MARKET') {
      throw new Error(`DOC.GENERATE_OPEN_MARKET_DOC_PACK invoked on non-open-market policy (productType='${productType}')`);
    }
    const adapter = ProductRegistry.getInstance().getAdapter('OPEN_MARKET');
    if (!adapter) throw new Error('DOC.GENERATE_OPEN_MARKET_DOC_PACK: no OPEN_MARKET product adapter registered');
    const documentConfiguration = await resolveImmutablePolicyDocumentConfiguration({
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
      requiredIssuedDocTypes: documentConfiguration.requiredIssuedDocTypes,
      documentSources: documentConfiguration.documentSources,
    });
  });
};

registerHandler('DOC.GENERATE_OPEN_MARKET_DOC_PACK', handleGenerateOpenMarketDocPack);
