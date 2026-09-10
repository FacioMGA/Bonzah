import { Job } from 'bullmq';
import { z } from 'zod';
import { tenantScopedPrisma } from '../../platform/db/connection.js';
import { ProductRegistry } from '../../modules/policy/domain/ProductRegistry.js';
import {
    missingIssuedDocTypes,
    maybeSendWelcomeEmailForIssuedPack,
    promoteIssuedLifecycle,
    recordIssuedPackFailurePaymentEvent,
} from '../../platform/events/queue.js';
import { setIssueReadiness } from '../../modules/policy/app/setIssueReadiness.js';
import { runWithPolicyOperatingTenant } from '../../platform/tenant/tenantJobContext.js';
import { logger } from '../../platform/utils/logger.js';
import { registerHandler, JobHandler } from '../index.js';

const IssuedPackDataSchema = z.object({
    policyId: z.string().optional(),
    riskTransactionId: z.string().nullish(),
    source: z.string().optional(),
    generatedByUserId: z.string().nullish(),
});

type IssuedPackJobData = z.infer<typeof IssuedPackDataSchema>;

const EnvelopeSchema = z.object({
    // Top-level envelope correlation id (canonical DomainEventEnvelope). It is
    // the request-scoped identifier that ties this issuance back to the
    // originating quote/bind/payment and the logs — distinct from the
    // aggregate's riskTransactionId. Downstream staff notifications surface it
    // so a sale can be reconciled against its origin.
    correlationId: z.string().nullish(),
    data: IssuedPackDataSchema,
});

interface IssuedPackEnvelope {
    data: IssuedPackJobData;
    correlationId: string | null;
}

/**
 * Canonical issuance spine (ADR-0013): every DOC.GENERATE_ISSUED_POLICY_PACK
 * job arrives wrapped in a DomainEventEnvelope from the outbox relay.
 * The handler reads strictly from `envelope.data.*` — there is no
 * legacy flat-payload path. Direct enqueues bypassing the outbox /
 * envelope contract are forbidden (see
 * backend/modules/policy/app/commands/issuedPackEnqueue.ts).
 */
function readEnvelope(rawJobData: unknown): IssuedPackEnvelope {
    const parsed = EnvelopeSchema.safeParse(rawJobData);
    if (!parsed.success) {
        // Preserve the original bisected error messages so existing tests /
        // operators have the same diagnostics.
        if (!rawJobData || typeof rawJobData !== 'object') {
            throw new Error('DOC.GENERATE_ISSUED_POLICY_PACK: job.data is missing or not an object');
        }
        throw new Error(
            'DOC.GENERATE_ISSUED_POLICY_PACK: job.data.data is missing — payload is not a canonical DomainEventEnvelope. Use enqueueIssuedPolicyPack() (ADR-0013).',
        );
    }
    return { data: parsed.data.data, correlationId: parsed.data.correlationId ?? null };
}

/**
 * Pure body of the handler: takes the raw job payload (the
 * `DomainEventEnvelope` written to the outbox by
 * `enqueueIssuedPolicyPack`) and runs the full issuance side
 * effects — adapter doc-pack generation, missing-types audit,
 * welcome email, lifecycle promotion.
 *
 * Exported so unit tests can drive it directly with a plain envelope
 * object, without constructing a BullMQ `Job` at the seam. The
 * registered `handleGenerateIssuedPolicyPack` is a thin shim that
 * forwards `job.data` here.
 */
