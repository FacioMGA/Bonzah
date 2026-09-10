import { Job } from 'bullmq';
import { z } from 'zod';
import { tenantScopedPrisma } from '../../platform/db/connection.js';
import { ProductRegistry } from '../../modules/policy/domain/ProductRegistry.js';
import { resolveImmutablePolicyDocumentConfiguration } from '../../modules/policy/app/productRegistryService.js';
import { runWithPolicyOperatingTenant } from '../../platform/tenant/tenantJobContext.js';
import { registerHandler, JobHandler } from '../index.js';

/**
 * `DocumentService.generate(...)` queues the per-product job whose name comes
 * from `adapter.getDocPackJobName()`. For Home that is
 * `DOC.GENERATE_HOME_DOC_PACK`; without this handler BO-triggered Home
 * regenerations would fail with "no handler registered". The customer
 * issuance flow uses the canonical `DOC.GENERATE_ISSUED_POLICY_PACK` worker
 * (which already dispatches via adapter), but BO-driven flows go through the
 * product job name and need their own thin entrypoint.
 */
const PayloadSchema = z.object({
  policyId: z.string().min(1, 'DOC.GENERATE_HOME_DOC_PACK missing policyId'),
  docPack: z.string().min(1, 'DOC.GENERATE_HOME_DOC_PACK missing docPack'),
  riskTransactionId: z.string().nullish(),
  source: z.string().optional().default('SYSTEM'),
  generatedByUserId: z.string().nullish(),
  templateVersion: z.string().nullish(),
});

export const handleGenerateHomeDocPack: JobHandler = async (job: Job) => {
  const data = PayloadSchema.parse(job.data);

  return runWithPolicyOperatingTenant(data.policyId, async () => {
    const policy = await tenantScopedPrisma.policy.findUnique({
      where: { id: data.policyId },
      select: { productType: true },
    });
    const productType = String(policy?.productType || '').toUpperCase();
    if (productType !== 'HOME') {
      throw new Error(`DOC.GENERATE_HOME_DOC_PACK invoked on non-home policy (productType='${productType}')`);
    }
    const adapter = ProductRegistry.getInstance().getAdapter('HOME');
    if (!adapter) throw new Error("DOC.GENERATE_HOME_DOC_PACK: no HOME product adapter registered");
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

registerHandler('DOC.GENERATE_HOME_DOC_PACK', handleGenerateHomeDocPack);
