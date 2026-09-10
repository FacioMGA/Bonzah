---
title: ADR-0044 Org2Vec demo — Outlook ingestion, shared engine, submission memory
audience: architect
status: living
owner: platform-eng
reviewed: 2026-06-11
binding: true
---

# ADR-0044: Org2Vec demo extension — Outlook → graph-backed memory → cited insight panel

## Status

Accepted.

## Context

[ADR-0041](./ADR-0041-claim-memory-and-neo4j-enrichment.md) locked the claims "mailgraph" backbone: a Postgres `ClaimMemoryProjection`, a Neo4j enrichment graph rebuilt by the `CLAIM_MEMORY.REFRESH` worker, and a Postgres-only co-pilot card. It proves the claims wedge but stops short of the full Org2Vec thesis — *"standard RAG retrieves chunks; Org2Vec reconstructs operational reality"* — and is claims-only.

This ADR extends that backbone (it does not duplicate it) to deliver a demo of the complete loop on two surfaces:

```
Outlook thread → EmailIngested → resolve business object → scoped memory refresh
  → graph upsert (typed edges) → reflex gates + precedence → hybrid retrieval
  → Postgres projection (memory object + citations) → cited insight panel → human action
```

Claims is the polished hero path; underwriting is a thinner second panel on the same shared engine. Infrastructure is simplified for the demo, but the product thesis is preserved end-to-end.

## Decision

### 1. Shared, product-neutral engine: `backend/modules/org2vec`

A new module owns the cross-cutting engine so claims and underwriting share one spine, with strict `http → app → domain → infra` layering and no product branching:

- `domain/graphEdge.ts` — typed edge metadata required on every relationship: `edgeClass: 'DETERMINISTIC' | 'PROBABILISTIC'`, `confidence`, `sourceType`, `sourceId`, `sourceSpan?`, `createdBy: 'identifier_match' | 'regex' | 'llm_extraction' | 'manual_review'`, `createdAt`.
- `domain/precedenceResolver.ts` — pure resolver over `(sourceClass, effectiveDate, jurisdiction, product, authorityLevel, versionStatus)` → winning source. Drives the formal-policy-vs-email-endorsement conflict.
- `domain/reflexGates.ts` — deterministic gates (authority threshold, missing required evidence, endorsement condition, insufficient-evidence fallback). Gates fire ONLY on trusted (`DETERMINISTIC`/validated) inputs; the LLM may explain after, never decide.
- `domain/memoryObject.ts` — shared base (`summary`, `citations`, `confidence`, `insufficientEvidenceFlags`, `lastRefreshedAt`) reused by claim + submission objects, plus `deriveConfidence`.
- `app/resolveBusinessObject.ts` (claim-first, submission-second, else unresolved-but-visible), `app/runReflexGates.ts`, `app/answerWithCitations.ts` (read-only Q&A).
- `infra/hybridRetriever.ts` — RRF fusion of lexical (Postgres FTS/BM25), semantic (reuses `backend/platform/behavior/embedding`), metadata, and graph channels. The graph channel is supplied as pre-resolved neighbour IDs; the retriever itself imports no Neo4j driver, preserving the ADR-0041 guards.

### 2. One `EmailIngested` ingestion contract, swappable adapters

`backend/modules/communications` gains a normalized `NormalizedOutlookMessage` shape produced by every adapter, so the pipeline never branches on source:

- `infra/ingest/sampleInboxAdapter.ts` — bundled demo threads (zero OAuth).
- `infra/ingest/uploadAdapter.ts` — `.eml` / `.json` upload.
- `infra/ingest/outlookGraphAdapter.ts` — live Microsoft Graph, behind `ORG2VEC_GRAPH_ENABLED` (off by default).

`app/ingestEmails.ts` groups messages by conversation, resolves the business object, persists canonical `CommunicationThread` / `CommunicationMessage` rows (idempotent on provider message id), and emits one `COMM.EMAIL_INGESTED` domain event per conversation via the outbox. BO route: `POST /api/org2vec/ingest` (+ `GET /api/org2vec/ingest/sample`). Deterministic `linkHints` set by the source win over regex extraction.

### 3. Event-driven, scoped re-projection

`COMM.EMAIL_INGESTED` worker handler restores the operating tenant from the event payload (`runWithOperatingTenantById`), logs an `Org2VecIngestionEvent` audit row, and enqueues **only** the resolved scope's refresh — `CLAIM_MEMORY.REFRESH` (existing) or the new `SUBMISSION_MEMORY.REFRESH`. Unresolved emails are logged and remain visible; no global rebuild. ADR-0041's debounce/idempotency/degrade behaviour is preserved.

### 4. Claims graph + gates (hero path)

