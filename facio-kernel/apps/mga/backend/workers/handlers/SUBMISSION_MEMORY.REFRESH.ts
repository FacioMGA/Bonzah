/**
 * SUBMISSION_MEMORY.REFRESH — async refresh worker for the underwriting
 * submission memory projection (ADR-0044). Mirrors CLAIM_MEMORY.REFRESH.
 *
 * Wrapped in `runWithPolicyOperatingTenant` so every tenant-scoped write
 * inside the orchestrator satisfies the fail-closed tenant extension.
 */

import { Job } from 'bullmq';
import { z } from 'zod';
import {
  refreshSubmissionMemoryUseCase,
  type SubmissionRefreshReason,
} from '../../modules/policy/app/submissionMemory/refreshSubmissionMemoryUseCase.js';
import { runWithPolicyOperatingTenant } from '../../platform/tenant/tenantJobContext.js';
import { registerHandler, JobHandler } from '../index.js';

const DataSchema = z.object({
  submissionId: z.string().min(1, 'SUBMISSION_MEMORY.REFRESH missing envelope.data.submissionId'),
  reason: z.enum(['email_arrived', 'manual_refresh', 'backfill', 'bo_route']).default('email_arrived'),
});

const EnvelopeSchema = z.union([z.object({ data: DataSchema }), DataSchema]);

function extractData(jobData: unknown) {
  const parsed = EnvelopeSchema.parse(jobData);
  return 'data' in parsed ? parsed.data : parsed;
}

export const handleSubmissionMemoryRefresh: JobHandler = async (job: Job) => {
  const data = extractData(job.data);
  await runWithPolicyOperatingTenant(data.submissionId, () =>
    refreshSubmissionMemoryUseCase({
      submissionId: data.submissionId,
      reason: data.reason as SubmissionRefreshReason,
    }),
  );
};

registerHandler('SUBMISSION_MEMORY.REFRESH', handleSubmissionMemoryRefresh);
