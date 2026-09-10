/**
 * BEHAVIOR.TRAJECTORY_UPDATE worker.
 *
 * Triggered after a successful BEHAVIOR.NORMALIZE for a given policyId.
 * Reads the most recent N BehaviorEvent rows, mean-pools their embeddings,
 * runs the deterministic direction classifier, and upserts the
 * PolicyTrajectory projection.
 */
import { Job, UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import { updatePolicyTrajectory } from '../../platform/behavior/trajectory/updatePolicyTrajectory.js';
import {
  PolicyTenantContextMissingError,
  runWithPolicyOperatingTenant,
} from '../../platform/tenant/tenantJobContext.js';
import { getCorrelationId } from '../../platform/observability/context.js';
import { logger } from '../../platform/utils/logger.js';
import { registerHandler, type JobHandler } from '../index.js';

// Producer (canonical): backend/workers/handlers/BEHAVIOR.NORMALIZE.ts
// always enqueues with `{ policyId }`. Treating it as required surfaces
// any drift introduced by a future producer instead of soft-skipping.
const PayloadSchema = z.object({
  policyId: z.string().min(1, 'BEHAVIOR.TRAJECTORY_UPDATE missing policyId'),
});

interface TrajectoryJobLogContext {
  cid: string;
  queue: string;
  jobId: string;
  attemptsMade: number;
}

export async function runBehaviorTrajectoryUpdate(
  rawJobData: unknown,
  jobContext: TrajectoryJobLogContext = {
    cid: getCorrelationId() || 'unavailable',
    queue: 'data-sync',
    jobId: 'unavailable',
    attemptsMade: 0,
  },
) {
  const { policyId } = PayloadSchema.parse(rawJobData);
  let result;
  try {
    // The trajectory projector uses tenantScopedPrisma. Restore its sole
    // canonical tenant context from the durable Policy before dispatching;
    // BullMQ has no HTTP middleware/ALS frame (ADR-0019).
    result = await runWithPolicyOperatingTenant(policyId, () => updatePolicyTrajectory({ policyId }));
  } catch (err) {
    if (err instanceof PolicyTenantContextMissingError) {
      // This is a durable data defect, not a retryable outage. Preserve the
      // fail-closed posture and dead-letter once instead of exhausting three
      // identical attempts. No fallback tenant is ever selected.
      logger.warn(
        {
          event: 'behavior.trajectory_update.dead_lettered',
          ...jobContext,
          status: 'dead_lettered',
          policyId,
        },
        'BEHAVIOR.TRAJECTORY_UPDATE dead-lettered: policy has no operating tenant context',
      );
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
  logger.info({
    event: 'behavior.trajectory_update.result',
    ...jobContext,
    policyId,
    status: result.status,
    ...(result.status === 'updated'
      ? { eventCount: result.eventCount, direction: result.direction, driftScore: result.driftScore }
      : { reason: result.reason }),
  }, 'behavior.trajectory_update.result');
  return result;
}

export const handleBehaviorTrajectoryUpdate: JobHandler = (job: Job) =>
  runBehaviorTrajectoryUpdate(job.data, {
    cid: getCorrelationId() || String(job.id || 'unavailable'),
    queue: String(job.queueName || 'data-sync'),
    jobId: String(job.id || 'unavailable'),
    attemptsMade: Number(job.attemptsMade || 0),
  });

registerHandler('BEHAVIOR.TRAJECTORY_UPDATE', handleBehaviorTrajectoryUpdate);
