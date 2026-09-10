---
title: ADR-0041 Claim Memory + Neo4j as enrichment service
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-28
binding: true
---

# ADR-0041: Claim Memory projection + Neo4j MailGraph as off-critical-path enrichment

## Status

Accepted.

## Context

Claims handlers in Abbeygate-CY work across `Claim`, `ClaimEvent`, `ClaimReserveTransaction`, `ClaimCounterparty`, `Policy`, `PolicyHolder`, and large email threads on `CommunicationThread` / `CommunicationMessage` (linked by `entityType='CLAIM' + entityId=claim.id`). The Claim Workspace renders timelines, financial snapshots, and required-doc lists from those tables (see [`ClaimSummaryTab.tsx`](../../../frontend/src/modules/claims/case/views/ClaimSummaryTab.tsx)). Today there is no consolidated "what does this claim actually look like right now" memory that a handler — or an MCP-driven assistant — can read in one round trip.

The first product proof for this is "similar claims + missing-doc patterns + cited email evidence" rendered in the Claim Workspace co-pilot card. The experiment in [`experiments/org2vec-mailgraph/`](../../../experiments/org2vec-mailgraph/) proves that a small graph (claim, thread, message, repairer, broker, vehicle, event) plus three named Cypher queries produces those signals cheaply.

We considered a generic pgvector-based knowledge platform (`KnowledgeChunk` + per-tenant LIST partition + HNSW + RAG synthesis tools) as the foundation. That was rejected as a 12-week middle stage that delays the customer-visible trophy. The architecture instead flips to **Neo4j-first, Postgres-safe**: Neo4j carries graph signals, Postgres caches the projection the UI actually reads, and the critical path stays on Postgres.

This ADR locks the architecture so V1 can be built in three weeks without optionality.

## Decision

### 1. `ClaimMemoryProjection` is the operational truth

A new tenant-scoped Postgres table `claim_memory_projections` (one row per claim) caches everything the Claim Workspace + MCP tools render: structured `memoryObject` (timeline, missingInformation, authorityFlags, liabilityPositions, recommendedActions), `summary` + `summaryCitations`, `similarClaims`, `graphSignals`, and a `refreshStatus` lifecycle field. Schema: see Prisma `ClaimMemoryProjection` model, `@@map("claim_memory_projections")`, `@@unique([operatingTenantId, claimId])`.

Reads from the UI and from V1 MCP tools go to this projection ONLY. They never call Neo4j and never call the LLM synchronously.

The projection follows the same tenant-scoped + RLS pattern as `ClaimProjectionSnapshot`: `operatingTenantId` column, registered in `TENANT_SCOPED_MODELS` ([`backend/platform/db/tenantExtension.ts`](../../../backend/platform/db/tenantExtension.ts)), and a Postgres RLS policy `op_tenant_isolation` keyed on `current_setting('app.operating_tenant_id', true)` per [ADR-0009](./ADR-0009-shared-schema-row-level-tenancy.md) / [ADR-0019](./ADR-0019-tenancy-and-authority-fail-closed.md).

### 2. Neo4j is derived enrichment, off the critical path

Neo4j stores a small graph (≤10 node labels, ≤10 edge types) that is **rebuilt** from canonical Postgres data by the refresh worker. It is never a source of truth. Every node carries a `tenantId` property; every Cypher query carries `$tenantId` as a bind parameter (never interpolated) and references it in a `WHERE` clause.

Failure rule: if Neo4j is unreachable, the worker writes the projection with `refreshStatus='failed'` + `refreshError='neo4j_unavailable'`, keeps the previous `similarClaims` / `graphSignals`, and the UI renders a stale banner. No claim lifecycle action — opening a claim, sending a quote, issuing a policy, payment, reserve change — is ever blocked by Neo4j being down.

Neo4j is deployed as **AuraDB** (managed; default) in staging/prod, OR as a single-instance `StatefulSet` in a dedicated AKS `org2vec` namespace (dev/demo only). Neo4j is **never** co-deployed in the same Pod/Deployment as `abbeygate-api` or `abbeygate-worker` (separate namespace, separate Deployment, separate SLO).

### 3. Async refresh worker is the only writer

