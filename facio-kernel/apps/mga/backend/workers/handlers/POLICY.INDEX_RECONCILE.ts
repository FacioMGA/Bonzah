import { Job } from 'bullmq';
import { z } from 'zod';
import { reconcilePolicyListIndexBatch } from '../../modules/policy/infra/projections/policyListIndex.js';
import { runWithWorkerTenant } from '../../platform/events/platformJobContext.js';
import { buildTenantConfigFromEnv } from '../../platform/tenant/tenantConfigForCli.js';
import { registerHandler, JobHandler } from '../index.js';

// Dispatched by the outbox relay; `job.data` is the full
// `DomainEventEnvelope`. Read tunables from `envelope.data.*` per the
// canonical pattern (ADR-0013). See `POLICY.INDEX_BACKFILL.ts` for
// the rationale; same shape applies here.
const DataSchema = z.object({
    limit: z.coerce.number().int().positive().optional(),
});

const EnvelopeSchema = z.object({
    data: DataSchema.optional(),
}).optional();

function envInt(name: string): number | undefined {
    const raw = process.env[name];
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

// The relay admits the operating tenant before this shared batch handler.
export const handlePolicyIndexReconcile: JobHandler = async (job: Job) => {
    const data = EnvelopeSchema.parse(job.data)?.data ?? {};
    const limit = data.limit ?? envInt('POLICY_INDEX_RECONCILE_LIMIT') ?? 500;

    await runWithWorkerTenant(() =>
        reconcilePolicyListIndexBatch(limit), buildTenantConfigFromEnv
        );
};

registerHandler('POLICY.INDEX_RECONCILE', handlePolicyIndexReconcile);
