---
title: ADR-0036 Config MCP module and tool surface
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-27
binding: true
---

# ADR-0036: Config MCP module and tool surface

## Status

Accepted.

## Context

Facio Gen2 needs a governed entry point for an AI Product Architect agent that lets a manager describe a new insurance product configuration in natural language and have Facio turn that intent into a versioned, validated, simulated configuration draft. The first deliverable (Config MCP V1) targets a demo where a Classic Car variant of the existing motor product is configured and sandbox-published end-to-end.

This is the first time the platform exposes a tool surface to an LLM. Without a single canonical owner for that surface, every team that wires an agent integration would invent its own tool registration pattern, its own context-injection scheme, and its own audit/permission semantics. That fan-out has two failure modes the contract spine cannot recover from after the fact:

1. **Authority leak.** The model is allowed to supply `tenantId`, `userId`, or role context, because each ad-hoc adapter "trusts" its caller. Tenant resolution stops being [`resolveTenant.ts`](../../../backend/http/middleware/resolveTenant.ts)'s monopoly per [`tenancy.md`](../contracts/tenancy.md).
2. **Tool sprawl.** Modules register MCP tools wherever convenient. The spec's "minimal V1 tool list" becomes 40 tools across 8 modules with no single registry to enumerate, audit, or rate-limit.

A walk of the repo confirms no MCP server, agent runtime, or LLM tool-registry exists today (`backend/`, `packages/`, `frontend/`, `tools/`). The closest comparable pattern is the BullMQ worker `registerHandler` registry in [`backend/workers/index.ts`](../../../backend/workers/index.ts) — a single map keyed by job name, populated by side-effecting imports in `registerBuiltInHandlers.ts`. That model works because there is exactly one place that knows the full handler catalog.

