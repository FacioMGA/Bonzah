import { Job } from 'bullmq';
import { z } from 'zod';
import { reconcileAccounts360ProjectionBatch } from '../../modules/accounts360/infra/projections/accounts360Projection.js';
import { runWithOperatingTenant } from '../../platform/tenant/tenantAls.js';
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
export const handleAccounts360ProjectionReconcile: JobHandler = async (job: Job) => {
  const data = EnvelopeSchema.parse(job.data)?.data ?? {};
  const limit = data.limit ?? envInt('ACCOUNTS360_RECONCILE_LIMIT') ?? 300;
  await runWithOperatingTenant(buildTenantConfigFromEnv(), () =>
    reconcileAccounts360ProjectionBatch(limit),
  );
};

registerHandler('ACCOUNTS360.PROJECTION_RECONCILE', handleAccounts360ProjectionReconcile);
