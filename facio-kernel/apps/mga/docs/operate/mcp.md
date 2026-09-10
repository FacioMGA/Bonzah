---
title: MCP — operator runbook
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-27
binding: true
---

# MCP runbook (Config + Operator)

Two MCP families on one shared registry. See [ADR-0036](../architecture/decisions/ADR-0036-config-mcp-module-and-tool-surface.md) (+ amendments #1–#4), [ADR-0037](../architecture/decisions/ADR-0037-product-launch-drafts-as-workflow-objects.md), [ADR-0038](../architecture/decisions/ADR-0038-program-metadata-extension-slots.md), [ADR-0039](../architecture/decisions/ADR-0039-operator-mcp-v2-mutation-governance.md), [ADR-0040](../architecture/decisions/ADR-0040-mcp-oauth-2.1-resource-server.md).

## Health checks
- BO: `GET /api/mcp/config/catalog` (BO JWT) — empty list = registration didn't run; restart pod.
- Public: `POST /api/v1/mcp/{config|operator}` with `facio_…` returns family-filtered `tools/list`. 401 carries `WWW-Authenticate: Bearer ... resource_metadata=...` (ChatGPT discovery).
## Drift checks
- Config MCP: `product-launch-draft-isolation`. Runtime programme changes are published only from BO Runtime Settings as a complete definition mapped to an explicit binder-product authority.
- Operator MCP V1: `operator-mcp-no-direct-db-writes` (writes outside `infra/repositories/operatorAuditRepo.ts` + `infra/delegators/*`).
- Operator MCP V2: `operator-mutation-preview-required`, `operator-validate-on-patch`.
- OAuth V2.1: `oauth-pkce-required`, `oauth-resource-bound`, `mcp-auth-single-funnel`, `oauth-consent-role-gate`.

## Permissions
- `configuration.{read,draft,validate,simulate}` → UNDERWRITER. Programme-definition publication remains a BO action with the normal Programs update permission.
- `operator.{read,comm,analytics}` → UNDERWRITER. `operator.mutate` (V2) → UNDERWRITER; key issuance requires the operator to hold it AND tick the opt-in.

## Remote MCP keys (Claude / Cursor — Bearer)
- Endpoints: `POST/GET https://<tenant-host>/api/v1/mcp/{config|operator}` (Streamable HTTP).
- Auth: `Bearer facio_…`. Issue via BO → Product Architect → Remote MCP keys. Identity: `apikey:<id>`.
- Cross-tenant: `mcp.apikey.tenant_mismatch`. Family isolation: `mcp.streamableHttp.cross_family_call_rejected`. Revoke from BO sets `isActive=false`.
- Audit: every call → `audit_actions` with `actorId=apikey:<id>`, `actionName=(CONFIG|OPERATOR).TOOL_CALLED.<tool>`.

## Operator MCP — eligibility gates (V1)
- `send_quote_reminder` → `QUOTED|REFERRAL|INFO_REQUIRED|PRICED|PAYMENT_PENDING`. `resend_policy_documents` → `ACTIVE|ISSUED|EXPIRED` (reuses existing `Document.storageUri`). `send_fnol_link` → `ACTIVE|ISSUED` (PENDING Claim + 14-day JWT). `send_wizard_link` → DRAFT Policy + `publicSessionToken`. All comms pass `idempotencySeed`.

## Operator MCP V2 — quote mutation + endorsement drafts (ADR-0039)
- Quote flow: `fork_quote_workspace` → `update_quote_terms` → `rate_quote` → `preview_quote_send` (10-min `confirmation_token`) → `save_quote_revision` → `send_revised_quote`.
- Endorsement flow (DRAFT only): `create_endorsement_draft` → `send_endorsement_link` → `submit_endorsement_for_review` (preview-then-confirm). V2 does NOT bind.
- `validateForContext({ actor: 'underwriter' })` lives only in `applyQuotePatchUseCase.ts`. Tokens in Redis `mcp:operator:preview:<tok>` with memory fallback (single-pod only).
- BO Action History at Product Architect → "Operator action history" tab — `GET /api/bo/mcp/actions`. Source: `audit_actions WHERE actionName LIKE 'OPERATOR.%'`.

## MCP V2.1 OAuth 2.1 (ADR-0040)
- Layered: Bearer (`facio_…`) keeps working; OAuth (`at_…`) unlocks ChatGPT Apps. Same tools, same permissions.
- Discovery: `GET /.well-known/oauth-authorization-server` + `/.well-known/oauth-protected-resource[/api/v1/mcp/{operator|config}]`.
- Flow: `POST /oauth/register` (DCR, 3/min/IP) → `GET /oauth/authorize` (PKCE S256 + RFC 8707 resource) → `GET /oauth/consent` (BO JWT, role-gated) → `POST /oauth/consent/decision` → `POST /oauth/token` → `POST /oauth/revoke`.
- Consent gating: ADMIN any scope; non-admin `operator.*` only. `operator.mutate` requires the user to hold it (DiD).
- Tokens: `at_<64hex>` (1h Redis) + `rt_<64hex>` (30d Prisma, rotates on use). Cross-tenant / cross-resource → 403.
- BO surface: Product Architect → "OAuth clients" tab (`GET/POST /api/bo/mcp/oauth-clients`) with discovery-URL quick-start for ChatGPT.
- Audit: `OAUTH.{CLIENT_*,AUTHORIZATION_*,TOKEN_*}` rows alongside `OPERATOR.*` in the action history tab.
- Guards: `oauth-pkce-required`, `oauth-resource-bound`, `mcp-auth-single-funnel`, `oauth-consent-role-gate`.
