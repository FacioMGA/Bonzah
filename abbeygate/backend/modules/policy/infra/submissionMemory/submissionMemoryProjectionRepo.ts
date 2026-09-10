/**
 * submissionMemoryProjectionRepo — Postgres I/O for
 * `submission_memory_projections` (ADR-0044). Mirrors the claims
 * projection repo. Sole writer is `refreshSubmissionMemoryUseCase`.
 */

import { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import type { WithoutTenantScope } from '../../../../platform/db/tenantExtension.js';
import type { JsonObject } from '../../../../platform/types/json.js';
import type {
  SubmissionMemoryObject,
  SubmissionMemoryRefreshStatus,
  MemoryCitation,
  SimilarSubmission,
} from '../../domain/submissionMemory/submissionMemoryObject.js';

export interface SubmissionMemoryProjectionRow {
  id: string;
  operatingTenantId: string;
  submissionId: string;
  summary: string | null;
  summaryCitations: MemoryCitation[];
  memoryObject: SubmissionMemoryObject;
  similarSubmissions: SimilarSubmission[];
  graphSignals: JsonObject;
  lastRefreshedAt: Date | null;
  refreshStatus: SubmissionMemoryRefreshStatus;
  refreshError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SaveInput {
  submissionId: string;
  summary?: string | null;
  summaryCitations?: MemoryCitation[];
  memoryObject: SubmissionMemoryObject;
  similarSubmissions?: SimilarSubmission[];
  graphSignals?: JsonObject;
  refreshStatus: SubmissionMemoryRefreshStatus;
  refreshError?: string | null;
  lastRefreshedAt?: Date | null;
}

function toJson<T>(value: T | undefined | null): Prisma.InputJsonValue {
  const bridged: unknown = value ?? null;
  return bridged as Prisma.InputJsonValue;
}

function fromJson<T>(value: Prisma.JsonValue | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  const bridged: unknown = value;
  return bridged as T;
}

const EMPTY_MEMORY_OBJECT: SubmissionMemoryObject = {
  submissionId: '',
  operatingTenantId: '',
  generatedAt: new Date(0).toISOString(),
  summary: null,
  citations: [],
  confidence: 'low',
  insufficientEvidenceFlags: [],
  lastRefreshedAt: new Date(0).toISOString(),
  timeline: [],
  missingInformation: [],
  underwritingFlags: [],
  endorsementChecks: [],
  referralTriggers: [],
  recommendedActions: [],
  similarSubmissions: [],
  draftBrokerRequest: null,
};

function rowFromPrisma(row: {
  id: string;
  operatingTenantId: string;
  submissionId: string;
  summary: string | null;
  summaryCitations: Prisma.JsonValue | null;
  memoryObject: Prisma.JsonValue;
  similarSubmissions: Prisma.JsonValue;
  graphSignals: Prisma.JsonValue;
  lastRefreshedAt: Date | null;
  refreshStatus: string;
  refreshError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SubmissionMemoryProjectionRow {
  return {
    id: row.id,
    operatingTenantId: row.operatingTenantId,
    submissionId: row.submissionId,
    summary: row.summary,
    summaryCitations: fromJson<MemoryCitation[]>(row.summaryCitations, []),
    memoryObject: fromJson<SubmissionMemoryObject>(row.memoryObject, EMPTY_MEMORY_OBJECT),
    similarSubmissions: fromJson<SimilarSubmission[]>(row.similarSubmissions, []),
    graphSignals: fromJson<JsonObject>(row.graphSignals, {}),
    lastRefreshedAt: row.lastRefreshedAt,
    refreshStatus: row.refreshStatus as SubmissionMemoryRefreshStatus,
    refreshError: row.refreshError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findSubmissionMemory(submissionId: string): Promise<SubmissionMemoryProjectionRow | null> {
  const row = await tenantScopedPrisma.submissionMemoryProjection.findUnique({ where: { submissionId } });
  return row ? rowFromPrisma(row) : null;
}

export async function markRefreshing(submissionId: string): Promise<void> {
  const createData: WithoutTenantScope<Prisma.SubmissionMemoryProjectionUncheckedCreateInput> = {
    submissionId,
    memoryObject: toJson({}),
    refreshStatus: 'refreshing',
  };
  await tenantScopedPrisma.submissionMemoryProjection.upsert({
    where: { submissionId },
    create: createData as Prisma.SubmissionMemoryProjectionUncheckedCreateInput,
    update: { refreshStatus: 'refreshing', refreshError: null },
  });
}

export async function saveSubmissionMemoryProjection(input: SaveInput): Promise<SubmissionMemoryProjectionRow> {
  const lastRefreshedAt = input.lastRefreshedAt ?? new Date();
  const baseData = {
    summary: input.summary ?? null,
    summaryCitations: input.summaryCitations === undefined ? Prisma.JsonNull : toJson(input.summaryCitations),
    memoryObject: toJson(input.memoryObject),
    similarSubmissions: toJson(input.similarSubmissions ?? []),
    graphSignals: toJson(input.graphSignals ?? {}),
    refreshStatus: input.refreshStatus,
    refreshError: input.refreshError ?? null,
    lastRefreshedAt,
  };
  const createData: WithoutTenantScope<Prisma.SubmissionMemoryProjectionUncheckedCreateInput> = {
    submissionId: input.submissionId,
    ...baseData,
  };
  const row = await tenantScopedPrisma.submissionMemoryProjection.upsert({
    where: { submissionId: input.submissionId },
    create: createData as Prisma.SubmissionMemoryProjectionUncheckedCreateInput,
    update: baseData,
  });
  return rowFromPrisma(row);
}

export async function markRefreshFailed(input: { submissionId: string; refreshError: string }): Promise<void> {
  const createData: WithoutTenantScope<Prisma.SubmissionMemoryProjectionUncheckedCreateInput> = {
    submissionId: input.submissionId,
    memoryObject: toJson(EMPTY_MEMORY_OBJECT),
    refreshStatus: 'failed',
    refreshError: input.refreshError,
  };
  await tenantScopedPrisma.submissionMemoryProjection.upsert({
    where: { submissionId: input.submissionId },
    create: createData as Prisma.SubmissionMemoryProjectionUncheckedCreateInput,
    update: { refreshStatus: 'failed', refreshError: input.refreshError },
  });
}
