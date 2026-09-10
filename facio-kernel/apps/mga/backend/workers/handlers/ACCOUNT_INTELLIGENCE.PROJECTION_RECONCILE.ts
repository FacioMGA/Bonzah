import { Job } from 'bullmq';
import { z } from 'zod';
import { reconcileAccountIntelligenceProjectionBatch } from '../../modules/accounts360/infra/projections/accountIntelligenceProjection.js';
import { runWithWorkerTenant } from '../../platform/events/platformJobContext.js';
import { buildTenantConfigFromEnv } from '../../platform/tenant/tenantConfigForCli.js';
import { registerHandler, JobHandler } from '../index.js';

// Dispatched by the outbox relay; `job.data` is the full
// `DomainEventEnvelope`. Read tunables from `envelope.data.*` per the
// canonical pattern (ADR-0013). See `POLICY.INDEX_BACKFILL.ts` for
// the rationale.
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

// ABY-281 — system batch job, see `POLICY.INDEX_BACKFILL.ts` rationale.
export const handleAccountIntelligenceProjectionReconcile: JobHandler = async (job: Job) => {
  const data = EnvelopeSchema.parse(job.data)?.data ?? {};
  const limit = data.limit ?? envInt('ACCOUNT_INTELLIGENCE_RECONCILE_LIMIT') ?? 300;
  await runWithWorkerTenant(() =>
    reconcileAccountIntelligenceProjectionBatch(limit), buildTenantConfigFromEnv
    );
};

registerHandler('ACCOUNT_INTELLIGENCE.PROJECTION_RECONCILE', handleAccountIntelligenceProjectionReconcile);
