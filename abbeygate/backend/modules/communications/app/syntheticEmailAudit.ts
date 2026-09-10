import { prisma } from '../../../platform/db/connection.js';
import { logger } from '../../../platform/utils/logger.js';

// guard:cross-tenant-intentional — synthetic_email_runs is a cross-tenant
// operational log (canary/preview/worker span jurisdictions). Rows carry
// operatingTenantId as a per-row jurisdiction FILTER; the table is deliberately
// bare-prisma so a global cleanup/coverage report can read across tenants.
// See ADR-0068.

/**
 * Synthetic email audit trail (email-safety Phase 3).
 *
 * Every SYNTHETIC email dispatch (issuance-proof canary, preview "send test")
 * must leave a persistent, queryable record proving what was sent, to whom,
 * from which deployed build, and whether any created artefacts still need
 * cleaning up. Writing the record is best-effort: an audit failure must never
 * block or fail the underlying send (which has its own delivery record).
 *
 * guard:cross-tenant-intentional — this is a cross-tenant OPERATIONAL log, not
 * tenant-owned business data. The issuance-proof canary runs under a synthetic
 * tenant, the outbound worker finalises delivery keyed by `messageId` under
 * whatever tenant the comm thread bound, and the preview "send test" spans
 * jurisdictions. Each row still carries `operatingTenantId` (captured from ALS
 * at dispatch) so ops can FILTER canary evidence by jurisdiction — but the
 * table is deliberately readable/writable across tenants for a global cleanup
 * and coverage report, so it uses bare `prisma` rather than `tenantScopedPrisma`.
 */

/**
 * Resolve the currently deployed build identifier. In production this is the
 * container image tag, surfaced to the runtime as `SENTRY_RELEASE` (see the
 * Helm runtime configmap). Falls back to CI SHAs and finally `unknown`.
 */
export function resolveDeployedSha(env: NodeJS.ProcessEnv = process.env): string {
  return (
    String(
      env.SENTRY_RELEASE
      || env.RELEASE_SHA
      || env.GITHUB_SHA
      || env.IMAGE_TAG
      || '',
    ).trim() || 'unknown'
  );
}

export type SyntheticEmailResult = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'SKIPPED';
export type SyntheticEmailCleanupStatus = 'NOT_REQUIRED' | 'PENDING' | 'DONE' | 'FAILED';

export interface RecordSyntheticEmailRunInput {
  trigger: string;
  templateKey: string;
  templateVersion?: number | null;
  /** Originating CommunicationMessage id, used to finalise delivery later. */
  messageId?: string | null;
  /** Operating tenant (jurisdiction) that produced the run, from ALS. */
  operatingTenantId?: string | null;
  recipients: string[];
  deliveryIds?: string[];
  result?: SyntheticEmailResult;
  resultDetail?: string | null;
  cleanupStatus?: SyntheticEmailCleanupStatus;
  cleanupDetail?: string | null;
  source?: string | null;
  correlationId?: string | null;
}

export async function recordSyntheticEmailRun(input: RecordSyntheticEmailRunInput): Promise<void> {
  try {
    await prisma.syntheticEmailRun.create({
      data: {
        deployedSha: resolveDeployedSha(),
        trigger: input.trigger,
        templateKey: input.templateKey,
        templateVersion: input.templateVersion ?? null,
        messageId: input.messageId ?? null,
        operatingTenantId: input.operatingTenantId ?? null,
        recipients: input.recipients,
        deliveryIds: input.deliveryIds ?? [],
        result: input.result || 'QUEUED',
        resultDetail: input.resultDetail ?? null,
        cleanupStatus: input.cleanupStatus || 'NOT_REQUIRED',
        cleanupDetail: input.cleanupDetail ?? null,
        source: input.source ?? null,
        correlationId: input.correlationId ?? null,
      },
    });
  } catch (err) {
    logger.warn(
      { event: 'email.synthetic.audit.write_failed', trigger: input.trigger, err },
      'email.synthetic.audit.write_failed',
    );
  }
}

/**
 * Finalise the delivery outcome of a synthetic run once the outbound worker has
 * actually handed the message to the provider. Keyed by the originating
 * CommunicationMessage id. Best-effort: a synthetic audit update must never
 * break real delivery, and a missing row (audit write lost) is tolerated.
 */
export async function finaliseSyntheticEmailDelivery(input: {
  messageId: string;
  result: SyntheticEmailResult;
  deliveryIds?: string[];
  resultDetail?: string | null;
}): Promise<void> {
  const messageId = String(input.messageId || '').trim();
  if (!messageId) return;
  try {
    await prisma.syntheticEmailRun.updateMany({
      where: { messageId },
      data: {
        result: input.result,
        resultDetail: input.resultDetail ?? null,
        ...(input.deliveryIds && input.deliveryIds.length ? { deliveryIds: input.deliveryIds } : {}),
      },
    });
  } catch (err) {
    logger.warn(
      { event: 'email.synthetic.audit.delivery_update_failed', messageId, err },
      'email.synthetic.audit.delivery_update_failed',
    );
  }
}

/**
 * Record the outcome of cleaning up artefacts created by a synthetic run
 * (e.g. the issuance-proof canary's throwaway policy). Keyed by correlationId
 * so the proof lifecycle can close out every row it produced. Best-effort.
 */
export async function markSyntheticEmailCleanup(input: {
  correlationId: string;
  status: Extract<SyntheticEmailCleanupStatus, 'DONE' | 'FAILED'>;
  detail?: string | null;
}): Promise<void> {
  const correlationId = String(input.correlationId || '').trim();
  if (!correlationId) return;
  try {
    await prisma.syntheticEmailRun.updateMany({
      where: { correlationId, cleanupStatus: 'PENDING' },
      data: { cleanupStatus: input.status, cleanupDetail: input.detail ?? null },
    });
  } catch (err) {
    logger.warn(
      { event: 'email.synthetic.audit.cleanup_update_failed', correlationId, err },
      'email.synthetic.audit.cleanup_update_failed',
    );
  }
}
