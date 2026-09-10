import { Job } from 'bullmq';
import { z } from 'zod';
import { backfillPolicyListIndex } from '../../modules/policy/infra/projections/policyListIndex.js';
import { runWithWorkerTenant } from '../../platform/events/platformJobContext.js';
import { buildTenantConfigFromEnv } from '../../platform/tenant/tenantConfigForCli.js';
import { registerHandler, JobHandler } from '../index.js';

// Dispatched by the outbox relay; `job.data` is the full
// `DomainEventEnvelope`. Read tunables from `envelope.data.*` per the
// canonical pattern (ADR-0013). Before fix, this handler parsed
// `job.data` as `{ batchSize, maxBatches }` directly, never matched
// the relay-wrapped shape, and silently fell through to env defaults
// — making the producer-supplied limits a no-op without surfacing
// the drift. The env-knob fallbacks remain (they are operational
// levers per the no-defensive-fallbacks skill — numeric tuning knobs
// with documented defaults, not silent fallbacks for required data).
const DataSchema = z.object({
    batchSize: z.coerce.number().int().positive().optional(),
    maxBatches: z.coerce.number().int().positive().optional(),
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
export const handlePolicyIndexBackfill: JobHandler = async (job: Job) => {
    const data = EnvelopeSchema.parse(job.data)?.data ?? {};
    const batchSize = data.batchSize ?? envInt('POLICY_INDEX_BACKFILL_BATCH_SIZE') ?? 500;
    const maxBatches = data.maxBatches ?? envInt('POLICY_INDEX_BACKFILL_MAX_BATCHES') ?? 200;

    await runWithWorkerTenant(() =>
        backfillPolicyListIndex(batchSize, maxBatches), buildTenantConfigFromEnv
        );
};

registerHandler('POLICY.INDEX_BACKFILL', handlePolicyIndexBackfill);
