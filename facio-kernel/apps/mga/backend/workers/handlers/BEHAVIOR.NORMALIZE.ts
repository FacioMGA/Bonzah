/**
 * BEHAVIOR.NORMALIZE worker.
 *
 * Triggered by the queue fan-out in `routeEventToQueue`: for every relayed
 * outbox event whose original eventType is mapped by the behavior manifest,
 * a sibling job is enqueued on the data-sync queue. This worker delegates
 * to the pure `normalizeOutboxEvent` function and, on success, enqueues a
 * follow-up `BEHAVIOR.TRAJECTORY_UPDATE` for the affected policy.
 *
 * Idempotency: the underlying function relies on the `sourceEventId`
 * unique constraint, so duplicate jobs are safe.
 */
import { Job } from 'bullmq';
import { normalizeOutboxEvent } from '../../platform/behavior/normalize/normalizeOutboxEvent.js';
import { readDomainEventLike, resolvePolicyEntityId } from '../../platform/behavior/manifest/loadManifest.js';
import { runWithPolicyOperatingTenant, PolicyTenantContextMissingError } from '../../platform/tenant/tenantJobContext.js';
import { logger } from '../../platform/utils/logger.js';
import { queues } from '../../platform/events/queue.js';
import { registerHandler, type JobHandler } from '../index.js';

// `job.data` is the relayed outbox payload (a DomainEventEnvelope).
// Its inner shape is validated downstream by `asEnvelope` inside
// `normalizeOutboxEvent`, so the worker boundary just needs an
// `unknown` pass-through — anything else would duplicate that contract.
export const handleBehaviorNormalize: JobHandler = async (job: Job<unknown>) => {
  // `normalizeOutboxEvent` reads/writes tenant-scoped `behavior_events` and
  // `policy`, so it MUST run inside the policy's operating-tenant context
  // (ADR-0019 fail-closed tenancy) — otherwise every job throws
  // TenantContextError and exhausts (2026-07-21 fan-out regression). Restore
  // the context from the policy the event concerns. Non-policy events (no
  // resolvable policyId) fall through to the un-scoped call, which skips them
  // before any tenant-scoped query. A missing policy/tenant is a permanent
  // data condition, so treat it as a skip rather than a retryable failure.
  const envelope = readDomainEventLike(job.data);
  const policyId = envelope ? resolvePolicyEntityId(envelope) : null;
  const run = () => normalizeOutboxEvent({ payload: job.data });
  let result;
  if (policyId) {
    try {
      result = await runWithPolicyOperatingTenant(policyId, run);
    } catch (err) {
      if (err instanceof PolicyTenantContextMissingError) {
        result = { status: 'skipped' as const, reason: 'POLICY_TENANT_UNRESOLVED' };
      } else {
        throw err;
      }
    }
  } else {
    result = await run();
  }
  logger.info({
    event: 'behavior.normalize.result',
    jobId: job.id,
    status: result.status,
    ...(result.status !== 'skipped'
      ? { policyId: result.policyId, behaviorType: result.behaviorType }
      : { reason: result.reason }),
  }, 'behavior.normalize.result');

  if (result.status === 'created' || result.status === 'duplicate') {
    await queues.dataSync.add(
      'BEHAVIOR.TRAJECTORY_UPDATE',
      { policyId: result.policyId },
      { removeOnComplete: true, attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    );
  }
  return result;
};

registerHandler('BEHAVIOR.NORMALIZE', handleBehaviorNormalize);
