# ADR-0001: Independent Kernel with selective Abbeygate adoption

Date: 2026-09-06. Status: chosen for the local implementation under Uriel's delegated repository/reuse choice. Production topology and distribution remain open decisions.

## Problem

M3 configuration visibility is due September 8. The target Kernel must eventually serve multiple insurance operating models without customer forks. Latest Abbeygate has valuable governed command patterns, but its configuration drafts and publication path remain coupled to Motor, MBE, Program/Binder rows and its current data model. Copying those owners would make that coupling the new Kernel's contract.

## Decision

Build a separately compiling TypeScript application here. Adapt the verified patterns—strict operation registry, server-injected context, authorization, canonical command dispatch and audit—without copying Abbeygate's customer/business model or claiming its capabilities migrated. Pinned source: `FacioMGA/abbeygate@616f2da53e514dda60880b580dd946ced016e3d9`. See the reuse audit for exact paths and identified weaknesses.

`src/contracts` owns supported schemas and operation descriptors. `src/application` owns canonical use cases. `src/domain` owns deterministic metadata validation, catalog and hashing. `src/storage` owns tenant-scoped persistence. `src/server` adapts authenticated HTTP/MCP; `public` renders those responses. Customer material lives outside shared runtime modules.

Five initial configuration sections are explicitly bounded typed metadata. Unknown extra fields are rejected; unsupported algorithms become named `REQUIRES_ENGINEERING` gaps. The catalog inventories all thirteen target aggregates. Complete definition metadata is a distinct result from production readiness, which stays false until executable capabilities and release gates exist.

Use SQLite for the local control-plane slice: scoped draft/release rows, immutable release/audit triggers, optimistic concurrency, atomic command+idempotency+audit writes and content integrity checks. Definition payloads are typed snapshots in relational workflow rows. This is an explicit temporary representation, not the target full relational insurance model. No policyholder transactions, financial records or customer database connections are present. A storage interface and approved regional database/migrations must precede production adoption; Node 22 SQLite is experimental.

Every command context contains workspace, runtime tenant, environment, operating entity, actor, permissions and a fresh server-generated correlation ID. All storage access keys use the full scope. Local random credentials bind to that scope; domain code never trusts context from query, body or MCP arguments. The loopback-only transport refuses cross-origin access. Production SSO/OAuth, credential expiry/revocation, managed keys, distributed rate limiting, approved residency/storage and operational readiness are separate gates.

Published snapshots currently mean immutable effective-dated reference fixtures. No endpoint produces a production release or claims that fixtures are signed. A real release publisher must compile approved versions, verify simulations/golden evidence, require independent policy-controlled human approval, sign content and produce a runtime-verifiable manifest. Legacy adapters will consume these releases through owning services and explicit compatibility contracts.

## Consequences and next boundaries

- M3 can be exercised now against durable state and a real MCP transport, independently of incomplete prospect requirements.
- Existing Abbeygate, Attsure and Altus journeys remain authoritative in their current applications until golden parity and one-writer cutover gates pass.
- The first customer packages must be grounded in approved scope, beginning with the supplied Bonzah source. Generic reference fixtures never count as Bonzah, UE or VUW.ai acceptance.
- Cooper Process Builder and existing executable product/rating/document/finance modules need further bounded extraction behind typed ports. The current graph schema is metadata validation, not a substitute for that process engine.
- Production manifests, documentation publication, CRM billing ownership, backup/recovery and target adapters remain explicit work. No cloud deployment or customer reset is part of this first implementation.

## Technical references

Implementation uses the installed SDK examples and current primary documentation: [MCP TypeScript server](https://ts.sdk.modelcontextprotocol.io/server), [Zod JSON Schema generation](https://zod.dev/json-schema), [Node 22 SQLite API](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html). Exact dependency versions are locked in `package-lock.json`.