`upsertClaimGraph.cypher` is extended to write typed edge metadata (§1) on every relationship and to add `Document`, `Rule`, `Endorsement`, `MemoryObject` nodes and `HAS_MEMORY`, `HAS_DOCUMENT`, `HAS_MISSING_EVIDENCE`, `MATCHES_RULE`, `TRIGGERS_GATE` edges — all tenant-scoped and `MERGE`-idempotent. `buildClaimMemoryObject` replaces the static authority-threshold heuristic with `runReflexGates` + `resolvePrecedence` + `deriveConfidence`, and enriches `ClaimMemoryObject` with `summary`, `endorsementChecks`, `draftReply`, `citations`, `confidence`, `insufficientEvidenceFlags`, `gateDecisions` (all optional + back-compatible).

### 5. Submission memory (underwriting, thinner)

Two new tenant-scoped Postgres tables mirror the claims pattern with RLS (`op_tenant_isolation`) and registration in `TENANT_SCOPED_MODELS`:

- `submission_memory_projections` — one row per submission (keyed on `Policy.id`), same projection lifecycle as `claim_memory_projections`. Citations stay JSON-in-projection (deliberate demo simplification — no separate citation table yet).
- `org2vec_ingestion_events` — audit log of each ingested conversation and its resolved scope.

A `SubmissionMemoryObject` (timeline, missingInformation, underwritingFlags, endorsementChecks, referralTriggers, recommendedActions, similarSubmissions, draftBrokerRequest, + shared base) is built by the `SUBMISSION_MEMORY.REFRESH` worker. HTTP: `GET/POST /api/policies/:id/submission-memory` and `POST /api/policies/:id/submission-memory/ask`.

### 6. Cited insight panels + read-only ask

The claims co-pilot card is promoted to a full insight panel (summary, decision gates, endorsement checks, citations, editable **never-auto-sent** draft reply, and an ask box). A submission-variant panel mounts in the underwriting tab on the same engine. The ask endpoints (`POST /api/claims/:id/memory/ask`, submission equivalent) are retrieval-grounded and read-only: the answer is always cited, and the LLM cannot mutate state or decide a gate. With no LLM key configured, the ask falls back to an extractive, still-cited answer.

## Forbidden

- Duplicating the claims memory spine for underwriting — both surfaces use `backend/modules/org2vec`.
- Letting the LLM decide a reflex gate or mutate state. Gates fire on trusted edges only; the LLM explains/answers after.
- Auto-sending any drafted reply or broker request. Human approves/edits/escalates inside the existing workflow (deck Stage 05).
- Reading Neo4j on a request-serving path, importing `neo4j-driver` outside `backend/platform/graph/neo4jClient.ts`, or running raw Cypher from `arguments` (ADR-0041 guards still bind).
- Persisting an answer or memory assertion without a citation pointer.
- Blocking any claim/policy/quote lifecycle action on Neo4j, the LLM, or the ingestion worker being down.

## Consequences

- One new shared module (`backend/modules/org2vec`) + new ingestion adapters in `communications`.
- Two new Prisma tables (`submission_memory_projections`, `org2vec_ingestion_events`) + one migration with the standard RLS block; one new `SUBMISSION_MEMORY.REFRESH` handler and one `COMM.EMAIL_INGESTED` handler.
- `ClaimMemoryObject` gains optional, back-compatible enrichment fields; the claims Cypher gains typed edges + four node labels.
- Neo4j added to local Docker compose for a self-contained demo; production posture (AuraDB / `org2vec` namespace StatefulSet) is unchanged from ADR-0041.

## Risks / simplifications (infrastructure only — thesis preserved)

- Live Graph OAuth is deferred behind `ORG2VEC_GRAPH_ENABLED`; the demo uses sample/upload through the same `EmailIngested` contract.
- Citations stay JSON-in-projection (no separate `Org2VecCitation` table yet).
- The underwriting panel is a thinner reuse of the claims engine.

## Links

- Parent: [ADR-0041](./ADR-0041-claim-memory-and-neo4j-enrichment.md) — claims memory projection + Neo4j enrichment backbone this ADR extends.
- MCP surface: [ADR-0036](./ADR-0036-config-mcp-module-and-tool-surface.md) — operator tool registry conventions.
- Tenancy: [ADR-0009](./ADR-0009-shared-schema-row-level-tenancy.md), [ADR-0019](./ADR-0019-tenancy-and-authority-fail-closed.md) — RLS posture inherited by the new projections.
- Canonical ownership: [`docs/architecture/contracts/canonical-ownership.md`](../contracts/canonical-ownership.md) — claims/policy truth stays in Postgres; projections + Neo4j are derived.
- Reference: [`experiments/org2vec-mailgraph/`](../../../experiments/org2vec-mailgraph/) — algorithmic prior art and the demo corpus (CY-MTR-017 / €25k DCA authority gate).
