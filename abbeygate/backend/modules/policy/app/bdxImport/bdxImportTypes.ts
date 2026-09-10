import type { Prisma } from '@prisma/client';
import type { BdxImportRequest, BdxImportResult, BdxRowEvaluation } from '../../../reporting/app/bdxImport/types.js';

// Shared app-layer command/context types for the BDX import flow.
// These types deliberately avoid HTTP/Express request objects so the router
// remains the transport boundary and the app layer stays request-agnostic.

export type BdxImportActor = {
  id: string | null;
  name: string | null;
  email: string | null;
  role: string | null;
};

export type BdxImportRequestUrlContext = {
  protocol: string;
  host: string;
  origin?: string;
};

export type BdxImportExecutionContext = {
  actor: BdxImportActor;
  correlationId: string;
  reqUrlContext: BdxImportRequestUrlContext;
};

export type BdxResolvedBinder = {
  id: string;
  startDate: Date | null;
  endDate: Date | null;
};

export type BdxResolvedProgramContext = {
  id: string;
  metadata: Prisma.JsonValue;
};

export type BdxPolicyRowImportCommand = {
  evaluation: BdxRowEvaluation;
  request: BdxImportRequest;
  programId: string;
  binderId: string;
  accountId: string | null;
  runId: string;
  context: BdxImportExecutionContext;
  bindMode?: 'coverage' | 'full';
};

export type BdxRenewalTermImportCommand = {
  evaluation: BdxRowEvaluation;
  request: BdxImportRequest;
  priorPolicyId: string;
  binderId: string;
  runId: string;
  context: BdxImportExecutionContext;
};

export type BdxEndorsementReplayCommand = {
  evaluation: BdxRowEvaluation;
  runId: string;
  policyId?: string | null;
  context: BdxImportExecutionContext;
};

export type BdxImportLiveRunCommand = {
  result: BdxImportResult;
  request: BdxImportRequest;
  runId: string;
  maxImports: number;
  accountId: string | null;
  program: BdxResolvedProgramContext;
  binders: BdxResolvedBinder[];
  context: BdxImportExecutionContext;
};

export type BdxProjectionSyncResult =
  | { status: 'verified' }
  | { status: 'repaired_with_warning'; warning: string }
  | { status: 'failed'; warning: string };
