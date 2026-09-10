import { Job } from 'bullmq';
import { z } from 'zod';
import { backfillPolicyListIndex } from '../../modules/policy/infra/projections/policyListIndex.js';
import { runWithOperatingTenant } from '../../platform/tenant/tenantAls.js';
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

// ABY-281 — System batch jobs run outside any HTTP request, so the
// `tenantScopedPrisma` calls inside `backfillPolicyListIndex` would
// otherwise hit the fail-closed tenant extension (ADR-0019). Pin the
// deployment-default tenant via `buildTenantConfigFromEnv()` —
// identical pattern to `seed/reporting.ts:46` and the
// `enqueueSystemOutboxEvent` helper. Multi-tenant deployments would
// iterate `loadAllTenants()` instead; deferred until the platform has
// >1 production tenant (today: only `abbeygate-cy`).
export const handlePolicyIndexBackfill: JobHandler = async (job: Job) => {
    const data = EnvelopeSchema.parse(job.data)?.data ?? {};
    const batchSize = data.batchSize ?? envInt('POLICY_INDEX_BACKFILL_BATCH_SIZE') ?? 500;
    const maxBatches = data.maxBatches ?? envInt('POLICY_INDEX_BACKFILL_MAX_BATCHES') ?? 200;

    await runWithOperatingTenant(buildTenantConfigFromEnv(), () =>
        backfillPolicyListIndex(batchSize, maxBatches),
    );
};

registerHandler('POLICY.INDEX_BACKFILL', handlePolicyIndexBackfill);
