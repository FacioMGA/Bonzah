import { Job } from 'bullmq';
import { z } from 'zod';
import { executeMotorDocPackGeneration } from '../../modules/documents/infra/motorDocsService.js';
import { resolveImmutablePolicyDocumentConfiguration } from '../../modules/policy/app/productRegistryService.js';
import { runWithPolicyOperatingTenant } from '../../platform/tenant/tenantJobContext.js';
import { registerHandler, JobHandler } from '../index.js';

// Motor's adapter pins `docPack` to a literal union (see
// backend/products/motor/documents/generateMotorDocPack.ts) and `source`
// to one of three system origins. Encoding those in the schema is what
// surfaces producer/consumer drift at the parse boundary instead of as
// a runtime "string is not assignable to MotorDocPack" deeper down.
export const MotorDocPackPayloadSchema = z.object({
    policyId: z.string().min(1, 'DOC.GENERATE_MOTOR_DOC_PACK missing policyId'),
    docPack: z.enum(['QUOTE_PACK', 'DRAFT_POLICY_PACK', 'ISSUED_POLICY_PACK', 'ENDORSEMENT_PACK']),
    riskTransactionId: z.string().nullish(),
    source: z.enum(['CUSTOMER', 'BO', 'SYSTEM']).optional().default('SYSTEM'),
    generatedByUserId: z.string().nullish(),
    templateVersion: z.string().nullish(),
});

// Pure body exposed for ADR-0029 typed-handler contract tests.
export async function runMotorDocPackJob(rawJobData: unknown): Promise<unknown> {
    const data = MotorDocPackPayloadSchema.parse(rawJobData);

    return runWithPolicyOperatingTenant(data.policyId, async () => {
        const documentConfiguration = await resolveImmutablePolicyDocumentConfiguration({
            policyId: data.policyId,
            riskTransactionId: data.riskTransactionId ?? null,
        });
        return await executeMotorDocPackGeneration({
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
}

export const handleGenerateMotorDocPack: JobHandler = (job: Job) => runMotorDocPackJob(job.data);

registerHandler('DOC.GENERATE_MOTOR_DOC_PACK', handleGenerateMotorDocPack);
