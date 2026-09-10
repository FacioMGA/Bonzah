# Abbeygate reuse boundary

Inspected 6 September 2026. Source: `FacioMGA/abbeygate` at immutable commit `616f2da53e514dda60880b580dd946ced016e3d9`, committed 5 September 2026 at 17:13:51 UTC (`fix(uw): describe jurisdiction referral routing (#1070)`). `git fetch origin` refreshed this reference. This is source evidence, not deployment evidence.

The Abbeygate working tree was not changed. Existing untracked `.claude/`, `.metrics/`, `packages/policy-engine-rs/`, and `tools/benchmarks/` were preserved. Reads used `git show`, `git grep`, and `git ls-tree` against `origin/main`.

## Decision

Build a bounded Kernel configuration foundation and selectively adapt proven Abbeygate patterns. Keep Abbeygate as the existing runtime and a future compatibility oracle. Copying the entire application would import customer assumptions, broad infrastructure dependencies and a staging model that cannot represent the required Tenant Release contract.

M3 requires a real configuration catalogue and completeness report shared by an authenticated screen, HTTP and MCP. Abbeygate supplies useful interface and governance patterns, but its current Product Architect is a Motor configuration workflow. It does not satisfy M3 unchanged.

## Reuse map

All paths below are relative to the pinned Abbeygate repository.

| Source | Reusable part | Kernel adaptation |
|---|---|---|
| `backend/modules/mcp/domain/toolDescriptor.ts`; `app/toolRegistry.ts` | Named descriptor, schemas, permissions, audit class, single registration owner, duplicate rejection | Share a command descriptor model; make HTTP and MCP explicit projections. Validate input and output centrally. Check wire-name collisions and forbidden identity fields. |
| `backend/modules/mcp/app/executeToolCall.ts`; `app/authorizeToolCall.ts` | One dispatch funnel and permission gate | Every UI/API/MCP use case calls the same application service. Persist durable audit evidence; reject unresolved tenant/entity/actor context. |
| `backend/modules/mcp/domain/mcpContext.ts` | Identity is injected by server authentication, never tool arguments | Introduce explicit Kernel tenant and operating-entity scope. Keep correlation and actor metadata outside business input. |
| `backend/modules/mcp/infra/transport/streamableHttpTransport.ts` | Official SDK, stateless request lifecycle, permission-filtered discovery, structured results, canonical-to-wire names | Retain transport separation. Add strict output schemas to discovery and error envelopes; avoid importing Abbeygate ALS, permissions or logger directly. |
| `backend/modules/configuration/app/*.tool.ts` | Thin schema/permission wrappers around use cases | Use configuration-independent application contracts rather than exposing MCP-specific errors inside the domain. |
| `backend/modules/configuration/domain/productLaunchDraft.ts` | Editable workflow separated from published runtime; edits invalidate previous validation/simulation | Implement versioned drafts and immutable releases. Abbeygate publishes to canonical mutable Program/Binder rows, which is a different authority model. |
| `backend/platform/openapi/openapi.ts` | One registry and generated OpenAPI artifact | Generate from implemented Kernel schemas/operations. Keep deployment URLs and claims separate from reusable domain schemas. |
| `backend/http/routes/v1/index.ts` | Retrievable schema and reference UI, with dedicated docs route policy | Serve the configuration screen behind authentication and separate public schema metadata from scoped current values. |
| `frontend/src/modules/configuration/views/ConfigDraftSummary.tsx`; `ConfigDiffViewer.tsx`; `LaunchReadinessPanel.tsx` | Inspect/diff/readiness interaction sequence | Build a tenant-neutral screen that renders the shared completeness response and separates draft, published and effective versions. |

Relevant contract sources: `docs/architecture/decisions/ADR-0036-config-mcp-module-and-tool-surface.md`, `ADR-0037-product-launch-drafts-as-workflow-objects.md`, and `docs/architecture/contracts/{modules-and-layers,tenancy,product-engine-authority}.md`.

## Coupling and correctness risks