The implementation plan ([`docs/architecture/decisions/ADR-0036`](./ADR-0036-config-mcp-module-and-tool-surface.md) plus this ADR's siblings ADR-0037, ADR-0038) settled on a HTTP/SSE transport mounted inside the existing Express app for V1, with a transport-abstracted core that supports stdio later.

## Decision

1. **Create `backend/modules/mcp/` as the single canonical owner of "AI agent tool exposure" on the Abbeygate platform.** Every MCP tool ever exposed by this codebase — Config MCP today, future Quote MCP, Claims MCP, BDX MCP — registers through `backend/modules/mcp/app/toolRegistry.ts`. No other module may import an MCP transport SDK, declare an MCP tool descriptor, or wire an HTTP/SSE/stdio MCP endpoint. Modules **own** the use cases (`backend/modules/configuration/app/*`); `mcp/` **publishes** them.

2. **The tool descriptor shape is normative.** Every tool registered with the registry has the shape declared in `backend/modules/mcp/domain/toolDescriptor.ts`:

   ```ts
   export interface ToolDescriptor<I, O> {
     name: string;                          // dot-namespaced, e.g. 'config.products.cloneTemplate'
     inputSchema: z.ZodType<I>;             // strict; no z.any() / z.unknown() / .passthrough() / .catchall()
     outputSchema: z.ZodType<O>;            // strict
     requiredPermission: PermissionKey;     // see ADR-0036 §4
     description: string;                   // surfaces in MCP catalog for the model
     run: (input: I, ctx: ConfigMcpContext) => Promise<O>;
   }
   ```

   The schema-honesty rules of ADR-0028 (no `z.any()` / `.passthrough()` / `.catchall()` inside the wrapper's schemas) extend to `inputSchema` / `outputSchema` here. A new guard `tools/quality/check-mcp-tool-schema-quality.mjs` enforces this on the MCP registration sites the same way `check-typed-handler-schema-quality.mjs` enforces it on `typedHandler` callsites.

3. **Server-injected context, never model-supplied.** `ConfigMcpContext` (`backend/modules/mcp/domain/mcpContext.ts`) carries `tenantId`, `userId`, `roles`, `permissions`, `channel`, `sessionId`, `requestId`. The MCP HTTP router builds this object from the existing JWT chain + `resolveOperatingTenant` middleware. The model **never** supplies any of those fields; the registry rejects tool inputs whose schemas declare them. This is the same fail-closed posture as ADR-0019.

4. **One funnel: `executeToolCall`.** Every tool invocation — from any transport — runs through `backend/modules/mcp/app/executeToolCall.ts` in this fixed order:

   ```
   authorizeToolCall(tool, ctx)   // throws UNAUTHORIZED on permission miss
   → tool.inputSchema.parse(input) // throws VALIDATION_ERROR on shape miss
   → tool.run(parsedInput, ctx)
   → recordMcpAudit({ tool, ctx, status, summary })   // AuditLogger.log + appendDomainEvent CONFIG.TOOL_CALLED
   → serializeMcpResult(output)    // safe summary; no internal IDs leak
   ```

   Errors are mapped to a closed union `McpToolError` (`backend/modules/mcp/domain/toolError.ts`):

   ```
   UNAUTHORIZED | VALIDATION_ERROR | DRAFT_NOT_FOUND | UNKNOWN_FIELD_REFERENCE
   | DUPLICATE_KEY | PUBLISH_BLOCKED | REQUIRES_ENGINEERING | INTERNAL_ERROR
   ```

   `REQUIRES_ENGINEERING` is the V1 escape hatch for any tool call that would otherwise force a code change (new questionnaire field, new pricing factor, new document template, new product line). It returns a structured ticket payload — never silently no-ops.

5. **Transport is decoupled.** `backend/modules/mcp/domain/transport.ts` declares `ITransport`, an interface implemented by `backend/modules/mcp/infra/transport/httpSseTransport.ts` today. V1 mounts only the HTTP/SSE transport at `/api/mcp/config`. A stdio adapter under `tools/mcp/configMcpStdio.ts` can be added later without touching the registry or the tools.

6. **Permission family.** A new `configuration` resource is added to the canonical [`PERMISSION_TAXONOMY`](../../../backend/modules/accessControl/domain/permissionTaxonomy.ts) with actions `read | draft | validate | simulate | publish_sandbox | publish_production`. V1 ships with `publish_production` defined but never granted; no tool wires it.

7. **Audit is mandatory.** Every `executeToolCall` invocation writes an `AuditAction` row via [`AuditLogger`](../../../backend/platform/audit/logger.ts) (new `entityType: 'CONFIG_DRAFT'` and a `CONFIG.*` action vocabulary documented in ADR-0037) and emits a `CONFIG.TOOL_CALLED` domain event via [`appendDomainEvent`](../../../backend/platform/events/domainEvents.ts). The `CONFIG.*` event family is routed `audit_only` in V1 ([`backend/platform/events/queue.ts`](../../../backend/platform/events/queue.ts) `AUDIT_ONLY_EVENT_TYPES`).

## Forbidden

- Any module other than `backend/modules/mcp/` importing `@modelcontextprotocol/sdk` or registering an MCP tool descriptor.
- Any tool descriptor whose `inputSchema` accepts `tenantId`, `userId`, `roles`, `permissions`, or `operatingTenantId`. The registry's compile-time check forbids these field names in tool input shapes.
- Any tool whose `run` function reads tenant context from the model's input rather than from `ConfigMcpContext`.
- Any direct HTTP route — bypassing the MCP router — that exposes an MCP-protocol response. The HTTP/SSE handshake lives only at `/api/mcp/config`.
- Any tool registration that names itself outside the dot-namespaced family this ADR establishes (`config.*` for V1; future families per ADR amendment).
- A second `registerMcpTool` helper, even "for tests." Tests register via the canonical registry with a per-test scope or use the in-memory transport.

## Consequences

- One module owns the AI tool surface; new agents (Quote MCP, Claims MCP) land as additional tool families in the same registry behind the same audit/permission funnel.
- The MCP SDK becomes a single dependency added once, owned by one module's `infra/`. No fan-out across the codebase.
- Schema-honesty guarantees mean a tool's published catalog matches its runtime contract — the agent cannot accidentally call a tool with shapes the run function does not actually accept.
- The transport abstraction makes "wire Cursor to Config MCP via stdio" a small adapter PR later, not a refactor.

## Alternatives considered and rejected

- **Let each module register its own tools directly via `@modelcontextprotocol/sdk`.** Rejected: identical to the BO BullMQ pattern's failure mode before [`backend/workers/registerBuiltInHandlers.ts`](../../../backend/workers/registerBuiltInHandlers.ts) consolidated it — no single place to audit/permission/rate-limit and no machine-checkable boundary against tenant-context leaks.
- **Build MCP on top of `typedHandler` and skip the new module.** Rejected: `typedHandler` is HTTP-shape parsing (ADR-0028). MCP needs a tool catalog, schema-driven invocation, and permission classes the HTTP wrapper has no opinion about.
- **Adopt an existing community MCP framework wholesale (e.g. server templates).** Rejected for V1: those templates assume single-tenant Node deployments and would push tenant resolution out of the existing `resolveTenant.ts`/`runWithOperatingTenant` chain. We adopt the SDK transport pieces only.

## Amendment (2026-05-28) — Remote agent transport + API-key identity

V1 originally shipped only the BO-internal HTTP/SSE transport (plain REST JSON envelope at `/api/mcp/config`, JWT auth). A customer requirement landed for ChatGPT Connectors and Claude Desktop to talk to Config MCP directly without a local bridge install. This amendment extends the contract to cover that path without changing the canonical registry, funnel, or audit story.

1. **Second transport: official MCP Streamable HTTP.** A new adapter at `backend/modules/mcp/infra/transport/streamableHttpTransport.ts` uses `@modelcontextprotocol/sdk` (v1.29) to mount the canonical `toolRegistry` on the MCP JSON-RPC protocol that Claude/ChatGPT/Cursor speak natively. Mounted at `/api/v1/mcp/config` — outside the BO surface gate, behind API-key auth. Same `executeToolCall` funnel, same audit, same permissions; only the wire protocol differs. Stateless mode (no per-session server state).

2. **New identity path: API key → `CONFIG_AGENT`.** A remote MCP request carries no User; it carries `Authorization: Bearer facio_…`. The new `backend/modules/mcp/http/mcpApiKeyAuth.ts` validates the token via `ApiKeyService.validateKeyForMcp`, enforces a defensive cross-tenant check against `getTenantConfig()`, and synthesises an MCP-shaped identity on `req`:
   - `req.user.id = 'apikey:<apiKeyId>'`, `req.user.role = 'CONFIG_AGENT'`
   - `req.resolvedPermissions = ApiKey.permissions` (per-key scoped, not role-baseline)

   The `ApiKey` Prisma model gained a `permissions String[]` column (migration `20260528082031_add_api_key_permissions`). Legacy `/api/v1/*` routes ignore the column; only the MCP auth path reads it. Every audit row written through `recordMcpAudit` carries `actorId = apikey:<id>`, so any tool call is traceable back to the issuing credential.

3. **Permission policy for MCP keys.** Defined in `permissionTaxonomy.ts`:
   - `CONFIG_AGENT_BASELINE` — `configuration.{read, draft, validate, simulate}`. Every issued MCP key starts here.
   - `CONFIG_AGENT_OPTIONAL` — `configuration.publish_sandbox`. Per-key opt-in at issuance time; the operator issuing the key must themselves hold the permission (defense-in-depth).
   - `configuration.publish_production` — never issued from an MCP key in V1.

4. **Key issuance flow.** `backend/modules/mcp/app/issueMcpApiKey.ts` is the sole writer of MCP-tagged `ApiKey` rows. BO routes at `/api/bo/mcp/keys` (`POST /`, `GET /`, `POST /:id/revoke`) expose this to the BO Architect page. The raw `facio_…` token is returned ONCE on creation and never recoverable — matches the canonical `ApiKeyService.createApiKey` contract.

5. **Out of scope of this amendment.** OAuth 2.1 (Phase 4 — required for ChatGPT Apps Store distribution); per-key rate limiting (Phase 4); stateful MCP sessions (would enable server-initiated notifications, not required by V1 tools).

This amendment leaves every other element of ADR-0036 intact: same `ToolRegistry`, same `executeToolCall` funnel, same canonical audit, same prohibition on model-supplied identity context. The `ITransport` abstraction was deliberately designed so a second transport adapter could land without re-architecting the registry — this amendment exercises that affordance.

## Amendment #2 (2026-05-28) — Operator MCP family + per-family mount

V1 originally registered only the `config.*` tool family. A second family — `operator.*` — lands now to cover the Gen2 operator action layer (search customers/quotes/policies, send wizard/quote/document/FNOL links, list UW queue, sales stats). The original ADR explicitly anticipated this: "tool registrations outside the dot-namespaced family (`config.*` for V1)" was a Forbidden cell, with "future families per ADR amendment" as the escape hatch. This amendment is that escape hatch.

1. **Sanctioned tool family: `operator.*`.** Every operator tool is a thin adapter over an existing canonical service (`accountsRouter`, `listPoliciesUseCase`, `dispatchCustomerEmailTrigger`, `emailPolicyDocumentsUseCase`, `claimsFnolLinkService`, `/api/reports/dashboard`). The operator module has zero direct DB writes outside its own audit repo — enforced by a new guard `tools/quality/check-operator-mcp-no-direct-db-writes.mjs`.

2. **Sanctioned synthetic identity: `OPERATOR_AGENT`.** Mirrors `CONFIG_AGENT` exactly: per-key `permissions` array on `ApiKey`, `actorId = apikey:<id>` in every `AuditAction` row, `WWW-Authenticate: Bearer realm="facio-operator-mcp"` on auth failure. The `mcpApiKeyAuth` middleware is shared (the realm string is parameterised by the mount).

3. **Permission policy:** `OPERATOR_AGENT_BASELINE = [operator.read, operator.comm, operator.analytics]`. `operator.mutate` is reserved — defined in the taxonomy but never granted to a V1 key (matches the `configuration.publish_production` posture). V2 mutation tools (quote fork/update/save, endorsement drafts) will activate it behind a confirmation-token store ADR.

4. **Second public mount: `/api/v1/mcp/operator`.** Same Streamable HTTP transport class, but the per-request `Server` instance applies a family filter so only `operator.*` tools appear in `tools/list` for clients hitting this URL (and only `config.*` tools at `/api/v1/mcp/config`). The transport adapter signature gains a `familyFilter?: string` argument; the router becomes a factory that takes `{ family }`. One shared registry, two filtered views.

5. **Key family selector at issuance.** `issueMcpApiKey` accepts `family: 'config' | 'operator'` and resolves the baseline from the right constant. The BO key-management view gains a family dropdown; the issued URL adapts (`/api/v1/mcp/config` vs `/api/v1/mcp/operator`).

6. **Standard envelope.** Operator tools pack their structured outcome (`ok`, `action_id`, `status`, `summary`, `entities`, `next_actions`, plus `needs_disambiguation` / `missing_required_fields` variants per spec §5) into the MCP `CallToolResult.structuredContent`. The wrapper is `backend/modules/operator/domain/operatorEnvelope.ts`.

7. **Audit extensions.** `AuditAction.entityType` TS union extended with `'OPERATOR_ACTION' | 'COMMUNICATION'`; `AuditEventType` extended with `OPERATOR.*` literals + the open suffix `\`OPERATOR.TOOL_CALLED.${string}\``. DB column is `String` — no migration.

8. **Out of scope of this amendment.** Quote mutation (A3), endorsement drafts (B3), confirmation-token preview infra. These land in a dedicated **ADR-00NN — Operator MCP mutation governance** when V2 begins. V1 operator tools that would need preview return `REQUIRES_ENGINEERING` with a structured ticket pointing at the deferred ADR.

Identical contract-spine posture as Amendment #1: same registry, same funnel, same audit, same forbidden context fields. The only mechanical changes are (a) the family-filter parameter on the Streamable HTTP transport, (b) the family-aware key issuer, (c) the new `OPERATOR_AGENT_BASELINE` constant. Everything else is additive within the existing patterns.

## Amendment #3 (2026-05-28) — OperatorPreviewEnvelope + confirmation token store

V2 mutation tools (Operator MCP, see [ADR-0039](./ADR-0039-operator-mcp-v2-mutation-governance.md)) introduce a preview-then-confirm pattern that V1 did not need. This amendment registers the contract additions inside the MCP module without altering V1 behaviour.

1. **`OperatorPreviewEnvelope`** — third variant of the `OperatorEnvelope` discriminated union in [`backend/modules/operator/domain/operatorEnvelope.ts`](../../../backend/modules/operator/domain/operatorEnvelope.ts). Shape:

   ```ts
   {
     ok: true,
     status: 'preview',
     action_id, correlation_id, summary,
     requires_confirmation: true,
     confirmation_token: string,
     expires_at: ISO timestamp,
     diff: Array<{ field, from, to }>,
     premium_change?: { old_premium, new_premium, delta },
     readiness_blockers: Array<{ code, message }>
   }
   ```

   Returned by every `operator.preview_*` tool; the matching commit tool requires `confirmation_token`.

2. **Confirmation token store** — `backend/modules/mcp/infra/confirmationTokenStore.ts` (new). Redis SET+TTL via the canonical `getRedisClient()` + the `webhookReplayGuard` pattern. 10-minute TTL; single-use redemption (GET + DEL); cross-actor redemption rejected (token's `actorId` is part of the consume check). When Redis is unavailable (local dev) falls back to an in-process Map with TTL enforced in JS — acceptable for single-pod demo deployments; ADR-0039 §risk notes the multi-pod follow-up.

3. **Audit vocabulary extension** — `AuditEventType` (TS union, [`backend/platform/audit/logger.ts`](../../../backend/platform/audit/logger.ts)) gains the `OPERATOR.{QUOTE_PATCH_APPLIED, QUOTE_RERATED, QUOTE_PREVIEW_GENERATED, QUOTE_REVISION_SAVED, QUOTE_REVISION_SENT, ENDORSEMENT_DRAFT_CREATED, ENDORSEMENT_LINK_SENT, ENDORSEMENT_SUBMITTED_FOR_REVIEW}` literals. DB column is `String` — no migration.

4. **New guards** registered in [`package.json`](../../../package.json):
   - `guard:operator-mutation-preview-required` — every operator MCP tool with `auditClass: 'mutate'` returns OR requires a `confirmation_token`.
   - `guard:operator-validate-on-patch` — `applyQuotePatchUseCase.ts` calls `validateForContext` from `@facio/validation/backend` before any persist.

No changes to the V1 registry / funnel / mount / transport. The Streamable HTTP family-filter from amendment #2 already handles the family-scoped `tools/list` for the new V2 mutate tools.

## Amendment #4 (2026-05-28) — OAuth 2.1 layered auth (V2.1)

[ADR-0040](./ADR-0040-mcp-oauth-2.1-resource-server.md) introduces OAuth 2.1 alongside the existing `facio_…` Bearer flow so ChatGPT Apps custom connectors can authenticate natively (ChatGPT's MCP client does not accept custom-name Bearer tokens — see ADR-0040 §Context). This amendment registers the layered model inside the MCP module without disturbing Bearer V1 semantics.

1. **One auth funnel, two prefixes.** [`mcpApiKeyAuth.ts`](../../../backend/modules/mcp/http/mcpApiKeyAuth.ts) becomes [`mcpAuthMiddleware.ts`](../../../backend/modules/mcp/http/mcpAuthMiddleware.ts). The middleware extracts the Bearer token and branches by prefix: `facio_…` → existing `ApiKeyService.validateKeyForMcp` path; `at_…` → new OAuth access-token validation. Both branches MUST produce identical `req.user + req.resolvedPermissions` so every downstream consumer is unchanged.

2. **Discovery surface.** Three new public endpoints (per tenant):
   - `GET /.well-known/oauth-protected-resource` (RFC 9728)
   - `GET /.well-known/oauth-protected-resource/api/v1/mcp/operator` and `/.../mcp/config` (per-mount variants with narrowed `scopes_supported`)
   - `GET /.well-known/oauth-authorization-server` (RFC 8414)

   On 401, the MCP transport now emits `WWW-Authenticate: Bearer realm="…", resource_metadata="https://<tenant>/.well-known/oauth-protected-resource"`. Without this header, ChatGPT's MCP client cannot discover the AS and silently filters every tool out (the symptom we hit 2026-05-28).

3. **Scopes ARE permission keys.** No new permission vocabulary. `scopes_supported` literally lists `operator.{read,comm,analytics,mutate}` + `configuration.{read,draft,validate,simulate,publish_sandbox}`. The OAuth access-token's `scope` claim becomes `req.resolvedPermissions` at validation time; every existing `requiredPermission` check enforces the same string.

4. **Consent gating** (ADR-0040 §6). ADMIN may grant any scope; non-admin BO users may grant `operator.*` only. Enforced by a new `assertCanGrantScopes` helper in [`permissionTaxonomy.ts`](../../../backend/modules/accessControl/domain/permissionTaxonomy.ts); pinned by `tools/quality/check-oauth-consent-role-gate.mjs`.

5. **Four new guards** registered in [`package.json`](../../../package.json):
   - `guard:oauth-pkce-required` — `/oauth/authorize` + `/oauth/token` reject any flow without `code_challenge_method=S256`.
   - `guard:oauth-resource-bound` — every issued token carries a `resource` matching an MCP mount (RFC 8707).
   - `guard:mcp-auth-single-funnel` — only `mcpAuthMiddleware.ts` may produce `req.resolvedPermissions` on MCP routes.
   - `guard:oauth-consent-role-gate` — every consent handler calls `assertCanGrantScopes` before emitting a code.

6. **`AuditEventType` union extension** — `OAUTH.{CLIENT_REGISTERED, CLIENT_REVOKED, AUTHORIZATION_GRANTED, AUTHORIZATION_DENIED, TOKEN_ISSUED, TOKEN_REFRESHED, TOKEN_REVOKED}`. `actorId = user:<id>` for consent rows; `actorId = oauth_client:<clientId>` for autonomous refresh / revoke. Visible in the existing **BO → Operator action history** view alongside `OPERATOR.*` rows.

7. **BO UI** — fourth tab on [`ProductArchitectPage.tsx`](../../../frontend/src/surfaces/bo/pages/ProductArchitectPage.tsx) — "OAuth clients" — lists DCR registrations with a revoke action and a quick-start helper for ChatGPT Apps.

Bearer V1 behaviour is unchanged. The streamable HTTP transport's wire-name translation, family filter, and confirmation-token store all continue to work identically — `mcpAuthMiddleware` is a strict superset of `mcpApiKeyAuth`.

## Links

- Sibling ADRs: [ADR-0037](./ADR-0037-product-launch-drafts-as-workflow-objects.md) · [ADR-0038](./ADR-0038-program-metadata-extension-slots.md).
- Tenancy: [`docs/architecture/contracts/tenancy.md`](../contracts/tenancy.md) · [ADR-0019](./ADR-0019-tenancy-and-authority-fail-closed.md).
- HTTP wrapper precedent: [ADR-0028](./ADR-0028-typed-http-handler-wrapper.md).
- Canonical-ownership row: "AI tool surface" / "Config MCP V1" (in [`canonical-ownership.md`](../contracts/canonical-ownership.md)).
- Audit: [`backend/platform/audit/logger.ts`](../../../backend/platform/audit/logger.ts).
- Outbox: [`backend/platform/events/domainEvents.ts`](../../../backend/platform/events/domainEvents.ts).
- Permission taxonomy: [`backend/modules/accessControl/domain/permissionTaxonomy.ts`](../../../backend/modules/accessControl/domain/permissionTaxonomy.ts).
- MCP SDK: `@modelcontextprotocol/sdk` (v1.29).
- Operate runbook: [`docs/operate/config-mcp.md`](../../operate/config-mcp.md).
