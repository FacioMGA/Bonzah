/**
 * graphEdge — typed Org2Vec graph-edge metadata (ADR-0044).
 *
 * Every edge written to the Org2Vec graph (claims mailgraph + submission
 * graph) carries this metadata block so the platform can distinguish
 * DETERMINISTIC facts (identifier matches, human review) from
 * PROBABILISTIC inferences (regex heuristics, LLM extraction).
 *
 * The reflex gates (`reflexGates.ts`) and the precedence resolver only
 * ever fire on TRUSTED edges — see `isTrustedEdge`.  This is the
 * patent-relevant distinction: "we are not building generic GraphRAG".
 *
 * Pure domain module — no IO, no prisma, no neo4j import.
 */

export type EdgeClass = 'DETERMINISTIC' | 'PROBABILISTIC';

export type EdgeCreatedBy =
  | 'identifier_match'
  | 'regex'
  | 'llm_extraction'
  | 'manual_review';

export type EdgeSourceType =
  | 'email_message'
  | 'email_thread'
  | 'document'
  | 'canonical_record'
  | 'rule'
  | 'endorsement'
  | 'reserve'
  | 'manual';

export interface GraphEdgeMetadata {
  edgeClass: EdgeClass;
  /** 0..1 — calibrated confidence in the edge. */
  confidence: number;
  sourceType: EdgeSourceType;
  /** Stable id of the evidence the edge was derived from. */
  sourceId: string;
  /** Optional verbatim span / quote backing the edge. */
  sourceSpan?: string;
  createdBy: EdgeCreatedBy;
  /** ISO timestamp. */
  createdAt: string;
}

/** Creators whose edges are inherently trusted (deterministic). */
const DETERMINISTIC_CREATORS: ReadonlySet<EdgeCreatedBy> = new Set<EdgeCreatedBy>([
  'identifier_match',
  'manual_review',
]);

/** Default confidence per creator when the caller does not supply one. */
const DEFAULT_CONFIDENCE: Record<EdgeCreatedBy, number> = {
  identifier_match: 1,
  manual_review: 1,
  regex: 0.7,
  llm_extraction: 0.6,
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** A regex/LLM edge that a human confirmed becomes DETERMINISTIC. */
export function classifyEdge(createdBy: EdgeCreatedBy): EdgeClass {
  return DETERMINISTIC_CREATORS.has(createdBy) ? 'DETERMINISTIC' : 'PROBABILISTIC';
}

export interface BuildEdgeMetadataInput {
  createdBy: EdgeCreatedBy;
  sourceType: EdgeSourceType;
  sourceId: string;
  sourceSpan?: string;
  confidence?: number;
  /** Override the derived class (e.g. a human-validated LLM edge). */
  edgeClass?: EdgeClass;
  createdAt?: string;
}

export function buildEdgeMetadata(input: BuildEdgeMetadataInput): GraphEdgeMetadata {
  const edgeClass = input.edgeClass ?? classifyEdge(input.createdBy);
  const confidence = clamp01(input.confidence ?? DEFAULT_CONFIDENCE[input.createdBy]);
  return {
    edgeClass,
    confidence,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceSpan: input.sourceSpan,
    createdBy: input.createdBy,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Gate-eligibility test.  Reflex gates and rule matches may ONLY fire on
 * trusted edges: deterministic class AND confidence at/above the floor.
 * A high-confidence PROBABILISTIC edge is still NOT trusted — it must be
 * validated (manual_review) first.
 */
export function isTrustedEdge(
  meta: Pick<GraphEdgeMetadata, 'edgeClass' | 'confidence'>,
  minConfidence = 0.5,
): boolean {
  return meta.edgeClass === 'DETERMINISTIC' && meta.confidence >= minConfidence;
}

/** Flatten metadata into primitive Cypher relationship properties. */
export function toCypherEdgeProps(meta: GraphEdgeMetadata): Record<string, string | number> {
  const props: Record<string, string | number> = {
    edgeClass: meta.edgeClass,
    confidence: meta.confidence,
    sourceType: meta.sourceType,
    sourceId: meta.sourceId,
    createdBy: meta.createdBy,
    createdAt: meta.createdAt,
  };
  if (meta.sourceSpan) props.sourceSpan = meta.sourceSpan;
  return props;
}
