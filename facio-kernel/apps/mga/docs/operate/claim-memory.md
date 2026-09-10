---
title: Operate — Claim Memory (ADR-0041)
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-28
binding: true
---

# Operate — Claim Memory + MailGraph

Async refresh pipeline rebuilding `claim_memory_projections` (Postgres truth) and optionally a Neo4j graph (enrichment).
Critical-path safe: Claim Workspace reads the projection only; Neo4j down ⇒ stale banner, no lifecycle action blocked.

## Triggers
| Trigger | How it lands |
|---|---|
| Inbound email on a CLAIM thread | `communicationsService.createMessage` hook → outbox → `CLAIM_MEMORY.REFRESH` BullMQ job |
| Manual refresh (BO) | `POST /api/claims/:id/memory/refresh` |
| MCP tool | `operator.refresh_claim_memory` |

Idempotent + 60s debounce. Job key = `claim:<claimId>`.

## Env vars
| Var | Effect when unset |
|---|---|
| `NEO4J_URI` (+ `NEO4J_USER` / `NEO4J_PASSWORD` / `NEO4J_DATABASE`) | enrichment disabled — projection still written |
| `OPENAI_API_KEY` (+ `CLAIM_MEMORY_LLM_MODEL`, `CLAIM_MEMORY_LLM_TIMEOUT_MS`) | LLM extraction disabled — regex still runs |

## Failure modes
| Component down | Effect |
|---|---|
| Neo4j | `refreshStatus='failed'`, `refreshError='neo4j_unavailable'`; previous `similarClaims` preserved; stale banner in UI |
| LLM | deterministic regex events still land; `ThreadAnalysis.partial.llmFailed=true` |
| `org2vec-worker` | Refresh jobs queue in BullMQ `dataSync`; existing projection serves every read |
| Postgres `claim_memory_projections` | Drop + rebuild — pipeline is idempotent per claim |

## Diagnostics
- Projection: `SELECT "refreshStatus", "refreshError", "lastRefreshedAt" FROM claim_memory_projections WHERE "claimId"=…;`
- Graph health: `GET /healthz` (component `graph`).
- Audit: `SELECT * FROM audit_actions WHERE "actionName" LIKE 'CLAIM_MEMORY.%' ORDER BY "createdAt" DESC LIMIT 20;`

## Backup + restore (ADR-0041 §10)
The deployed backup manifest schedules the Neo4j dump at 02:30 UTC →
`neo4j-dumps/env=<env>/tenant=<slug>/year/month/day/`.
There is no scheduled claim-memory backfill or restore smoke job yet. Treat restore validation as
an operator-run recovery procedure until its CronJob and canary are implemented.
Manifests: `infrastructure/k8s/org2vec/backup/`.

## Guards (CI)
`neo4j-driver-only-in-platform-graph`, `claim-workspace-no-direct-neo4j`, `no-raw-cypher-mcp-tool`,
`cypher-files-tenant-scoped`, `neo4j-tenant-id-on-every-query`, `neo4j-no-app-pod-coupling`.

## Cross-refs
[ADR-0041](../architecture/decisions/ADR-0041-claim-memory-and-neo4j-enrichment.md) ·
[`canonical-ownership.md`](../architecture/contracts/canonical-ownership.md) ·
[`backend/modules/claims/app/mailgraph/`](../../backend/modules/claims/app/mailgraph/) ·
[`infrastructure/k8s/org2vec/`](../../infrastructure/k8s/org2vec/)
