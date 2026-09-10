import { Job, UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import { rebuildPolicyListIndexRow } from '../../modules/policy/infra/projections/policyListIndex.js';
import {
    PolicyTenantContextMissingError,
    runWithPolicyOperatingTenant,
} from '../../platform/tenant/tenantJobContext.js';
import { logger } from '../../platform/utils/logger.js';
import { registerHandler, JobHandler } from '../index.js';

// `POLICY.INDEX_UPDATE` jobs are dispatched by the outbox relay
// (`backend/platform/events/relay.ts` → `routeEventToQueue`), which
// forwards the **full `DomainEventEnvelope`** stored in the outbox row
// as `job.data`. Per the canonical "single shape" invariant for
// outbox-relayed events (ADR-0013, see `enqueueIssuedPolicyPack` docstring
// and `DOC.GENERATE_ISSUED_POLICY_PACK.ts`), the handler reads strictly
// from `envelope.data.*`.
//
// Before ABY-277 / PR #374: the schema parsed `job.data` as
// `{ policyId }` directly, which never matched the relay-wrapped
// shape and surfaced as `ZodError: policyId expected string, received
// undefined` (ABBEYGATE-B). That fix unblocked the parse — and
// immediately exposed a deeper hop: `rebuildPolicyListIndexRow`
// hits `tenantScopedPrisma.policy.findUnique`, which the fail-closed
// tenant extension (ADR-0019) rejects with `TenantContextError`
// because the BullMQ worker has no `runWithOperatingTenant` ALS
// frame around its dispatch. We mirror the canonical worker-tenant
// pattern from `DOC.GENERATE_ISSUED_POLICY_PACK.ts` (`runIssuedPackJob`):
// call `runWithPolicyOperatingTenant(policyId, fn)` so the tenant
// row is loaded once from the durable Policy record and every
// downstream `tenantScopedPrisma` call inherits the ALS context.
// (Regression: ABBEYGATE-E / ABY-281.)
export const PolicyIndexUpdateDataSchema = z.object({
    policyId: z.string().min(1, 'POLICY.INDEX_UPDATE missing envelope.data.policyId'),
});

const PolicyIndexUpdateEnvelopeSchema = z.object({
    data: PolicyIndexUpdateDataSchema,
});

// Pure body exposed for ADR-0029 typed-handler contract tests. The
// JobHandler shim below forwards `job.data` here so tests can drive
// the canonical envelope-acceptance path without a synthetic Job at
// the seam.
export async function runPolicyIndexUpdate(rawJobData: unknown): Promise<void> {
    const { data } = PolicyIndexUpdateEnvelopeSchema.parse(rawJobData);
    try {
        await runWithPolicyOperatingTenant(data.policyId, () => rebuildPolicyListIndexRow(data.policyId));
    } catch (err) {
        if (err instanceof PolicyTenantContextMissingError) {
            // A policy with no `operatingTenantId` can never acquire one by
            // retrying, so the fail-closed tenant extension (ADR-0019) rejects
            // every attempt identically. Dead-letter on the first attempt
            // (BullMQ `UnrecoverableError`) instead of burning all `attempts`
            // retries and firing a `queue.data_sync.exhausted` Sentry alert on
            // a permanent data defect (ABBEYGATE-W). The job lands in the
            // failed set and this structured log is the durable signal for the
            // data-repair follow-up. The tenant contract is unchanged — we do
            // NOT invent a fallback tenant.
            logger.warn(
                { event: 'policy.index_update.dead_lettered', policyId: data.policyId },
                'POLICY.INDEX_UPDATE dead-lettered: policy has no operating tenant context',
            );
            throw new UnrecoverableError(err.message);
        }
        throw err;
    }
}

export const handlePolicyIndexUpdate: JobHandler = (job: Job) => runPolicyIndexUpdate(job.data);

registerHandler('POLICY.INDEX_UPDATE', handlePolicyIndexUpdate);
