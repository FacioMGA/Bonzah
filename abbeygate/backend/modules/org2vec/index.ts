/**
 * org2vec — shared Org2Vec engine (ADR-0044).
 *
 * Product-neutral, cross-cutting pieces consumed by the claims mailgraph
 * and the underwriting submission-memory paths:
 *   - graph edge metadata (DETERMINISTIC vs PROBABILISTIC),
 *   - the deterministic precedence resolver,
 *   - the deterministic reflex gates,
 *   - shared memory-object base shapes,
 *   - business-object resolution from ingested-email identifiers,
 *   - hybrid retrieval (lexical + vector + metadata + graph).
 *
 * This is the public surface of the module. Other modules import from
 * here; never reach into `domain/` / `app/` / `infra/` directly.
 */

// This barrel intentionally exports only the names other modules consume.
// Pure-domain helpers/types used purely within `org2vec` (and by its own
// unit tests) are imported from their `domain/` files directly, so they do
// not appear here — keeping the public surface minimal and dead-code clean.

// Domain (pure)
export { buildEdgeMetadata, toCypherEdgeProps } from './domain/graphEdge.js';

export { resolvePrecedence, type PrecedenceCandidate } from './domain/precedenceResolver.js';

export type { GateDecision, ReflexGateInput, EndorsementConditionItem } from './domain/reflexGates.js';

export { deriveConfidence } from './domain/memoryObject.js';

// App
export { runReflexGates, gatesToInsufficientEvidenceFlags } from './app/runReflexGates.js';

export { resolveBusinessObject, type ResolvedScope } from './app/resolveBusinessObject.js';

export { answerWithCitations, type AskResult } from './app/answerWithCitations.js';
