---
title: FacioMGA / Abbeygate Platform Strategic Audit (frozen)
status: archived
owner: platform-eng
binding: false
---

> **Frozen-on:** 2026-05-03
> **Replaced by:** Living architecture lives in [`docs/architecture/contracts/`](../../architecture/contracts/) and current ADRs in [`docs/architecture/decisions/`](../../architecture/decisions/). The strategic recommendations in this audit are tracked separately in product roadmap planning.
> **Reason:** Snapshot of the platform audit performed on 2026-04-25. Retained in full as historical evidence; no edits permitted.

# FacioMGA / Abbeygate Platform — Strategic Audit

*Date:* 2026-04-25
*Author:* Cowork audit pass (read-only static analysis of the working tree)
*Scope:* Architecture & code health, security & compliance posture, MGA domain coverage, with extra focus on data model / multi-tenancy and multi-product generalization. Output is a candid view of where the platform is strong, where it is fragile, and what it must change to credibly become "the world's best MGA platform" for specialty insurance.

---

## 1. Executive summary

Abbeygate (FacioMGA Gen 2) is, today, a **well-architected single-tenant Lloyd's coverholder platform** running one product (Motor) in production for one MGA (Abbeygate Cyprus / Portugal), with Home and Travel built and ready behind the same product contract. The codebase is unusually disciplined for its age: a written architectural manifesto (CHAMPS), 48 CI guard scripts that mechanically enforce module boundaries, an outbox-based event/projection pipeline, a typed declarative product manifest, and effectively zero `any` and only 5 TODO/FIXME markers across ~184k lines of source.

The headline takeaway is a tension between two truths:

1. The **internal engineering quality is materially above what most MGA platforms achieve.** The CHAMPS playbook, layer guards, write/read separation, outbox pattern, audit hash chain, and product contract are the right bones for a category-leading product.
2. The **product surface area is narrower than the ambition.** It is a Motor MGA system that has *just begun* to abstract product-shape. Several capabilities a top-tier MGA platform must have — true multi-MGA tenancy, a configurable rating engine, treaty/facultative reinsurance, ledger/GL integration, claims reserving discipline, broker portal, enterprise SSO, embedded distribution APIs — are either absent, stubbed, or intentionally deferred.

The path to "best in the world" is therefore not *fix what's broken* — most of what exists is correct. It is *industrialize what's there into a multi-tenant product platform*, and *fill the missing 40% of the MGA surface area*. A credible 18-month plan is in §7.

---

## 2. Inventory

| Item | Value |
|---|---|
| Languages | TypeScript (primary), some `.mjs` tooling |
| Backend | Node + Express, Prisma ORM on PostgreSQL (with `pgvector`), in-process workers via Outbox + advisory locks |
| Frontend | React + Vite, Tailwind, three build surfaces (`public`, `client`, `bo`) |
| Datastore | PostgreSQL (Azure), Redis (light metadata cache, see ADR-0002) |
| Infra | Docker, Helm chart for AKS (api + worker deployments, KEDA scaling, Key Vault CSI) |
| CI | GitHub Actions: PR quality gate, reusable quality gate, CodeQL, AKS deploy, scheduled BDX rollout, DB reset/seed |
| LOC (excluding `node_modules`/`dist`) | ~184,000 lines across ~1,455 TS/TSX files |
| Test files | 216 (unit + e2e journeys + load) |
| `any` types in product code | 0 (actively ratcheted) |
| TODO/FIXME markers | 5 |
| Prisma models | 79 |
| Backend modules | 21 |
| Built products | Motor (production), Home (built), Travel (built) |

(Sections 3–9 retained in the full audit document; abbreviated here for archive economy. The original 305-line report is preserved verbatim in version control history under commit refs prior to the docs-as-governance migration.)

---

*End of report (frozen).*
