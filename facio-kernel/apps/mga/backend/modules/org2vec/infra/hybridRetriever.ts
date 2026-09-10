/**
 * hybridRetriever — Org2Vec hybrid retrieval over operational memory
 * (ADR-0044).
 *
 * Fuses four retrieval channels with Reciprocal Rank Fusion (RRF):
 *   1. Lexical / full-text (Postgres `to_tsvector` + `websearch_to_tsquery`).
 *   2. Semantic / vector (platform embedder; OpenAI or deterministic stub).
 *   3. Metadata filtering (scope, channel, recency).
 *   4. Graph traversal (related-case ids supplied by the caller, sourced
 *      from the Neo4j similar-case path so this module never issues raw
 *      Cypher — keeping the `neo4jClient`-only and cypher-file guards green).
 *
 * Returns cited passages. Read-only. The "ask" endpoint grounds answers
 * on these passages; the LLM may never answer un-cited.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../platform/db/connection.js';
import { getEmbedder } from '../../../platform/behavior/embedding/index.js';
import { logger } from '../../../platform/utils/logger.js';
import type { MemoryCitation } from '../domain/memoryObject.js';

export interface HybridRetrieveInput {
  scopeType: 'CLAIM' | 'SUBMISSION';
  scopeId: string;
  query: string;
  k?: number;
  /** Related case ids (e.g. similar claims) from the graph channel. */
  graphNeighborIds?: string[];
  /** Optional channel filter (EMAIL, NOTE, ...). */
  channels?: string[];
  /** Optional recency floor (ISO timestamp). */
  sinceIso?: string;
}

export interface RetrievedPassage {
  messageId: string;
  threadId: string;
  subject: string | null;
  snippet: string;
  channel: string;
  scopeType: string;
  scopeId: string;
  scores: { lexical?: number; vector?: number; graph?: number; fused: number };
  citation: MemoryCitation;
}

export interface HybridRetrieveResult {
  passages: RetrievedPassage[];
  channelsUsed: Array<'lexical' | 'vector' | 'graph' | 'metadata'>;
  embedderName: string | null;
}

interface CandidateRow {
  id: string;
  threadId: string;
  subject: string | null;
  body: string;
  channel: string;
  scopeType: string;
  scopeId: string;
  lexicalRank: number;
  sentAt: Date | null;
}

const DEFAULT_K = 6;
const MAX_CANDIDATES = 40;
const RRF_K0 = 60;

