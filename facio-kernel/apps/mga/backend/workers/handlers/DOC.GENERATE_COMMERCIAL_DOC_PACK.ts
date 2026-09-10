import type { Job } from 'bullmq';
import { z } from 'zod';
import { tenantScopedPrisma } from '../../platform/db/connection.js';
import { ProductRegistry } from '../../modules/policy/domain/ProductRegistry.js';
import { resolveImmutablePolicyDocumentConfiguration } from '../../modules/policy/app/productRegistryService.js';
import { runWithPolicyOperatingTenant } from '../../platform/tenant/tenantJobContext.js';
import { registerHandler, type JobHandler } from '../index.js';
const payload = z.object({ policyId: z.string().min(1), docPack: z.string().min(1), riskTransactionId: z.string().nullish(), source: z.string().optional().default('SYSTEM'), generatedByUserId: z.string().nullish(), templateVersion: z.string().nullish() });
/** Thin BO regeneration entrypoint; issued-pack uses the same product adapter. */
export const handleGenerateCommercialDocPack: JobHandler = async (job: Job) => {
  const data = payload.parse(job.data);
  return runWithPolicyOperatingTenant(data.policyId, async () => {
    const policy = await tenantScopedPrisma.policy.findUnique({ where: { id: data.policyId }, select: { productType: true } });
    if (policy?.productType !== 'COMMERCIAL') throw new Error('Commercial document generation requires the selected commercial policy.');
    const adapter = ProductRegistry.getInstance().getAdapter('COMMERCIAL');
    if (!adapter) throw new Error('Commercial adapter is not registered.');
    const config = await resolveImmutablePolicyDocumentConfiguration({ policyId: data.policyId, riskTransactionId: data.riskTransactionId ?? null });
    return adapter.generateDocPack({ ...data, riskTransactionId: data.riskTransactionId ?? null, generatedByUserId: data.generatedByUserId ?? null, templateVersion: data.templateVersion ?? undefined, requiredIssuedDocTypes: config.requiredIssuedDocTypes, documentSources: config.documentSources });
  });
};
registerHandler('DOC.GENERATE_COMMERCIAL_DOC_PACK', handleGenerateCommercialDocPack);