1. **Motor-specific draft data.** `backend/modules/configuration/domain/draftDelta.ts` contains `MotorUwOverrides`, `MbeOverrides`, and targets `Program.metadata.abbeygateMotorUwConfig`, `BinderProductAuthority`, `BinderFinancials` and `Tenant.adminFee`. `validateDraft.ts` imports the Motor threshold catalogue and the shared validation registry. Do not use this as the Kernel product/process schema.
2. **Publication is not a Tenant Release.** `publishToSandbox.ts` writes Abbeygate Prisma entities under its operating-tenant ALS context. It targets synthetic tenants and does not implement the north-star signed immutable release or production approval process. Preserve it inside an eventual Abbeygate adapter.
3. **Readiness is only a capability-presence list.** `getDraftSummary.ts` derives configured capabilities from truthy delta families and subtracts them from template capabilities. M3 additionally requires field/capability, source requirement, current/expected state, affected journey, severity, remediation, and distinct missing/incomplete/invalid/inconsistent/unsupported states.
4. **Malformed persisted data is hidden.** `infra/repositories/productLaunchDraftRepo.ts:fromRow` uses `EMPTY_DRAFT_DELTA` when schema parsing fails. A Kernel inventory must expose invalid configuration and its cause rather than erase the evidence in its read projection.
5. **Output-schema enforcement is incomplete.** `executeToolCall.ts` parses inputs but never parses `tool.outputSchema`. `getDraftSummary.tool.ts` exposes `delta` as `z.record(z.string(), z.unknown())` and its output object is not strict. The registry's documented schema-quality guard path does not exist in the inspected tree. These patterns require improvement before reuse.
6. **Audit durability is weaker than the Kernel requirement.** `recordMcpAudit.ts` hashes raw input, which is useful, but catches and logs persistence failure. Mandatory canonical mutations need transactional audit/outbox semantics; an unavailable audit sink cannot silently certify a completed governed write.
7. **Tenant terminology differs.** Abbeygate distinguishes Account scope from operating-tenant jurisdiction. Its MCP `tenantId` means the resolved operating tenant. Kernel requirements add customer tenant, multiple operating entities, environments and residency. Copying field names without a translation boundary would confuse scope.
8. **UI embeds demonstration assumptions.** `LaunchReadinessPanel.tsx` contains `abbeygate-config-mcp-sandbox` and a Classic Car scenario action. Its `confirm()` prompt supplies the required confirmation text itself; it is not an independent typed confirmation. Reuse the interaction concept rather than the implementation.
9. **Broad product SDK coupling.** `backend/modules/policy/domain/productContracts.ts:IProductAdapter` combines premium, documents, discoverability, MBE, claims, legacy Policy projections and product UI contracts. Wrap specific capabilities; do not export this entire interface as the Kernel SDK.
10. **Published API prose is not verified behavior.** The OpenAPI registry embeds customer URLs, a 99.99% uptime guarantee, rate limits and universal idempotency wording. Its global optional `x-tenant-id` description also needs Kernel-specific authorization semantics. Generate accurate claims only from enforced behavior and approved service metadata.

## M3 acceptance implementation

- A strict, versioned configuration model and explicit capability support states, with a schema-owned source requirement map.
- One completeness evaluator reused by HTTP and MCP, with UI rendering the returned report rather than recomputing it.
- Tenant/entity/actor permissions resolved at the authentication boundary; cross-scope identifiers fail closed.
- One fully configured synthetic fixture and one intentionally incomplete fixture, clearly distinguished from approved Bonzah, UE or VUW.ai customer scope.
- Discoverable implemented HTTP operations, valid generated OpenAPI, and MCP discovery/read output with strict schemas.
- Tests covering cross-tenant reads, denied permissions, draft/published distinction, malformed configuration, secret reference redaction, and exact HTTP/MCP report parity.
- Build/configuration/contract hashes and reproducible evidence. None of these local checks proves a production deployment or completion of the separately required demo/POC journeys.

## Later extraction sequence

After M3, baseline the approved Bonzah/UE journeys and complete VUW.ai POC scope. Select typed rating, underwriting, document and process capabilities only when those scopes require them. Capture golden outputs from the existing runtime before extracting or wrapping each capability. Introduce a read-only Abbeygate export adapter with explicit provenance, then dual-run and compare. Production authority transfer remains gated by customer continuity, deployment inventory, compatibility, data preservation and accepted cutover evidence.
