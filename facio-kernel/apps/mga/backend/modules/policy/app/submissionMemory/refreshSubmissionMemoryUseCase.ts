/**
 * refreshSubmissionMemoryUseCase — orchestrator for the submission memory
 * projection (ADR-0044). Sole writer of `submission_memory_projections`.
 *
 * Triggered by SUBMISSION_MEMORY.REFRESH (email arrival) and the BO
 * refresh route. Loads the policy/submission + its broker email threads,
 * builds the deterministic SubmissionMemoryObject, and saves the
 * projection. Degrades to a failed-status row on unexpected errors —
 * never blocks underwriting.
 */

import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import { logger } from '../../../../platform/utils/logger.js';
import {
  buildSubmissionMemoryObject,
  type SubmissionMessageInput,
} from './buildSubmissionMemoryObject.js';
import {
  markRefreshFailed,
  markRefreshing,
  saveSubmissionMemoryProjection,
} from '../../infra/submissionMemory/submissionMemoryProjectionRepo.js';

export type SubmissionRefreshReason = 'email_arrived' | 'manual_refresh' | 'backfill' | 'bo_route';

export interface RefreshSubmissionMemoryInput {
  submissionId: string;
  reason: SubmissionRefreshReason;
}

export type RefreshSubmissionMemoryResult =
  | { ok: true; submissionId: string; messageCount: number; refreshStatus: 'fresh' }
  | { ok: false; submissionId: string; code: 'SUBMISSION_NOT_FOUND' | 'UNEXPECTED'; message: string };

export async function refreshSubmissionMemoryUseCase(
  input: RefreshSubmissionMemoryInput,
): Promise<RefreshSubmissionMemoryResult> {
  const policy = await tenantScopedPrisma.policy.findUnique({
    where: { id: input.submissionId },
    select: { id: true, policyNumber: true, status: true, operatingTenantId: true },
  });
  if (!policy) {
    return {
      ok: false,
      submissionId: input.submissionId,
      code: 'SUBMISSION_NOT_FOUND',
      message: `Submission ${input.submissionId} not found in tenant scope`,
    };
  }

  await markRefreshing(input.submissionId);

  try {
    const threads = await tenantScopedPrisma.communicationThread.findMany({
      where: { entityType: { in: ['SUBMISSION', 'POLICY'] }, entityId: input.submissionId },
      select: { id: true },
    });
    const threadIds = threads.map((t) => t.id);
    const rawMessages = threadIds.length
      ? await tenantScopedPrisma.communicationMessage.findMany({
          where: { threadId: { in: threadIds } },
          select: {
            id: true,
            threadId: true,
            fromActor: true,
            subject: true,
            body: true,
            direction: true,
            sentAt: true,
            createdAt: true,
          },
        })
      : [];

    const messages: SubmissionMessageInput[] = rawMessages.map((m) => ({
      messageId: m.id,
      threadId: m.threadId,
      fromActor: m.fromActor ?? '',
      subject: m.subject ?? null,
      body: m.body ?? '',
      direction: m.direction,
      sentAt: (m.sentAt ?? m.createdAt).toISOString(),
    }));

    const memoryObject = buildSubmissionMemoryObject({
      submissionId: policy.id,
      operatingTenantId: policy.operatingTenantId,
      policyNumber: policy.policyNumber,
      status: policy.status,
      messages,
    });

    await saveSubmissionMemoryProjection({
      submissionId: policy.id,
      summary: memoryObject.summary,
      summaryCitations: memoryObject.citations,
      memoryObject,
      similarSubmissions: memoryObject.similarSubmissions,
      refreshStatus: 'fresh',
      refreshError: null,
    });

    return { ok: true, submissionId: policy.id, messageCount: messages.length, refreshStatus: 'fresh' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, submissionId: input.submissionId }, 'submission_memory.refresh_unexpected');
    await markRefreshFailed({ submissionId: input.submissionId, refreshError: `unexpected:${message.slice(0, 200)}` });
    return { ok: false, submissionId: input.submissionId, code: 'UNEXPECTED', message };
  }
}
