import type { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../../../platform/db/connection.js';

export type BdxImportJobStatus =
  | 'queued'
  | 'parsing'
  | 'validating'
  | 'ready_for_commit'
  | 'importing'
  | 'completed'
  | 'completed_with_failures'
  | 'failed'
  | 'cancelled';

export type CreateBdxImportJobInput = {
  operatingTenantId: string;
  tenantHost: string;
  productLine: string;
  fileType: string;
  mode: 'dryRun' | 'commit';
  status?: BdxImportJobStatus;
  dryRunJobId?: string | null;
  sourceFileHash: string;
  sourceFilePath: string;
  sourceFileBytes?: Buffer | null;
  createdBy?: string | null;
};

export async function createBdxImportJob(input: CreateBdxImportJobInput) {
  return tenantScopedPrisma.bdxImportJob.create({
    data: {
      operatingTenantId: input.operatingTenantId,
      tenantHost: input.tenantHost,
      productLine: input.productLine,
      fileType: input.fileType,
      mode: input.mode,
      status: input.status || 'queued',
      dryRunJobId: input.dryRunJobId || undefined,
      sourceFileHash: input.sourceFileHash,
      sourceFilePath: input.sourceFilePath,
      sourceFileBytes: input.sourceFileBytes || undefined,
      createdBy: input.createdBy || undefined,
    },
  });
}

export async function getBdxImportJob(jobId: string) {
  return tenantScopedPrisma.bdxImportJob.findUnique({ where: { id: jobId } });
}

export async function getBdxImportJobCrossTenant(jobId: string) {
  return prisma.bdxImportJob.findUnique({ where: { id: jobId } }); // guard:cross-tenant-intentional - worker restores ALS from durable job id.
}

export async function updateBdxImportJob(jobId: string, data: Prisma.BdxImportJobUpdateInput) {
  return tenantScopedPrisma.bdxImportJob.update({
    where: { id: jobId },
    data,
  });
}

export async function appendBdxImportJobLog(args: {
  jobId: string;
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  sourceSheetName?: string | null;
  sourceMonth?: string | null;
  rowNumber?: number | null;
  policyRef?: string | null;
  termKey?: string | null;
  facioPolicyId?: string | null;
  detailsJson?: Prisma.InputJsonValue;
}) {
  return tenantScopedPrisma.bdxImportJobLog.create({
    data: {
      jobId: args.jobId,
      level: args.level,
      code: args.code,
      message: args.message,
      sourceSheetName: args.sourceSheetName || undefined,
      sourceMonth: args.sourceMonth || undefined,
      rowNumber: args.rowNumber ?? undefined,
      policyRef: args.policyRef || undefined,
      termKey: args.termKey || undefined,
      facioPolicyId: args.facioPolicyId || undefined,
      detailsJson: args.detailsJson,
    },
  });
}

export async function listBdxImportJobLogs(jobId: string) {
  return tenantScopedPrisma.bdxImportJobLog.findMany({
    where: { jobId },
    orderBy: { timestamp: 'asc' },
  });
}

export async function upsertBdxImportJobResult(args: {
  jobId: string;
  summaryJson: Prisma.InputJsonValue;
  resultJson: Prisma.InputJsonValue;
}) {
  return tenantScopedPrisma.bdxImportJobResult.upsert({
    where: { jobId: args.jobId },
    update: {
      summaryJson: args.summaryJson,
      resultJson: args.resultJson,
    },
    create: {
      jobId: args.jobId,
      summaryJson: args.summaryJson,
      resultJson: args.resultJson,
    },
  });
}

export async function getBdxImportJobResult(jobId: string) {
  return tenantScopedPrisma.bdxImportJobResult.findUnique({ where: { jobId } });
}