A new BullMQ handler `CLAIM_MEMORY.REFRESH` (under [`backend/workers/handlers/`](../../../backend/workers/handlers/)) is the sole writer to `claim_memory_projections` and the sole writer to Neo4j. It runs the 14-step pipeline: resolve claim linkage → load canonical context → normalise messages → redact PII → extract events+entities (deterministic + LLM with strict Zod schema) → ThreadAnalysis → aggregate into `ClaimMemoryObject` → upsert Neo4j → run named similarity queries → write projection → audit.

Triggers (three):

- New `CommunicationMessage` insert on a `CommunicationThread` whose `entityType='CLAIM'` → enqueue.
- Manual refresh: `POST /api/claims/:id/memory/refresh` from the BO, OR `operator.refresh_claim_memory` from MCP.
- Nightly backfill CronJob enqueues refresh for any open claim where `lastRefreshedAt > 24h`.

The job is **debounced + idempotent**: BullMQ `jobId = claim:<claimId>` plus a 60-second debounce window; ten emails in one thread = one refresh, not ten. The pipeline itself is replay-safe: deterministic per claim, Neo4j upserts are `MERGE`-only, projection write is a single UPSERT.

### 4. PII redaction before any LLM or embedding call

Step 4 of the pipeline redacts names → `[PERSON_##]`, addresses → `[ADDRESS_##]`, vehicle regs → `[VEHICLE_REG_##]`, etc. before any payload leaves the worker. The redaction map is held in worker memory for the duration of the job so the citation verifier can map redacted spans back to original messages for authorised UI display. Models never see raw PII; only the citation (`{ threadId, messageId, quote }`) is persisted, and the original message is fetched through `tenantScopedPrisma` with normal claim-view permissions when rendered.

### 5. Hybrid extraction — deterministic + LLM with strict schema

Step 5 runs deterministic regex first (money amounts, claim numbers, vehicle regs, sender domains, timestamps, attachment types). Then it runs an LLM call with a strict Zod-validated JSON response schema that returns `events[]` (`estimate_received`, `doc_request`, `liability_position`, `escalation`, …) and `entities[]` (`repairer`, `broker`, `vehicle`). Every event and entity carries a `citation: { threadId, messageId, quote }`. Citations that fail the verifier (the quote substring does not appear in the cited message) are **flagged** in the projection, not silently dropped — the UI surfaces `citation_warning: true` on affected rows.

If the LLM call fails or the response fails Zod validation, the deterministic events still land in the projection and the AI-derived sections render with a partial-extraction warning.

### 6. MCP surface — four read-class tools; no raw Cypher; no synchronous Neo4j

V1 ships four operator MCP tools (per [ADR-0036](./ADR-0036-config-mcp-module-and-tool-surface.md) tool registry conventions). All are `auditClass: 'read'` and require `operator.read`. None of them imports the Neo4j driver. None of them executes a Cypher string from `arguments`.

| Wire name | Reads from | Notes |
|---|---|---|
| `operator.get_claim_memory` | Postgres projection | Returns the cached row. |
| `operator.refresh_claim_memory` | Postgres + BullMQ | Enqueues `CLAIM_MEMORY.REFRESH` for the claim; idempotent via BullMQ `jobId`; returns `action_id` per `OperatorEnvelope`. |
| `operator.find_similar_claims` | Postgres projection | Reads `similarClaims`; if stale, auto-enqueues refresh and returns the cached data with `staleness_warning: true`. |
| `operator.analyze_claim_memory` | Postgres + completer | LLM synthesis over projection + similar-claims; runs the citation verifier on every claim it cites; returns `citation_warning: true` for any uncited claim. |

A future `operator.preview_claim_reply` (preview-then-confirm via [ADR-0039](./ADR-0039-operator-mcp-v2-mutation-governance.md) confirmation tokens) is explicitly out of scope for V1.

### 7. Six new CHAMPS guards

