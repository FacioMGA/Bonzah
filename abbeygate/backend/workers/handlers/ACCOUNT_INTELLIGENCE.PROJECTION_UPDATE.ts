import { Job, UnrecoverableError } from 'bullmq';
import { z } from 'zod';
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
// Producer: `enqueueAccountIntelligenceProjectionUpdate` in
// `backend/modules/accounts360/infra/projections/accountIntelligenceProjection.ts`.
//
// Body wrapped in `runWithAccountOperatingTenant` for the same reason
// as ACCOUNTS360.PROJECTION_UPDATE — the projection rebuilder calls
// tenant-scoped Prisma writes that the fail-closed tenant extension
// (ADR-0019) rejects without an ALS frame. (ABY-281.)
//
// ABY-408 — dead-letter permanent tenant misses (deleted holder with no
// leftover projection rows). Same pattern as POLICY.INDEX_UPDATE /
// ACCOUNTS360.PROJECTION_UPDATE.
export const AccountIntelligenceProjectionUpdateDataSchema = z.object({
  accountId: z.string().min(1, 'ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE missing envelope.data.accountId'),
});

const EnvelopeSchema = z.object({ data: AccountIntelligenceProjectionUpdateDataSchema });
const CorrelationSchema = z.object({ correlationId: z.string().min(1).optional() });

interface ProjectionJobLogContext {
  cid: string;
  queue: string;
  jobId: string;
  attemptsMade: number;
}

export async function runAccountIntelligenceProjectionUpdate(
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
    await runWithAccountOperatingTenant(data.accountId, () =>
      rebuildAccountIntelligenceProjection(data.accountId),
    );
  } catch (err) {
    if (err instanceof AccountTenantContextMissingError) {
      logger.warn(
        {
          event: 'account_intelligence.projection_update.dead_lettered',
          ...jobContext,
          status: 'dead_lettered',
          accountId: data.accountId,
        },
        'ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE dead-lettered: account has no operating tenant context',
      );
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
}

export const handleAccountIntelligenceProjectionUpdate: JobHandler = (job: Job) => {
  const correlation = CorrelationSchema.safeParse(job.data);
  return runAccountIntelligenceProjectionUpdate(job.data, {
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

registerHandler('ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE', handleAccountIntelligenceProjectionUpdate);