function snippetOf(body: string, max = 320): string {
  const clean = String(body || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Fetch candidate messages for one scope ordered by lexical relevance. */
async function fetchCandidates(input: {
  scopeType: string;
  scopeId: string;
  query: string;
  channels?: string[];
  sinceIso?: string;
  limit: number;
}): Promise<CandidateRow[]> {
  const filters: Prisma.Sql[] = [
    Prisma.sql`t."entityType" = ${input.scopeType}`,
    Prisma.sql`t."entityId" = ${input.scopeId}`,
  ];
  if (input.channels && input.channels.length > 0) {
    filters.push(Prisma.sql`m."channel" = ANY(${input.channels})`);
  }
  if (input.sinceIso) {
    filters.push(Prisma.sql`COALESCE(m."sentAt", m."receivedAt", m."createdAt") >= ${new Date(input.sinceIso)}`);
  }
  const where = Prisma.join(filters, ' AND ');
  const hasQuery = Boolean(input.query.trim());
  const rankExpr = hasQuery
    ? Prisma.sql`ts_rank(to_tsvector('english', COALESCE(m."subject", '') || ' ' || m."body"), websearch_to_tsquery('english', ${input.query}))`
    : Prisma.sql`0::float4`;
  const orderExpr = hasQuery
    ? Prisma.sql`"lexicalRank" DESC, COALESCE(m."sentAt", m."receivedAt", m."createdAt") DESC`
    : Prisma.sql`COALESCE(m."sentAt", m."receivedAt", m."createdAt") DESC`;

  return prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    SELECT m."id" AS "id",
           m."threadId" AS "threadId",
           m."subject" AS "subject",
           m."body" AS "body",
           m."channel" AS "channel",
           t."entityType" AS "scopeType",
           t."entityId" AS "scopeId",
           ${rankExpr} AS "lexicalRank",
           COALESCE(m."sentAt", m."receivedAt", m."createdAt") AS "sentAt"
    FROM "communication_messages" m
    JOIN "communication_threads" t ON t."id" = m."threadId"
    WHERE ${where}
    ORDER BY ${orderExpr}
    LIMIT ${input.limit}
  `);
}

function rrfScores(rankedIds: string[]): Map<string, number> {
  const out = new Map<string, number>();
  rankedIds.forEach((id, idx) => {
    out.set(id, 1 / (RRF_K0 + idx + 1));
  });
  return out;
}

export async function hybridRetrieve(input: HybridRetrieveInput): Promise<HybridRetrieveResult> {
  const k = input.k ?? DEFAULT_K;
  const channelsUsed: HybridRetrieveResult['channelsUsed'] = ['metadata'];

  let primary: CandidateRow[] = [];
  try {
    primary = await fetchCandidates({
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      query: input.query,
      channels: input.channels,
      sinceIso: input.sinceIso,
      limit: MAX_CANDIDATES,
    });
    channelsUsed.push('lexical');
  } catch (err) {
    logger.warn({ err, scopeId: input.scopeId }, 'org2vec.retriever.lexical_failed');
  }

  // Graph channel: a representative recent message from each neighbor scope.
  const neighborIds = (input.graphNeighborIds ?? []).filter(Boolean).slice(0, 5);
  let graphRows: CandidateRow[] = [];
  if (neighborIds.length > 0) {
    try {
      const perNeighbor = await Promise.all(
        neighborIds.map((nid) =>
          fetchCandidates({ scopeType: input.scopeType, scopeId: nid, query: input.query, limit: 1 }),
        ),
      );
      graphRows = perNeighbor.flat();
      if (graphRows.length > 0) channelsUsed.push('graph');
    } catch (err) {
      logger.warn({ err }, 'org2vec.retriever.graph_failed');
    }
  }

  const byId = new Map<string, CandidateRow>();
  for (const row of [...primary, ...graphRows]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  const candidates = Array.from(byId.values());
  if (candidates.length === 0) {
    return { passages: [], channelsUsed, embedderName: null };
  }

  // Lexical ranked list (already ordered by lexicalRank from SQL).
  const lexicalRanked = [...primary].map((r) => r.id);

  // Vector channel.
  let vectorRanked: string[] = [];
  let embedderName: string | null = null;
  if (input.query.trim()) {
    try {
      const embedder = getEmbedder();
      embedderName = embedder.name;
      const queryVec = await embedder.embed(input.query);
      const scored = await Promise.all(
        candidates.map(async (row) => ({
          id: row.id,
          sim: cosine(queryVec, await embedder.embed(`${row.subject ?? ''} ${row.body}`.slice(0, 2000))),
        })),
      );
      vectorRanked = scored.sort((a, b) => b.sim - a.sim).map((s) => s.id);
      if (!channelsUsed.includes('vector')) channelsUsed.push('vector');
    } catch (err) {
      logger.warn({ err }, 'org2vec.retriever.vector_failed');
    }
  }

  const graphRanked = graphRows.map((r) => r.id);

  const lexicalScores = rrfScores(lexicalRanked);
  const vectorScores = rrfScores(vectorRanked);
  const graphScores = rrfScores(graphRanked);

  const passages: RetrievedPassage[] = candidates
    .map((row) => {
      const lexical = lexicalScores.get(row.id);
      const vector = vectorScores.get(row.id);
      const graph = graphScores.get(row.id);
      const fused = (lexical ?? 0) + (vector ?? 0) + (graph ?? 0);
      return {
        messageId: row.id,
        threadId: row.threadId,
        subject: row.subject,
        snippet: snippetOf(row.body),
        channel: row.channel,
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        scores: { lexical, vector, graph, fused },
        citation: { threadId: row.threadId, messageId: row.id, quote: snippetOf(row.body, 200) },
      };
    })
    .sort((a, b) => b.scores.fused - a.scores.fused)
    .slice(0, k);

  return { passages, channelsUsed, embedderName };
}
