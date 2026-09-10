import { Job } from 'bullmq';
import { z } from 'zod';
import { tenantScopedPrisma } from '../../platform/db/connection.js';
import { ProductRegistry } from '../../modules/policy/domain/ProductRegistry.js';
import { runWithPolicyOperatingTenant } from '../../platform/tenant/tenantJobContext.js';
import { registerHandler, JobHandler } from '../index.js';

const PayloadSchema = z.object({
    policyId: z.string().min(1, 'DOC.GENERATE_QUOTE_PACK missing policyId'),
    docPack: z.string().min(1, 'DOC.GENERATE_QUOTE_PACK missing docPack'),
    source: z.string().optional().default('SYSTEM'),
    generatedByUserId: z.string().nullish(),
});

export const handleGenerateQuotePack: JobHandler = async (job: Job) => {
    const data = PayloadSchema.parse(job.data);

    return runWithPolicyOperatingTenant(data.policyId, async () => {
        const policy = await tenantScopedPrisma.policy.findUnique({
            where: { id: data.policyId },
            select: { productType: true },
        });
        const productType = String(policy?.productType || '').toUpperCase();
        const adapter = ProductRegistry.getInstance().getAdapter(productType);
        if (!adapter) throw new Error(`DOC.GENERATE_QUOTE_PACK: no product adapter for '${productType}'`);

        return await adapter.generateDocPack({
            policyId: data.policyId,
            docPack: data.docPack,
            source: data.source,
            generatedByUserId: data.generatedByUserId ?? null,
            riskTransactionId: null,
        });
    });
};

registerHandler('DOC.GENERATE_QUOTE_PACK', handleGenerateQuotePack);
