---
title: ADR-0019 Tenancy + authority fail-closed
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-09
binding: true
---

# ADR-0019: Tenancy and binder-authority fail-closed

> **Numbering note (2026-05-10).** The plan that authored this ADR
> targeted the number ADR-0019. Between plan-time and implementation-time
> commit `6a8b34f4` claimed ADR-0019 for the issue-readiness terminal
> outcome contract (`docs/architecture/decisions/ADR-0019-issue-readiness-failed-terminal-outcome.md`).
> ADR-0018 was reserved for the travel-pricing-data externalization
> (PR 3 of the same plan), so this ADR took the next free number 0019.
> Inline source-code comments retain the new number; the plan markdown
> remains unchanged for historical record.

## Status

Accepted. Implemented across PR 1A (tenancy + env-singleton removal, this commit) and PR 1B (binder authority + registry-fallback removal, follow-up commit) of the stale-code-removal program.

## Context

A platform audit (2026-05-10) found three load-bearing fallback paths that masked real failures rather than surfacing them:

1. **Env-driven tenant singleton.** `getTenantConfig()` and `resolveOperatingTenant` middleware silently defaulted to a process-wide config built from `DEFAULT_REGION_CODE` / `TENANT_SLUG` / `DEFAULT_COUNTRY` / etc. when no per-request slug resolved. Any HTTP/worker code that escaped the per-request tenancy plumbing — for example by running before middleware or after a slug lookup miss — still returned a `TenantConfig`. In a multi-tenant deploy that meant requests for one tenant could complete with another tenant's branding, IPT, and `operatingTenantId` stamp.
2. **Synthetic binder authority.** `assertBinderAuthorizesProduct` returned a record with `authorityId: 'synthetic-nonstrict'` and `status: 'SYNTHETIC'` whenever `STRICT_BINDER_PRODUCT_AUTHORITY` was unset. Bind/program assignment could succeed with no `BinderProductAuthority` row at all. The Lloyd's-grade authority gate was opt-in.
3. **Embedded policy-list-registry fallback.** When the canonical `policies/list/registry.json` file was missing from the build context, `getPolicyListRegistry()` silently swapped in a TypeScript `FALLBACK_POLICY_LIST_REGISTRY` constant — masking deployment-image misconfiguration.

All three patterns share the same anti-pattern: **make the failure invisible at runtime**. The audit's HIGH category called them existential risks; this ADR encodes the corrected posture.

## Decision

The platform fails closed on tenant identity, binder authority, and policy-list registry presence. There is no env-singleton or synthetic fallback in production code paths.

### Tenancy (PR 1A)

1. **`getTenantConfig()` is ALS-only.** Calling it outside an ALS context throws `TenantNotResolvedError` (defined in `backend/platform/tenant/tenantConfig.ts`). The previous in-process env-driven cache (`_cache`) and `resetTenantConfigCache()` API are deleted.
2. **CLI / worker / system-outbox entrypoints** materialise an explicit tenant via `buildTenantConfigFromEnv()` (new in `backend/platform/tenant/tenantConfigForCli.ts`) and wrap their work with `runWithOperatingTenant(...)`. This is the **only** place in the codebase that may read tenant identity from `process.env`.
3. **`resolveOperatingTenant` middleware** fails closed on resolution miss: `403 TENANT_UNRESOLVED` when no slug resolves from JWT/header/host/env, `404 TENANT_UNKNOWN` when the slug doesn't match a `Tenant` row. The previous "seed ALS with env singleton" branches at lines 168–183 are deleted.
4. **`backend/modules/programs/app/bootstrap.ts`** uses `buildTenantConfigFromEnv()` for the once-per-deploy program seed. **`backend/platform/utils/platformIds.ts`** keeps reading `process.env.TENANT_SLUG` and `process.env.DEFAULT_REGION_CODE` directly at module-load (single-tenant ID-prefix assumption tracked as a separate multi-tenant follow-up). `backend/modules/communications/domain/notifications/emailInfra.ts` is in the same boat. Both are explicitly allowlisted in `tools/quality/deleted-identifiers.json`.
5. **Tests.** A vitest setup hook (`frontend/src/shared/test/setup.ts`) installs a default CY tenant ALS for the test worker via `enterOperatingTenantForTest`. Tests that need to assert the fail-closed branch wrap with `withoutOperatingTenantForTest(fn)`. Tests that need a different tenant nest a `runWithOperatingTenant(otherTenant, fn)`. Production code is unaffected because it doesn't load the test setup file.

### Binder authority (PR 1B — locked by this ADR)

