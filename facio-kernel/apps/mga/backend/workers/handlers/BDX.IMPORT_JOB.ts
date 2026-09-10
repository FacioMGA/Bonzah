import type { Job } from 'bullmq';
import { z } from 'zod';
import { registerHandler, type JobHandler } from '../index.js';
import { runWithBdxJobOperatingTenant } from '../../modules/policy/app/bdxImport/bdxImportJobTenantContext.js';
import { runBdxImportJob } from '../../modules/policy/app/bdxImport/bdxImportJobRunner.js';

const PayloadSchema = z.object({
  jobId: z.string().min(1, 'BDX.IMPORT_JOB requires jobId'),
});

export const handleBdxImportJob: JobHandler = async (job: Job) => {
  const data = PayloadSchema.parse(job.data);
  return runWithBdxJobOperatingTenant(data.jobId, () => runBdxImportJob(data.jobId));
};

registerHandler('BDX.IMPORT_JOB', handleBdxImportJob);
