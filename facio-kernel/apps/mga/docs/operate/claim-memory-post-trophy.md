---
title: Operate — Claim Memory post-trophy follow-ups
audience: operator
status: living
owner: platform-eng
reviewed: 2026-05-29
binding: false
---

# Post-trophy follow-ups — Claim Memory V1 → V2

V1 trophy is shipped. The items below are deferred per ADR-0041 §14 and
this file tracks the trigger conditions for each.

## Operational (no code change required)
- AuraDB provisioning — set `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` in Key Vault; the worker reads them lazily.
- First nightly Neo4j dump — verify the CronJob lands a `.dump.gz` + `.sha256` in `neo4j-dumps/env=…/`.
- Weekly restore smoke test exec — once executed, link the metric in the next ADR amendment.
- Peter Sheppard demo recording — show MCP tools + co-pilot card end-to-end.

## V2 add-ons (own ADR each)
| Trigger | Add |
|---|---|
| Customer-facing draft replies needed | `operator.preview_claim_reply` (uses ADR-0039 confirmation-token pattern) |
| A second surface needs RAG (binder Q&A, document chunks) | Promote shared shapes to `backend/modules/knowledge/`; introduce `KnowledgeChunk` + per-surface adapter |
| `claim_memory_projections` exceeds ~5M rows | Per-tenant LIST partition (mirror behavior_events) |
| LLM extraction cost > $50/tenant/month | Per-tenant embedding/extraction cost dashboard |
| Edit-on-projection support needed | CDC outbox re-embed-on-edit |
| Cross-tenant similarity demand (book-level intelligence) | Out of scope; requires tenancy contract amendment |

## Cross-refs
[ADR-0041](../architecture/decisions/ADR-0041-claim-memory-and-neo4j-enrichment.md) ·
[`docs/operate/claim-memory.md`](./claim-memory.md)