| Guard | Pins |
|---|---|
| `check-neo4j-driver-only-in-platform-graph` | `neo4j-driver` npm dep may be imported ONLY from [`backend/platform/graph/neo4jClient.ts`](../../../backend/platform/graph/). |
| `check-claim-workspace-no-direct-neo4j` | `claim_memory_projections` is the ONLY read source for Claim Workspace + V1 MCP tools. No `import.*neo4jClient` outside `backend/modules/claims/infra/mailgraph/` and `backend/workers/handlers/`. |
| `check-no-raw-cypher-mcp-tool` | No tool descriptor with `family: 'operator'` may execute a Cypher string sourced from its `arguments`. |
| `check-cypher-files-tenant-scoped` | Every `.cypher` file under `backend/modules/claims/infra/mailgraph/cypher/` MUST reference `$tenantId` in a `WHERE` clause. |
| `check-neo4j-tenant-id-on-every-query` | The TS repository function executing each named Cypher MUST pass `tenantId` as a bind parameter — not interpolated. |
| `check-neo4j-no-app-pod-coupling` | Neo4j Helm/manifest values MUST place the StatefulSet in `namespace: org2vec`, never alongside `abbeygate-api` / `abbeygate-worker`. |

All six are added to `package.json` as `guard:*` scripts and wired into `gate:ci` per existing convention ([`tools/quality/ci/run-quality-gate.mjs`](../../../tools/quality/ci/run-quality-gate.mjs)).

### 8. Audit vocabulary

`AuditEventType` ([`backend/platform/audit/logger.ts`](../../../backend/platform/audit/logger.ts)) gains:

```
CLAIM_MEMORY.REFRESHED          CLAIM_MEMORY.REFRESH_FAILED
CLAIM_MEMORY.REFRESH_ENQUEUED   CLAIM_MEMORY.CITATION_WARNING
```

Entity binding: `entityType: 'CLAIM'`, `entityId: <claimId>`. Actor binding: `actorType: 'SYSTEM'`, `actorId: 'claim-memory-worker'` for worker-driven rows; `actorType: 'USER'`, `actorId: <userId>` for manual BO refresh; existing MCP funnel ([`recordMcpAudit.ts`](../../../backend/modules/mcp/app/recordMcpAudit.ts)) covers tool-call audit via the `OPERATOR.TOOL_CALLED.*` shape.

## Forbidden

- Importing `neo4j-driver` from anywhere other than `backend/platform/graph/neo4jClient.ts`.
- Reading from Neo4j on a request-serving HTTP path (Claim Workspace + V1 MCP tools) — projection only.
- Executing arbitrary Cypher passed via MCP `arguments` (`operator.run_cypher` / `operator.query_neo4j` are banned for V1 and forever).
- Returning `similarClaims` from a Cypher query that lacks `tenantId` in both `WHERE` and bind parameters.
- Co-deploying Neo4j inside the `faciomga-prod` / `abbeygate-api` Pod or Deployment (separate `org2vec` namespace mandatory).
- Persisting raw PII in any LLM-bound payload, redaction map, vector store, or Neo4j node property. Citations carry pointers, not content.
- Treating a missing or stale projection row as a hard failure on the UI critical path (must degrade gracefully via `refreshStatus`).
- Bypassing the refresh worker to write `claim_memory_projections` directly from a route handler.

## Consequences

- Three-week trophy is unblocked: Week 1 ships the projection + co-pilot card from structured data + regex; Week 2 adds Neo4j infra + LLM extraction + similarity; Week 3 ships the four MCP tools + chaos-test hardening + backup CronJob.
- One new Prisma table (`claim_memory_projections`) + one Prisma migration with the standard RLS policy block.
- One new sub-module under [`backend/modules/claims/`](../../../backend/modules/claims/) (`domain/mailgraph/`, `app/mailgraph/`, `infra/mailgraph/`, `infra/mailgraph/cypher/`).
- One new BullMQ handler (`CLAIM_MEMORY.REFRESH`) + one CronJob worker for nightly backfill.
- One new platform module ([`backend/platform/graph/`](../../../backend/platform/graph/)) housing `neo4jClient.ts` (sole importer of the driver) and `graphHealth.ts`.
- Four new operator MCP tool descriptors registered in [`registerOperatorTools.ts`](../../../backend/modules/mcp/infra/registerOperatorTools.ts).
- Six new CHAMPS guards added to `package.json` and the `gate:ci` runner.
- Failure isolation between platforms: an outage in Neo4j, the LLM provider, or `org2vec-worker` is bounded to projection freshness; existing claims, policy, quote, payment, and binder flows remain unaffected.
- Auditable, citable AI surface in production: every assistant-rendered claim, missing doc, or similar-claim assertion ties back to a `CommunicationMessage` by ID — Lloyd's-aligned defensibility.

