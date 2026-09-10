/**
 * neo4jClaimGraphRepository.ts — sole executor of the named claim-graph
 * Cypher queries (ADR-0041).
 *
 * Loads the `.cypher` files at startup so:
 *   - the file contents are tracked by source control,
 *   - the guard `check-cypher-files-tenant-scoped.mjs` can statically
 *     verify each query references `$tenantId` in a `WHERE` clause,
 *   - no Cypher string ever originates from external input
 *     (ADR-0041 forbidden list: `operator.run_cypher` / `query_neo4j`).
 *
 * Every public method accepts `tenantId` as an explicit argument and
 * passes it as a bind parameter (never string-interpolated).  Enforced
 * by `check-neo4j-tenant-id-on-every-query.mjs`.
 *
 * Imports `withSession` from the platform singleton so this file does
 * NOT import `neo4j-driver` directly — that import is locked to
 * `backend/platform/graph/neo4jClient.ts`.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GraphOperationResult } from '../../../../platform/graph/neo4jClient.js';
import { withSession } from '../../../../platform/graph/neo4jClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CYPHER_DIR = path.join(__dirname, 'cypher');

interface CypherCache {
  upsertClaimGraph: string;
  similarClaimsByEntity: string;
  claimsWithMissingDocPattern: string;
  claimsWithEscalationPattern: string;
}

let cachedQueries: CypherCache | null = null;

async function loadCypher(): Promise<CypherCache> {
  if (cachedQueries) return cachedQueries;
  const [upsertClaimGraph, similarClaimsByEntity, claimsWithMissingDocPattern, claimsWithEscalationPattern] = await Promise.all([
    fs.readFile(path.join(CYPHER_DIR, 'upsertClaimGraph.cypher'), 'utf8'),
    fs.readFile(path.join(CYPHER_DIR, 'similarClaimsByEntity.cypher'), 'utf8'),
    fs.readFile(path.join(CYPHER_DIR, 'claimsWithMissingDocPattern.cypher'), 'utf8'),
    fs.readFile(path.join(CYPHER_DIR, 'claimsWithEscalationPattern.cypher'), 'utf8'),
  ]);
  cachedQueries = { upsertClaimGraph, similarClaimsByEntity, claimsWithMissingDocPattern, claimsWithEscalationPattern };
  return cachedQueries;
}

export interface UpsertClaimGraphParams {
  tenantId: string;
  claimId: string;
  product: string | null;
  jurisdiction: string | null;
  status: string;
  /** ADR-0044: memory-object summary stored on the MemoryObject node. */
  summary: string | null;
  /** ADR-0044: typed edge metadata applied to every structural edge. */
  edgeMeta: Record<string, string | number>;
  repairers: Array<{ repairerId: string; normalizedName: string }>;
  brokers: Array<{ brokerId: string; normalizedName: string }>;
  vehicles: Array<{ vehicleHash: string }>;
  events: Array<{
    eventId: string;
    type: string;
    date: string;
    reasonCode?: string | null;
    documentType?: string | null;
    amount?: number | null;
    citation?: { threadId: string; messageId: string; quote: string } | null;
  }>;
  threads: Array<{
    threadId: string;
    messages: Array<{
      messageId: string;
      sentAt: string;
      senderDomain: string | null;
      messageType: string;
    }>;
  }>;
  // ADR-0044 — new node/edge inputs.
  documents: Array<{ documentId: string; documentType: string; citationMessageId?: string | null }>;
  missingEvidence: Array<{ documentType: string; received: boolean }>;
  endorsements: Array<{ endorsementRef: string; status: string; governingSourceId?: string | null }>;
  gates: Array<{ code: string; status: string; summary: string }>;
}

export async function executeUpsertClaimGraph(params: UpsertClaimGraphParams): Promise<GraphOperationResult<{ nodes: number; edges: number }>> {
  const queries = await loadCypher();
  return withSession(async (session) => {
    await session.run(queries.upsertClaimGraph, params as unknown as Record<string, unknown>);
    // Crude counter: 1 claim + 1 per repairer/broker/vehicle/event + 1 per thread/message.
    const nodes =
      1 +
      params.repairers.length +
      params.brokers.length +
      params.vehicles.length +
      params.events.length +
      params.threads.length +
      params.threads.reduce((acc, t) => acc + t.messages.length, 0);
    const edges =
      params.threads.length + // HAS_THREAD
      params.threads.reduce((acc, t) => acc + t.messages.length, 0) + // HAS_MESSAGE
      params.repairers.length +
      params.brokers.length +
      params.vehicles.length +
      params.events.length +
      params.events.filter((e) => e.citation).length;
    return { nodes, edges };
  });
}

export interface SimilarByEntityRow {
  claimId: string;
  sharedSignals: string[];
  signalCount: number;
}

export async function executeSimilarClaimsByEntity(input: { tenantId: string; claimId: string }): Promise<GraphOperationResult<SimilarByEntityRow[]>> {
  const queries = await loadCypher();
  return withSession(async (session) => {
    const result = await session.run(queries.similarClaimsByEntity, { tenantId: input.tenantId, claimId: input.claimId });
    return result.records.map<SimilarByEntityRow>((record) => ({
      claimId: String(record.get('claimId') ?? ''),
      sharedSignals: (record.get('sharedSignals') as string[] | null) ?? [],
      signalCount: Number(record.get('signalCount') ?? 0),
    }));
  });
}

export interface MissingDocRow {
  claimId: string;
  sharedMissingDocs: string[];
}

export async function executeClaimsWithMissingDocPattern(input: { tenantId: string; claimId: string }): Promise<GraphOperationResult<MissingDocRow[]>> {
  const queries = await loadCypher();
  return withSession(async (session) => {
    const result = await session.run(queries.claimsWithMissingDocPattern, { tenantId: input.tenantId, claimId: input.claimId });
    return result.records.map<MissingDocRow>((record) => ({
      claimId: String(record.get('claimId') ?? ''),
      sharedMissingDocs: (record.get('sharedMissingDocs') as string[] | null) ?? [],
    }));
  });
}

export interface EscalationRow {
  claimId: string;
  reasonCode: string;
  date: string;
}

export async function executeClaimsWithEscalationPattern(input: { tenantId: string; claimId: string }): Promise<GraphOperationResult<EscalationRow[]>> {
  const queries = await loadCypher();
  return withSession(async (session) => {
    const result = await session.run(queries.claimsWithEscalationPattern, { tenantId: input.tenantId, claimId: input.claimId });
    return result.records.map<EscalationRow>((record) => ({
      claimId: String(record.get('claimId') ?? ''),
      reasonCode: String(record.get('reasonCode') ?? ''),
      date: String(record.get('date') ?? ''),
    }));
  });
}
