/**
 * COMM.EMAIL_INGESTED — Org2Vec ingestion fan-out worker (ADR-0044).
 *
 * Emitted by `ingestEmails` once per ingested conversation. This handler:
 *   1. restores the operating-tenant context from the envelope,
 *   2. logs a durable `Org2VecIngestionEvent` row (audit trail),
 *   3. enqueues the SCOPED memory refresh for the resolved business object
 *      (CLAIM_MEMORY.REFRESH or SUBMISSION_MEMORY.REFRESH) — never a global
 *      rebuild; unresolved emails are logged and left for triage.
 *
 * Idempotent: re-running re-logs (cheap) and re-enqueues a debounced
 * refresh job, which collapses to one in-flight refresh per scope.
 */

import { Job } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { tenantScopedPrisma } from '../../platform/db/connection.js';
import type { WithoutTenantScope } from '../../platform/db/tenantExtension.js';
import { runWithOperatingTenantById } from '../../platform/tenant/tenantJobContext.js';
import { logger } from '../../platform/utils/logger.js';
import { enqueueClaimMemoryRefresh } from '../../modules/claims/infra/mailgraph/enqueueClaimMemoryRefresh.js';
import { enqueueSubmissionMemoryRefresh } from '../../modules/policy/infra/submissionMemory/enqueueSubmissionMemoryRefresh.js';
import { registerHandler, JobHandler } from '../index.js';

const DataSchema = z.object({
  operatingTenantId: z.string().min(1, 'COMM.EMAIL_INGESTED missing operatingTenantId'),
  threadId: z.string().optional(),
  conversationId: z.string().optional(),
  scopeType: z.enum(['CLAIM', 'SUBMISSION', 'UNRESOLVED']),
  scopeId: z.string().nullish(),
  matchedBy: z.string().optional(),
  messageCount: z.number().optional(),
  source: z.string().optional(),
  identifiers: z.record(z.string(), z.unknown()).optional(),
});

const EnvelopeSchema = z.union([z.object({ data: DataSchema }), DataSchema]);

function extractData(jobData: unknown) {
  const parsed = EnvelopeSchema.parse(jobData);
  return 'data' in parsed ? parsed.data : parsed;
}

export const handleEmailIngested: JobHandler = async (job: Job) => {
  const data = extractData(job.data);

  await runWithOperatingTenantById(data.operatingTenantId, async () => {
    const eventData: WithoutTenantScope<Prisma.Org2VecIngestionEventUncheckedCreateInput> = {
      scopeType: data.scopeType,
      scopeId: data.scopeId ?? null,
      threadId: data.threadId ?? null,
      conversationId: data.conversationId ?? null,
      source: data.source ?? 'unknown',
      status: 'PROCESSED',
      matchedBy: data.matchedBy ?? null,
      messageCount: data.messageCount ?? 0,
      payload: (job.data ?? {}) as Prisma.InputJsonValue,
    };
    await tenantScopedPrisma.org2VecIngestionEvent.create({
      data: eventData as Prisma.Org2VecIngestionEventUncheckedCreateInput,
    });

    if (data.scopeType === 'CLAIM' && data.scopeId) {
      await enqueueClaimMemoryRefresh(tenantScopedPrisma, {
        claimId: data.scopeId,
        reason: 'email_arrived',
        actorType: 'SYSTEM',
        actorId: 'org2vec-ingest',
      });
    } else if (data.scopeType === 'SUBMISSION' && data.scopeId) {
      await enqueueSubmissionMemoryRefresh(tenantScopedPrisma, {
        submissionId: data.scopeId,
        reason: 'email_arrived',
        actorType: 'SYSTEM',
        actorId: 'org2vec-ingest',
      });
    } else {
      logger.info(
        { event: 'org2vec.ingest.unresolved', threadId: data.threadId, matchedBy: data.matchedBy },
        'org2vec.ingest.unresolved',
      );
    }
  });
};

registerHandler('COMM.EMAIL_INGESTED', handleEmailIngested);
