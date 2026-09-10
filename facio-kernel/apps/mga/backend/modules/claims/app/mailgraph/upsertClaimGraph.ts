/**
 * upsertClaimGraph — pipeline step 8 (ADR-0041).
 *
 * Writes the claim's graph view to Neo4j: 10 node labels, 10 edge types.
 * Idempotent (`MERGE`-only).  Every node carries `tenantId`; every
 * Cypher bind parameter carries `tenantId` explicitly.
 *
 * Delegates execution to `neo4jClaimGraphRepository.executeUpsertClaimGraph`
 * which is the SOLE consumer of `withSession`.  If Neo4j is disabled or
 * unreachable the orchestrator stays on the projection-only path and
 * the previous `similarClaims` are preserved (see
 * `refreshClaimMemoryUseCase`).
 */

import crypto from 'node:crypto';
import { logger } from '../../../../platform/utils/logger.js';
import type { ClaimMemoryObject } from '../../domain/mailgraph/claimMemoryObject.js';
import { buildEdgeMetadata, toCypherEdgeProps } from '../../../org2vec/index.js';
import {
  executeUpsertClaimGraph,
  type UpsertClaimGraphParams,
} from '../../infra/mailgraph/neo4jClaimGraphRepository.js';

export interface UpsertClaimGraphInput {
  tenantId: string;
  claimId: string;
  memoryObject: ClaimMemoryObject;
  /** Product code (MOTOR/HOME/TRAVEL/HEALTH) — sourced from Claim or Policy. */
  product?: string | null;
  /** ISO2 jurisdiction; defaults to Claim.lossCountry. */
  jurisdiction?: string | null;
  /** Current claim status; defaults to Claim.status. */
  status?: string;
  /** Distinct threads + messages (for HAS_THREAD / HAS_MESSAGE edges). */
  threads: Array<{ threadId: string; messages: Array<{ messageId: string; sentAt: string; senderDomain: string | null; channel: string }> }>;
}

export type UpsertClaimGraphResult =
  | { ok: true; nodesUpserted: number; edgesUpserted: number }
  | { ok: false; reason: 'neo4j_disabled' | 'neo4j_unavailable' | 'cypher_error'; message?: string };

function hashId(prefix: string, ...parts: string[]): string {
  return `${prefix}:${crypto.createHash('sha256').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 16)}`;
}

function deterministicEventId(claimId: string, type: string, date: string, suffix?: string): string {
  return hashId('event', claimId, type, date, suffix ?? '');
}

function buildParams(input: UpsertClaimGraphInput): UpsertClaimGraphParams {
  const tenantId = input.tenantId;
  const claimId = input.claimId;

  const repairerMap = new Map<string, { repairerId: string; normalizedName: string }>();
  const brokerMap = new Map<string, { brokerId: string; normalizedName: string }>();
  const vehicleMap = new Map<string, { vehicleHash: string }>();

  for (const entity of input.memoryObject.entities) {
    if (entity.type === 'repairer' && entity.normalizedName) {
      const id = hashId('repairer', tenantId, entity.normalizedName.toLowerCase());
      repairerMap.set(id, { repairerId: id, normalizedName: entity.normalizedName });
    } else if (entity.type === 'broker' && entity.normalizedName) {
      const id = hashId('broker', tenantId, entity.normalizedName.toLowerCase());
      brokerMap.set(id, { brokerId: id, normalizedName: entity.normalizedName });
    } else if (entity.type === 'vehicle' && entity.vehicleRegHash) {
      vehicleMap.set(entity.vehicleRegHash, { vehicleHash: entity.vehicleRegHash });
    }
  }

  const events = input.memoryObject.timeline.map((event, idx) => ({
    eventId: deterministicEventId(claimId, event.type, event.date, String(idx)),
    type: event.type,
    date: event.date,
    reasonCode: event.reasonCode ?? null,
    documentType: event.documentType ?? null,
    amount: typeof event.amount === 'number' ? event.amount : null,
    citation: event.citation ? { threadId: event.citation.threadId, messageId: event.citation.messageId, quote: event.citation.quote } : null,
  }));

  const threads = input.threads.map((thread) => ({
    threadId: thread.threadId,
    messages: thread.messages.map((message) => ({
      messageId: message.messageId,
      sentAt: message.sentAt,
      senderDomain: message.senderDomain,
      messageType: message.channel,
    })),
  }));

  // ADR-0044 — structural edges are deterministic identifier matches.
  const edgeMeta = toCypherEdgeProps(
    buildEdgeMetadata({ createdBy: 'identifier_match', sourceType: 'canonical_record', sourceId: claimId }),
  );

  const documents = input.memoryObject.timeline
    .filter((event) => event.type === 'doc_received' && event.documentType)
    .map((event) => ({
      documentId: hashId('doc', claimId, String(event.documentType), event.date),
      documentType: String(event.documentType),
      citationMessageId: event.citation?.messageId ?? null,
    }));

  const missingEvidence = input.memoryObject.missingInformation.map((row) => ({
    documentType: row.documentType,
    received: row.received,
  }));

  const endorsements = (input.memoryObject.endorsementChecks ?? []).map((check) => ({
    endorsementRef: check.endorsementRef,
    status: check.status,
    governingSourceId: check.governingSourceId ?? null,
  }));

  const gates = (input.memoryObject.gateDecisions ?? []).map((gate) => ({
    code: gate.code,
    status: gate.status,
    summary: gate.summary,
  }));

  return {
    tenantId,
    claimId,
    product: input.product ?? null,
    jurisdiction: input.jurisdiction ?? null,
    status: input.status ?? 'OPEN',
    summary: input.memoryObject.summary ?? null,
    edgeMeta,
    repairers: Array.from(repairerMap.values()),
    brokers: Array.from(brokerMap.values()),
    vehicles: Array.from(vehicleMap.values()),
    events,
    threads,
    documents,
    missingEvidence,
    endorsements,
    gates,
  };
}

export async function upsertClaimGraph(input: UpsertClaimGraphInput): Promise<UpsertClaimGraphResult> {
  const params = buildParams(input);
  const result = await executeUpsertClaimGraph(params);
  if (!result.ok) {
    logger.warn(
      { event: 'claim_memory.graph_upsert_failed', claimId: input.claimId, reason: result.reason, message: result.message },
      'claim_memory.graph_upsert_failed',
    );
    return { ok: false, reason: result.reason, message: result.message };
  }
  return { ok: true, nodesUpserted: result.data.nodes, edgesUpserted: result.data.edges };
}