1. **Strict by default, no opt-out.** `assertBinderAuthorizesProduct` always throws `BinderAuthorityError` when no matching `BinderProductAuthority` row exists. The `isStrict()` env check, the synthetic-result branch, and the `STRICT_BINDER_PRODUCT_AUTHORITY` env var are deleted.
2. **No legacy-COB fallback in reporting.** `resolveBinderProductReporting` propagates the underlying authority failure. The `try/catch` + `legacyScalar || productCode` reporting fallback is deleted; BDX/reporting paths that need an explicit override go through an authority row, not an env knob.
3. **Transitional comment removed.** `backend/modules/policy/http/mutationsRouter.ts` lines 192–194 (which described the non-strict synthetic behaviour) is removed in PR 1B alongside the code it described.

### Policy-list registry (PR 1B)

1. **`getPolicyListRegistry()`** throws when the canonical JSON file is absent. The `FALLBACK_POLICY_LIST_REGISTRY` embedded constant and its branch in `backend/modules/policy/infra/projections/policyListRegistry.ts` are deleted. Startup validation (`backend/platform/config/startupValidation.ts`) already exercises this loader so a missing file fails the boot health check, not a downstream user request.

## Consequences

- **Tenant identity is unambiguous in every async stack.** A code path that runs without ALS surfaces as `TenantNotResolvedError` immediately, not as a silently-attributed cross-tenant write.
- **Binder authority is regulated.** `Policy.binderId` ↔ `Policy.productType` writes can only succeed when an authoritative row exists.
- **Deployment-image health is observable.** A missing `policies/list/registry.json` fails the pod's `validateStartupConfig` instead of degrading per-request behaviour.
- **CI refusal.** A new generic guard, `tools/quality/check-no-deleted-identifiers.mjs`, refuses re-introduction of any deleted identifier (e.g. `STRICT_BINDER_PRODUCT_AUTHORITY`, `FALLBACK_POLICY_LIST_REGISTRY`, `runWithOperatingTenant(getTenantConfig()`, etc.) outside an explicit allowlist. A self-test (`tools/quality/__tests__/check-no-deleted-identifiers.test.mjs`) verifies the regexes actually match the things they ban.
- **Operational migration.** `STRICT_BINDER_PRODUCT_AUTHORITY` and prod `TENANT_SLUG` are removed from K8s manifests + `.env.example` (CLI/test envs keep `TENANT_SLUG` for `buildTenantConfigFromEnv()`). Staging shadow-mode review of `unknown tenant slug` warn metric must be zero before cy4 cutover.

## Alternatives considered

- **Keep the env-singleton fallback under a flag.** Rejected. A flag is just a deferred deletion; the audit's principle is "delete escape hatches, encode the refusal in CI". Any code path that legitimately needs an env-derived tenant lives in `tenantConfigForCli.ts`.
- **Allowlist the env-singleton call sites.** Rejected. The whole point of the change is to remove the silent attribution. Allowlisting recreates the same risk under a different label.
- **Default-strict `STRICT_BINDER_PRODUCT_AUTHORITY=1` but keep the env knob for emergencies.** Rejected. The right "emergency" channel is a backfill that creates the missing `BinderProductAuthority` row, not a flag that lets writes proceed unauthorised.

## Migration plan

PR 1A (this commit):

1. Delete env-singleton + cache from `tenantConfig.ts`; introduce `tenantConfigForCli.ts`.
2. Replace `getTenantConfig()` callers in CLI / system / bootstrap with `buildTenantConfigFromEnv()`.
3. Make `resolveOperatingTenant` fail closed.
4. Author + wire the `check-no-deleted-identifiers` guard with self-test.
5. Update tests to use `withoutOperatingTenantForTest` for the fail-closed assertions; install a default CY tenant in the vitest setup file.
6. Update `tenancy.md` to reflect the new posture.
7. Amend `ADR-0005` (ledger module deferred, not stubbed) and delete the empty `backend/modules/ledger/` tree.

PR 1B (follow-up commit, deploy ≥48h after PR 1A is green in production):

1. Delete synthetic authority branches + legacy-COB reporting fallback in `binderAuthority.ts`.
2. Delete `FALLBACK_POLICY_LIST_REGISTRY` in `policyListRegistry.ts`; require the canonical JSON.
3. Add the binder/registry rows to `tools/quality/deleted-identifiers.json`.
4. Remove the transitional comment in `mutationsRouter.ts` lines 192–194.
5. Remove `STRICT_BINDER_PRODUCT_AUTHORITY` from K8s manifests and `.env.example`.

## Links

- Plan: `aggressive-stale-code-deletion` PR 1A + PR 1B
- Sister contracts: [tenancy.md](../contracts/tenancy.md) · [canonical-ownership.md](../contracts/canonical-ownership.md) "Binder / program authority" row
- Companion guard: `tools/quality/check-no-deleted-identifiers.mjs`
- Existing guard extended: `tools/quality/check-no-default-tenant-fallbacks.mjs`