export async function runIssuedPackJob(rawJobData: unknown): Promise<unknown> {
    const { data, correlationId } = readEnvelope(rawJobData);
    const policyId = (data.policyId ?? '').trim();
    if (!policyId) {
        throw new Error('DOC.GENERATE_ISSUED_POLICY_PACK: envelope.data.policyId is required');
    }
    const riskTransactionId = data.riskTransactionId ?? null;
    const source = data.source || 'SYSTEM';
    const generatedByUserId = data.generatedByUserId ?? null;

    return runWithPolicyOperatingTenant(policyId, async () => {
        const policy = await tenantScopedPrisma.policy.findUnique({
            where: { id: policyId },
            select: { productType: true },
        });
        const productType = String(policy?.productType || '').toUpperCase();
        const adapter = ProductRegistry.getInstance().getAdapter(productType);
        if (!adapter) throw new Error(`DOC.GENERATE_ISSUED_POLICY_PACK: no product adapter for '${productType}'`);

        // ADR-0017 — runtime failures inside `adapter.generateDocPack` (template
        // missing, PDF render error, storage upload error) used to surface only
        // as BullMQ retries with no operator-visible audit row. Without an audit
        // row, `evaluateIssueReadiness` could not distinguish "still generating"
        // from "permanently failed" and the customer wizard polled `pending`
        // forever (ABY-97/98). We now wrap the adapter call so EVERY runtime
        // failure writes a structured `ISSUED_PACK_GENERATION_FAILED` event
        // before re-throwing for BullMQ's backoff. The missing-types branch
        // below remains the dedicated `ISSUED_PACK_MISSING_DOC_TYPES` audit so
        // BO can tell "wrong pack" from "no pack at all".
        let r: Awaited<ReturnType<typeof adapter.generateDocPack>>;
        try {
            r = await adapter.generateDocPack({
                policyId,
                riskTransactionId,
                docPack: 'ISSUED_POLICY_PACK',
                source,
                generatedByUserId,
            });
        } catch (err) {
            const reason = (err as Error)?.message || 'generation_failed';
            logger.error(
                { policyId, riskTransactionId, productType, err },
                'issued_pack.handler.generation_failed',
            );
            await recordIssuedPackFailurePaymentEvent({
                policyId,
                eventType: 'ISSUED_PACK_GENERATION_FAILED',
                reason,
                riskTransactionId,
            }).catch((auditErr) => {
                logger.warn({ err: auditErr, policyId }, 'issued_pack.failure.audit_write_failed');
            });
            // Mirror the failure into the lightweight readiness projection
            // (ADR-0017) so cheap callers (motor controller fast-path,
            // BO dashboards) see `customerOutcome: 'failed'` without
            // waiting for the live evaluator's audit-event scan.
            await setIssueReadiness(policyId, { failureCode: 'GENERATION_FAILED' }).catch((projErr) => {
                logger.warn({ err: projErr, policyId }, 'issued_pack.failure.projection_write_failed');
            });
            throw err;
        }

        const missing = missingIssuedDocTypes(r, adapter.getRequiredIssuedDocTypes());
        if (missing.length > 0) {
            // Surface missing-doc-types failures to BO via a structured
            // paymentEvent BEFORE re-throwing. The throw triggers
            // BullMQ's exponential-backoff retry; the audit row gives
            // operators visibility on the policy/payment surface they
            // already use, without needing to tail logs.
            logger.error(
                { policyId, riskTransactionId, missing, productType },
                'issued_pack.handler.missing_doc_types',
            );
            await recordIssuedPackFailurePaymentEvent({
                policyId,
                eventType: 'ISSUED_PACK_MISSING_DOC_TYPES',
                reason: `missing_required_doc_types: ${missing.join(',')}`,
                riskTransactionId,
                missingDocTypes: missing,
            }).catch((auditErr) => {
                logger.warn({ err: auditErr, policyId }, 'issued_pack.failure.audit_write_failed');
            });
            // Mirror to the readiness projection so the wizard's cheap
            // poll path also sees `failed` (ADR-0017). Distinct
            // `failureCode` from the runtime-throw branch so BO can
            // disambiguate "wrong pack" from "no pack at all".
            await setIssueReadiness(policyId, { failureCode: 'MISSING_DOC_TYPES' }).catch((projErr) => {
                logger.warn({ err: projErr, policyId }, 'issued_pack.failure.projection_write_failed');
            });
            throw new Error(`DOC.GENERATE_ISSUED_POLICY_PACK missing required documents: ${missing.join(', ')}`);
        }

        try {
            await maybeSendWelcomeEmailForIssuedPack({
                policyId,
                riskTransactionId,
                requiredIssuedDocTypes: adapter.getRequiredIssuedDocTypes(),
                source,
                correlationId,
            });
        } catch (err) {
            const reason = (err as Error)?.message || 'welcome_email_failed';
            logger.warn({ policyId, riskTransactionId, reason }, 'email.welcome.retry_required');
            throw new Error(`DOC.GENERATE_ISSUED_POLICY_PACK: welcome email was not queued: ${reason}`);
        }

        await promoteIssuedLifecycle({ policyId, riskTransactionId });

        return r;
    });
}

export const handleGenerateIssuedPolicyPack: JobHandler = (job: Job) => runIssuedPackJob(job.data);

registerHandler('DOC.GENERATE_ISSUED_POLICY_PACK', handleGenerateIssuedPolicyPack);
