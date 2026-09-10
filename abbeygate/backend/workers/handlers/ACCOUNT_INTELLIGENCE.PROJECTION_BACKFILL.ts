import { Job } from 'bullmq';
import { z } from 'zod';
import { backfillAccountIntelligenceProjection } from '../../modules/accounts360/infra/projections/accountIntelligenceProjection.js';
import { runWithOperatingTenant } from '../../platform/tenant/tenantAls.js';
import { buildTenantConfigFromEnv } from '../../platform/tenant/tenantConfigForCli.js';
import { registerHandler, JobHandler } from '../index.js';

// Dispatched by the outbox relay; `job.data` is the full
// `DomainEventEnvelope`. Read tunables from `envelope.data.*` per the
// canonical pattern (ADR-0013). See `POLICY.INDEX_BACKFILL.ts` for
// the rationale.
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

// ABY-281 — system batch job, see `POLICY.INDEX_BACKFILL.ts` rationale.
export const handleAccountIntelligenceProjectionBackfill: JobHandler = async (job: Job) => {
  const data = EnvelopeSchema.parse(job.data)?.data ?? {};
  const batchSize = data.batchSize ?? envInt('ACCOUNT_INTELLIGENCE_BACKFILL_BATCH_SIZE') ?? 250;
  const maxBatches = data.maxBatches ?? envInt('ACCOUNT_INTELLIGENCE_BACKFILL_MAX_BATCHES') ?? 400;
  await runWithOperatingTenant(buildTenantConfigFromEnv(), () =>
    backfillAccountIntelligenceProjection(batchSize, maxBatches),
  );
};

registerHandler('ACCOUNT_INTELLIGENCE.PROJECTION_BACKFILL', handleAccountIntelligenceProjectionBackfill);
