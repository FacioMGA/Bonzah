/**
 * claimMemoryProjectionRepo — Postgres I/O for `claim_memory_projections` (ADR-0041).
 *
 * SOLE writer module — guarded by `tools/quality/check-claim-workspace-no-direct-neo4j.mjs`
 * and the operator-MCP no-direct-DB-writes guard.  All writes funnel through
 * `refreshClaimMemoryUseCase`; this repo is the only place that calls
 * `tenantScopedPrisma.claimMemoryProjection.upsert` for that table.
 *
 * Read API is exposed to the Claim Workspace HTTP layer (worksheet route)
 * and the four V1 operator MCP tools.  Both go through the same getter so
 * the staleness ladder (`refreshStatus`) is computed in one place.
 */

import { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import type {
  ClaimMemoryObject,
  ClaimMemoryRefreshStatus,
  ClaimMemoryCitation,
} from '../../domain/mailgraph/claimMemoryObject.js';
import type { SimilarClaim } from '../../domain/mailgraph/similarClaim.js';
import type { GraphSignals } from '../../domain/mailgraph/graphSignals.js';

export interface ClaimMemoryProjectionRow {
  id: string;
  operatingTenantId: string;
  claimId: string;
  summary: string | null;
  summaryCitations: ClaimMemoryCitation[];
  memoryObject: ClaimMemoryObject;
  similarClaims: SimilarClaim[];
  graphSignals: GraphSignals;
  lastRefreshedAt: Date | null;
  refreshStatus: ClaimMemoryRefreshStatus;
  refreshError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SaveInput {
  claimId: string;
  summary?: string | null;
  summaryCitations?: ClaimMemoryCitation[];
  memoryObject: ClaimMemoryObject;
  similarClaims?: SimilarClaim[];
  graphSignals?: GraphSignals;
  refreshStatus: ClaimMemoryRefreshStatus;
  refreshError?: string | null;
  lastRefreshedAt?: Date | null;
}

function toJson<T>(value: T | undefined | null): Prisma.InputJsonValue {
  return (value ?? null) as unknown as Prisma.InputJsonValue;
}

// Used as a placeholder when a projection row is created in a failure
// state (e.g. context-load failure) before any extraction has run.
// Readers must already tolerate missing fields, so an empty object is
// sufficient and keeps the typed surface honest.
const EMPTY_MEMORY_OBJECT: ClaimMemoryObject = {
  claimId: '',
  operatingTenantId: '',
  generatedAt: new Date(0).toISOString(),
  timeline: [],
  missingInformation: [],
  authorityFlags: [],
  liabilityPositions: [],
  recommendedActions: [],
  entities: [],
};

function fromJson<T>(value: Prisma.JsonValue | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  return value as unknown as T;
}

function rowFromPrisma(row: {
  id: string;
  operatingTenantId: string;
  claimId: string;
  summary: string | null;
  summaryCitations: Prisma.JsonValue | null;
  memoryObject: Prisma.JsonValue;
  similarClaims: Prisma.JsonValue;
  graphSignals: Prisma.JsonValue;
  lastRefreshedAt: Date | null;
  refreshStatus: string;
  refreshError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ClaimMemoryProjectionRow {
  return {
    id: row.id,
    operatingTenantId: row.operatingTenantId,
    claimId: row.claimId,
    summary: row.summary,
    summaryCitations: fromJson<ClaimMemoryCitation[]>(row.summaryCitations, []),
    memoryObject: fromJson<ClaimMemoryObject>(row.memoryObject, EMPTY_MEMORY_OBJECT),
    similarClaims: fromJson<SimilarClaim[]>(row.similarClaims, []),
    graphSignals: fromJson<GraphSignals>(row.graphSignals, {}),
    lastRefreshedAt: row.lastRefreshedAt,
    refreshStatus: row.refreshStatus as ClaimMemoryRefreshStatus,
    refreshError: row.refreshError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findClaimMemory(claimId: string): Promise<ClaimMemoryProjectionRow | null> {
  const row = await tenantScopedPrisma.claimMemoryProjection.findUnique({ where: { claimId } });
  return row ? rowFromPrisma(row) : null;
}

export async function markRefreshing(claimId: string): Promise<void> {
  await tenantScopedPrisma.claimMemoryProjection.upsert({
    where: { claimId },
    create: {
      claimId,
      memoryObject: toJson({}),
      refreshStatus: 'refreshing',
    } as unknown as Prisma.ClaimMemoryProjectionUncheckedCreateInput,
    update: { refreshStatus: 'refreshing', refreshError: null },
  });
}

export async function saveClaimMemoryProjection(input: SaveInput): Promise<ClaimMemoryProjectionRow> {
  const lastRefreshedAt = input.lastRefreshedAt ?? new Date();
  const baseData = {
    summary: input.summary ?? null,
    summaryCitations: input.summaryCitations === undefined ? Prisma.JsonNull : toJson(input.summaryCitations),
    memoryObject: toJson(input.memoryObject),
    similarClaims: toJson(input.similarClaims ?? []),
    graphSignals: toJson(input.graphSignals ?? {}),
    refreshStatus: input.refreshStatus,
    refreshError: input.refreshError ?? null,
    lastRefreshedAt,
  };

  const row = await tenantScopedPrisma.claimMemoryProjection.upsert({
    where: { claimId: input.claimId },
    create: { claimId: input.claimId, ...baseData } as unknown as Prisma.ClaimMemoryProjectionUncheckedCreateInput,
    update: baseData,
  });

  return rowFromPrisma(row);
}

export async function markRefreshFailed(input: {
  claimId: string;
  refreshError: string;
  memoryObject?: ClaimMemoryObject;
}): Promise<void> {
  await tenantScopedPrisma.claimMemoryProjection.upsert({
    where: { claimId: input.claimId },
    create: {
      claimId: input.claimId,
      memoryObject: toJson(input.memoryObject ?? EMPTY_MEMORY_OBJECT),
      refreshStatus: 'failed',
      refreshError: input.refreshError,
    } as unknown as Prisma.ClaimMemoryProjectionUncheckedCreateInput,
    update: {
      refreshStatus: 'failed',
      refreshError: input.refreshError,
      ...(input.memoryObject ? { memoryObject: toJson(input.memoryObject) } : {}),
    },
  });
}