## Alternatives considered

- **Generic pgvector knowledge platform first (`KnowledgeChunk` + HNSW + per-tenant LIST partition + RAG tools).** Rejected as a 12-week middle stage that delays the customer-visible trophy. pgvector returns as a per-surface retrieval component (binder wording Q&A, document chunks, rule citations) when those surfaces are actually requested, not as a foundation.
- **Read Neo4j synchronously from MCP tools / Claim Workspace.** Rejected: an AuraDB outage or a 2-second Cypher query would block the Claims Desk. Projection cache decouples UI latency from graph health.
- **Single Neo4j embedded in the API pod.** Rejected: graph rebuild jobs starve API request latency; an OOM in the driver kills the API. Separate namespace + separate worker pool gives the platform a clean SLO boundary.
- **Generic `backend/modules/knowledge/` module from day one.** Rejected: there is no second consumer yet. Build the claims-specific module first; promote shared shapes to `knowledge/` only when a second surface (e.g., binder Q&A) needs them.
- **LLM-extracted facts written directly to Neo4j without a Postgres projection.** Rejected: violates the canonical-ownership contract — claims truth lives in `claims.*` Postgres tables; Neo4j is derivation. Round-trips via the projection keep the UI source-of-truth in Postgres.
- **No citation verifier (trust the LLM).** Rejected: Lloyd's MGA defensibility requires every cited fact to be verifiable; flag-and-return (not hard-fail) keeps the UI useful when the verifier disagrees but does not block delivery.

## Out of scope (deferred)

- `operator.preview_claim_reply` — draft outbound customer reply grounded in claim memory; preview-then-confirm via [ADR-0039](./ADR-0039-operator-mcp-v2-mutation-governance.md) confirmation-token pattern. Ships in V2.
- Generic `backend/modules/knowledge/` module + `KnowledgeChunk` Prisma table + per-tenant LIST partition + HNSW index. Returns when a second product surface needs it.
- `operator.search_knowledge`, `operator.get_knowledge_chunk`, `operator.ask_about_policy`, `operator.ask_about_claim` (broad RAG synthesis tools). Returns alongside the generic knowledge module.
- Vector-side embedding cost dashboard, CDC outbox re-embed-on-edit, cold-tier old partitions to Azure Blob. None needed at V1 scale (≤ hundreds of thousands of projection rows).
- Federated cross-tenant similarity ("show me similar claims across the Facio book"). Out of scope; tenant isolation in §2 is hard.
- Customer-tenant-owned Neo4j (BYO graph). Single Facio-operated graph per environment.

## Links

- Extended by: [ADR-0044](./ADR-0044-org2vec-demo-outlook-graph-memory.md) — Outlook ingestion, shared `org2vec` engine (typed edges, precedence, reflex gates, hybrid retrieval), submission memory, and cited insight panels.
- Parent: [ADR-0036](./ADR-0036-config-mcp-module-and-tool-surface.md) — MCP tool registry, `executeToolCall` funnel, `OperatorEnvelope`.
- Mutation governance: [ADR-0039](./ADR-0039-operator-mcp-v2-mutation-governance.md) — preview-then-confirm pattern reserved for the future `operator.preview_claim_reply`.
- Auth posture: [ADR-0040](./ADR-0040-mcp-oauth-2.1-resource-server.md) — V1 stays within the existing `operator.read` scope.
- Tenancy: [ADR-0009](./ADR-0009-shared-schema-row-level-tenancy.md), [ADR-0019](./ADR-0019-tenancy-and-authority-fail-closed.md) — RLS posture inherited by the new projection.
- Canonical ownership: [`docs/architecture/contracts/canonical-ownership.md`](../contracts/canonical-ownership.md) — claim lifecycle truth remains in `claims.*` Postgres; `ClaimMemoryProjection` is a derived projection; Neo4j is derived enrichment.
- Operate runbook: [`docs/operate/claim-memory.md`](../../operate/claim-memory.md) (added in Week 3) — refresh triggers, failure modes, backup/restore lifecycle.
- Reference: [`experiments/org2vec-mailgraph/`](../../../experiments/org2vec-mailgraph/) — algorithmic prior art for `ClaimMemoryObject`, citation verifier, similarity scoring. The production `org2vec-worker` is a fresh TS implementation.
