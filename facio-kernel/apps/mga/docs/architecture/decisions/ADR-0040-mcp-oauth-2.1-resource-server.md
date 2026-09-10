---
title: ADR-0040 Operator/Config MCP OAuth 2.1 (V2.1)
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-27
binding: true
---

# ADR-0040: Operator/Config MCP OAuth 2.1 — resource-server posture + layered auth

## Status

Accepted.

## Context

[ADR-0036](./ADR-0036-config-mcp-module-and-tool-surface.md) (amended three times) established the canonical MCP tool registry, the `executeToolCall` funnel, the Streamable HTTP transport, the `OPERATOR_AGENT` / `CONFIG_AGENT` synthetic identities, and the per-key opaque `facio_…` Bearer credential. [ADR-0039](./ADR-0039-operator-mcp-v2-mutation-governance.md) added quote mutation + endorsement tools with preview-then-confirm.

The Bearer path works for every MCP client that accepts custom-named tokens — Claude Desktop, Claude Code, Cursor MCP, raw curl. It does NOT work for ChatGPT's Apps custom-connector surface: ChatGPT's Apps SDK requires OAuth 2.1 + RFC 9728 Protected Resource Metadata + RFC 8414 Authorization Server Metadata, with PKCE S256, the RFC 8707 `resource` parameter, and (for Apps directory submission) RFC 7591 Dynamic Client Registration. Per OpenAI: "ChatGPT does not support custom API keys or customer-provided mTLS certificates." See [Apps SDK auth docs](https://developers.openai.com/apps-sdk/build/auth) and [MCP Authorization spec](https://modelcontextprotocol.io/specification/draft/basic/authorization).

The customer demoing this platform prefers ChatGPT. Smoke-testing on 2026-05-28 confirmed: the `Abbeygate_Operator` namespace registers in ChatGPT, but ChatGPT's MCP client never issues a `tools/list` against our Bearer-only endpoint — Sentry shows zero traffic post-deploy. Adding OAuth 2.1 is the unblocker.

## Decision

### 1. Layered auth — Bearer and OAuth coexist forever

The MCP mounts at `/api/v1/mcp/operator` and `/api/v1/mcp/config` accept BOTH credential kinds, on a single `Authorization: Bearer <token>` header, distinguished by prefix:

- `facio_<hex>` → existing `ApiKey`-backed validation (V1 ADR-0036 amendment #1).
- `at_<hex>` → new OAuth-access-token validation (this ADR).

Both branches produce identical `req.user + req.resolvedPermissions` so every downstream consumer — `authorizeToolCall`, `recordMcpAudit`, the family filter, the wire-name translator, every per-tool `requiredPermission` check — keeps working unchanged. No tool implementation moves; no audit shape moves; no schema moves. The unification lives in one new middleware: [`backend/modules/mcp/http/mcpAuthMiddleware.ts`](../../../backend/modules/mcp/http/mcpAuthMiddleware.ts).

Bearer is NOT deprecated. Local-only clients (Claude Desktop, Cursor, curl in dev) keep the simpler key-paste UX; remote-app clients (ChatGPT and any future browser-driven host) get OAuth.

### 2. We are both resource server AND authorization server

The MCP mount is the **resource server** (RFC 9728). The same Express process is the **authorization server** (RFC 8414). One Express app, two roles, per the MCP spec's "MAY be hosted with the resource server" allowance.

No external IDP. No customer SSO federation in V2.1 (deferred to V3). The decision to embed the AS keeps tenant isolation trivial — issuer = tenant host — and avoids a new dependency surface during a one-week sprint.

### 3. Per-tenant issuer; per-mount protected-resource

Tenant binding is the existing routing model: `https://abbeygate-cy.facio.io` is one issuer; `https://abbeygate-pt.facio.io` is another. Cross-tenant token use is rejected by the same guard shape as `mcp.apikey.tenant_mismatch` (the resolved tenant from the request URL must match the tenant the token was issued under).

Protected-resource metadata is published at THREE locations to maximise discovery success:

- `GET /.well-known/oauth-protected-resource` (root, covers either mount).
- `GET /.well-known/oauth-protected-resource/api/v1/mcp/operator` (operator-mount-specific; narrower `scopes_supported`).
- `GET /.well-known/oauth-protected-resource/api/v1/mcp/config` (config-mount-specific).

Authorization-server metadata is published at `GET /.well-known/oauth-authorization-server` (one per tenant; same `issuer` for all mounts under that tenant).

### 4. PKCE S256 mandatory; no client_secret-only; no wildcards

- `code_challenge_methods_supported: ["S256"]` only. No `plain`. No flows without PKCE.
- `token_endpoint_auth_methods_supported: ["none", "client_secret_post"]` — `"none"` for public clients (ChatGPT registers as public; PKCE is the proof). `"client_secret_post"` for confidential clients (Claude Desktop, internal tooling).
- `redirect_uris[]` must be HTTPS, no wildcards, no `*` substitution, no `localhost` except in dev tenants. Validated at DCR time.
- No implicit grant. No password grant.

### 5. Scopes ARE the existing permission keys — zero new vocabulary

`scopes_supported` is literally:
```
operator.read   operator.comm   operator.analytics   operator.mutate
configuration.read   configuration.draft   configuration.validate
configuration.simulate   configuration.publish_sandbox
```

When an OAuth access token is validated, its `scope` claim becomes `req.resolvedPermissions`. Every existing `requiredPermission` check enforces the same string. Drop-in.

### 6. Consent gating — role-based scope filtering

ADMIN role: may grant ANY requested scope (operator + configuration).
UNDERWRITER / MANAGER / any non-admin BO role: may grant **operator.\*** scopes ONLY. Requests for `configuration.*` scopes from a non-admin user are surfaced on the consent screen as "requires ADMIN" and excluded from any code that gets issued.

Defense-in-depth on `operator.mutate`: the consenting BO user must themselves hold `operator.mutate` (per their resolved permissions, not the global taxonomy). This catches an underwriter who lacks mutate trying to grant it.

Enforced by a new `assertCanGrantScopes(userId, requestedScopes)` helper in [`backend/modules/accessControl/domain/permissionTaxonomy.ts`](../../../backend/modules/accessControl/domain/permissionTaxonomy.ts); pinned by `tools/quality/check-oauth-consent-role-gate.mjs`.

### 7. Token storage split

| Artifact | Store | TTL | Rationale |
|---|---|---|---|
| `OAuthClient` row | Prisma (`oauth_clients` table) | Permanent (until `revokedAt`) | Persistent, low write rate, listed in the BO. |
| `OAuthRefreshToken` row | Prisma (`oauth_refresh_tokens` table) | 30 days; rotates on use | Long-lived; needs revocation; rotation chain auditable. |
| Authorization code | Redis | 60 seconds; single-use | PKCE-bound, redeemed exactly once. Same precedent as `confirmationTokenStore.ts`. |
| Access token | Redis | 1 hour | Hot path on every MCP request. Falls back to in-memory map in single-pod dev. |

### 8. RFC 8707 resource binding — mandatory

Every `/oauth/authorize` and `/oauth/token` call MUST include a `resource` parameter; the value MUST exactly match one of the MCP mounts: `https://<tenant>/api/v1/mcp/operator` OR `https://<tenant>/api/v1/mcp/config`. The token is bound to that resource; presenting it at the OTHER mount is a `cross_resource_use_rejected` audit row.

### 9. DCR — open registration with bounded exposure

`POST /oauth/register` (RFC 7591) accepts any ChatGPT/Claude/Cursor client that submits a valid `client_metadata` document. Open registration enables ChatGPT Apps directory submission and zero-Facio-engineer customer onboarding.

Bounded exposure:
- Rate limit: 3 registrations per IP per minute (Redis sliding window).
- Cap: 1000 active clients per tenant.
- Every registration writes an `OAUTH.CLIENT_REGISTERED` audit row.
- Every registered client is revocable from the BO ("OAuth clients" tab).

### 10. Audit vocabulary

`AuditEventType` union gains:
```
OAUTH.CLIENT_REGISTERED   OAUTH.CLIENT_REVOKED
OAUTH.AUTHORIZATION_GRANTED   OAUTH.AUTHORIZATION_DENIED
OAUTH.TOKEN_ISSUED   OAUTH.TOKEN_REFRESHED   OAUTH.TOKEN_REVOKED
```

`actorId = user:<id>` for consent rows (the BO user who clicked Allow); `actorId = oauth_client:<clientId>` for autonomous refresh / revoke. Visible alongside the `OPERATOR.*` rows in the existing **BO → Operator action history** view.

## Forbidden

- Issuing an access token without a valid PKCE `code_verifier` matching the authorization request's `code_challenge`.
- Issuing an access token without a `resource` parameter that matches an MCP mount on this tenant.
- Granting a `configuration.*` scope to a non-ADMIN BO user (per §6).
- Producing `req.resolvedPermissions` for an MCP route from any path other than `mcpAuthMiddleware.ts` (pinned by `check-mcp-auth-single-funnel.mjs`).
- DCR-registered clients with redirect URIs containing `*`, query strings, or HTTP scheme (HTTPS required outside dev).
- Cross-tenant token presentation (token issued under tenant X used at tenant Y → 401).
- Storing access tokens in Postgres (Redis only; tokens are hot-path and short-lived).

## Consequences

- Two parallel auth surfaces: Bearer for headless clients, OAuth for browser-driven hosts. Same tools, same permissions, same audit.
- One new module (`oauth/`) with five routers (discovery, register, authorize, token, revoke). One new middleware. Two new Prisma tables. Four new guards.
- ChatGPT Apps connector works end-to-end with zero Facio engineer involvement per new customer.
- Bearer keys remain the simplest path for local dev — no consent screen, no browser round-trip.
- Lloyd's-style audit trail extends: every OAuth event chains to a BO user (consent) or DCR client (autonomous), with `correlationId` propagated through token exchanges.

## Alternatives considered

- **External IDP (Auth0 / Entra / Okta) as our AS.** Cleaner long-term posture, but adds vendor dependency, extra cost, and a customer-config burden (per-tenant IDP setup). Deferred to V3 when a customer asks for SSO federation.
- **OAuth-only (deprecate Bearer).** Breaks every existing Claude / Cursor connection on cutover, including the demo paths shipped this week. Layered model chosen instead — Bearer remains the easy path for headless clients.
- **Predefined clients only (no DCR).** Smaller code surface, but every new customer needs a Facio engineer to register their ChatGPT connector. Open DCR with rate limits chosen instead — same security posture, zero ops overhead.
- **JWT access tokens.** Avoids the Redis hop on every MCP request, BUT introduces a 24-hour-or-more revocation window (signed tokens can't be killed before expiry). Opaque tokens + Redis chosen so the BO revoke button works instantly.

## Out of scope (deferred to V3)

- External IDP federation (Okta / Entra / Auth0 as the actual login).
- Customer-owned authorization servers (only Facio is the AS in V2.1).
- Token introspection endpoint (`/oauth/introspect` RFC 7662) — useful for support but not required by the spec; can add later.
- Device code flow (RFC 8628) for CLI-only clients without browsers.
- ChatGPT Apps directory submission (separate marketing/review workstream).
- Multi-tenant federated identity (one user logging into multiple Facio tenants via a single OAuth client).

## Links

- Parent: [ADR-0036](./ADR-0036-config-mcp-module-and-tool-surface.md) (this ADR triggers amendment #4 — register OAuth resource-server posture + layered auth).
- V2 mutation governance: [ADR-0039](./ADR-0039-operator-mcp-v2-mutation-governance.md).
- Tenancy contract: [ADR-0019](./ADR-0019-tenancy-and-authority-fail-closed.md).
- Operate runbook: [`docs/operate/mcp.md`](../../operate/mcp.md) — Phase D adds the V2.1 OAuth section.
- MCP Authorization spec: https://modelcontextprotocol.io/specification/draft/basic/authorization.
- OpenAI Apps SDK auth: https://developers.openai.com/apps-sdk/build/auth.
- RFCs referenced: 9728 (Protected Resource Metadata), 8414 (Authorization Server Metadata), 7591 (DCR), 7636 (PKCE), 8707 (Resource Indicators), 7009 (Token Revocation), 7662 (Token Introspection).
