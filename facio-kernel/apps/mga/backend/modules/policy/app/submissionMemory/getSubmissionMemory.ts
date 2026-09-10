/**
 * getSubmissionMemory — read the submission memory projection for the
 * underwriting panel (ADR-0044). Computes a simple staleness flag.
 */

import { findSubmissionMemory } from '../../infra/submissionMemory/submissionMemoryProjectionRepo.js';

const STALE_AFTER_MS = Number(process.env.SUBMISSION_MEMORY_STALE_AFTER_MS || 24 * 60 * 60 * 1000);

export interface GetSubmissionMemoryResult {
  submissionId: string;
  status: 'present' | 'absent';
  stalenessWarning: boolean;
  projection: Awaited<ReturnType<typeof findSubmissionMemory>>;
}

export async function getSubmissionMemory(input: { submissionId: string }): Promise<GetSubmissionMemoryResult> {
  const projection = await findSubmissionMemory(input.submissionId);
  if (!projection) {
    return { submissionId: input.submissionId, status: 'absent', stalenessWarning: false, projection: null };
  }
  const last = projection.lastRefreshedAt ? projection.lastRefreshedAt.getTime() : 0;
  const stalenessWarning =
    projection.refreshStatus === 'failed' ||
    projection.refreshStatus === 'stale' ||
    (last > 0 && Date.now() - last > STALE_AFTER_MS);
  return { submissionId: input.submissionId, status: 'present', stalenessWarning, projection };
}
