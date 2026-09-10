import type { Job } from 'bullmq';
import { z } from 'zod';
import { tenantScopedPrisma } from '../../platform/db/connection.js';
import { ProductRegistry } from '../../modules/policy/domain/ProductRegistry.js';
import { resolveImmutablePolicyDocumentConfiguration } from '../../modules/policy/app/productRegistryService.js';
import { runWithPolicyOperatingTenant } from '../../platform/tenant/tenantJobContext.js';
import { registerHandler, JobHandler } from '../index.js';

/**
 * BO-triggered HEALTH doc-pack regeneration. Mirrors
 * `DOC.GENERATE_TRAVEL_DOC_PACK` — the customer issuance flow uses the
 * canonical `DOC.GENERATE_ISSUED_POLICY_PACK` worker (ADR-0013), which
 * already dispatches via the product adapter; this handler exists so
 * that BO-driven generations (`adapter.getDocPackJobName()` →
 * `DOC.GENERATE_HEALTH_DOC_PACK`) have a thin entrypoint.
 */
const PayloadSchema = z.object({
  policyId: z.string().min(1, 'DOC.GENERATE_HEALTH_DOC_PACK missing policyId'),
  docPack: z.string().min(1, 'DOC.GENERATE_HEALTH_DOC_PACK missing docPack'),
  riskTransactionId: z.string().nullish(),
  source: z.string().optional().default('SYSTEM'),
  generatedByUserId: z.string().nullish(),
  templateVersion: z.string().nullish(),
});

// Type `Job` with explicit `unknown` data so the resolved type doesn't
// fall back to `Job<any, any, string>` (bullmq's default). The
// `PayloadSchema.parse` below is the real type assertion at the
// untrusted-input boundary. The other product doc-pack handlers
// (motor/home/travel) inherit the `Job<any,…>` default — they're in
// the any-resolved baseline. New code (this handler) must not add to
// it; the explicit `unknown` keeps the ceiling stable.
export const handleGenerateHealthDocPack: JobHandler = async (job: Job<unknown, unknown, string>) => {
  const data = PayloadSchema.parse(job.data);

  return runWithPolicyOperatingTenant(data.policyId, async () => {
    const policy = await tenantScopedPrisma.policy.findUnique({
      where: { id: data.policyId },
      select: { productType: true },
    });
    const productType = String(policy?.productType || '').toUpperCase();
    if (productType !== 'HEALTH') {
      throw new Error(`DOC.GENERATE_HEALTH_DOC_PACK invoked on non-health policy (productType='${productType}')`);
    }
    const adapter = ProductRegistry.getInstance().getAdapter('HEALTH');
    if (!adapter) throw new Error("DOC.GENERATE_HEALTH_DOC_PACK: no HEALTH product adapter registered");
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

registerHandler('DOC.GENERATE_HEALTH_DOC_PACK', handleGenerateHealthDocPack);
