import { Job, UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import { rebuildAccount360Projection } from '../../modules/accounts360/infra/projections/accounts360Projection.js';
import { rebuildAccountIntelligenceProjection } from '../../modules/accounts360/infra/projections/accountIntelligenceProjection.js';
import {
  AccountTenantContextMissingError,
  runWithAccountOperatingTenant,
} from '../../platform/tenant/tenantJobContext.js';
import { getCorrelationId } from '../../platform/observability/context.js';
import { logger } from '../../platform/utils/logger.js';
import { registerHandler, JobHandler } from '../index.js';

// Dispatched by the outbox relay; `job.data` is the full
// `DomainEventEnvelope`. Read from `envelope.data.*` per the
// canonical pattern (ADR-0013, see `DOC.GENERATE_ISSUED_POLICY_PACK`).
// Producer: `enqueueAccounts360ProjectionUpdate` in
// `backend/modules/accounts360/infra/projections/accounts360Projection.ts`.
//
// Like POLICY.INDEX_UPDATE, the body must run inside
// `runWithOperatingTenant` so the fail-closed tenant extension
// (ADR-0019) accepts the downstream `tenantScopedPrisma.policyHolder`,
// `accountSummaryProjection.upsert`, etc. queries. The producer
// passes the canonical `policyHolderId` as `accountId` (see
// `policyLifecycleCommands.ts`'s `enqueueAccounts360ProjectionUpdate(input.tx, policy.policyHolderId)`),
// so we restore tenant context from the PolicyHolder row via
// `runWithAccountOperatingTenant`. (ABY-281; surfaced after ABY-277
// envelope-unwrap unblocked the parse.)
//
// ABY-408 — when the holder is already deleted (DELETE /api/accounts/:id
// enqueues this job so rebuild can purge projection rows), tenant
// restore reads the leftover projection FK. If neither holder nor
// projection remains, dead-letter: permanent data miss, not transient.
export const Accounts360ProjectionUpdateDataSchema = z.object({
  accountId: z.string().min(1, 'ACCOUNTS360.PROJECTION_UPDATE missing envelope.data.accountId'),
});

const EnvelopeSchema = z.object({ data: Accounts360ProjectionUpdateDataSchema });
const CorrelationSchema = z.object({ correlationId: z.string().min(1).optional() });

interface ProjectionJobLogContext {
  cid: string;
  queue: string;
  jobId: string;
  attemptsMade: number;
}

export async function runAccounts360ProjectionUpdate(
  rawJobData: unknown,
  jobContext: ProjectionJobLogContext = {
    cid: getCorrelationId() || 'unavailable',
    queue: 'data-sync',
    jobId: 'unavailable',
    attemptsMade: 0,
  },
): Promise<void> {
  const { data } = EnvelopeSchema.parse(rawJobData);
  try {
    await runWithAccountOperatingTenant(data.accountId, async () => {
      await rebuildAccount360Projection(data.accountId);
      await rebuildAccountIntelligenceProjection(data.accountId);
    });
  } catch (err) {
    if (err instanceof AccountTenantContextMissingError) {
      logger.warn(
        {
          event: 'accounts360.projection_update.dead_lettered',
          ...jobContext,
          status: 'dead_lettered',
          accountId: data.accountId,
        },
        'ACCOUNTS360.PROJECTION_UPDATE dead-lettered: account has no operating tenant context',
      );
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
}

export const handleAccounts360ProjectionUpdate: JobHandler = (job: Job) => {
  const correlation = CorrelationSchema.safeParse(job.data);
  return runAccounts360ProjectionUpdate(job.data, {
    cid: String(
      (correlation.success ? correlation.data.correlationId : undefined)
      || getCorrelationId()
      || job.id
      || 'unavailable',
    ),
    queue: String(job.queueName || 'data-sync'),
    jobId: String(job.id || 'unavailable'),
    attemptsMade: Number(job.attemptsMade || 0),
  });
};

registerHandler('ACCOUNTS360.PROJECTION_UPDATE', handleAccounts360ProjectionUpdate);
