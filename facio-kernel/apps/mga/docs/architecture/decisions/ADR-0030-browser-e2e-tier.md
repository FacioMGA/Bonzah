---
title: ADR-0030 browser E2E tier
audience: architect
status: draft
owner: platform-eng
reviewed: 2026-05-20
binding: false
---

# ADR-0030: Browser E2E tier (tier 5) for customer wizards

## Status

Proposed. Lands post-UAT — see [docs/develop/test.md](../../develop/test.md) tier 5 row.

## Context

The four binding test tiers in [test.md](../../develop/test.md) prove
contract shapes, adapters, multi-step domain workflows, and the
golden-path quote → bind → issue smoke at the API level. None drive
the customer-facing wizards through a real browser. The
[pre-deploy smoke checklist](../../operate/pre-deploy-smoke-checklist.md)
flags this gap explicitly: items 1–9 (driver coverage, vehicle-cover
default, motor / travel / home wizard regressions, post-purchase
redirect ABY-238) "cover none of these dynamic flows" through unit
tests, and Playwright "is not installed yet."

This ADR introduces tier 5 — a thin browser-driven E2E layer that:

1. Maps **1:1** to pre-deploy-smoke-checklist items 1–9.
2. **Complements**, never replaces, the tier 4 migration-lock smoke.
3. Runs against a seeded test tenant via
   [tenantResolution.ts](../../../backend/platform/tenant/tenantResolution.ts) —
   no surface bypass, no auth shortcut into `client`.

## Decision

Add a fifth tier to the binding strategy:

| # | Name | Time | Proves | Lives in | Command |
|---|---|---|---|---|---|
| 5 | `browser-e2e` | < 5 min | Customer wizard happy path + post-purchase redirect | `e2e/browser/` | `npm run test:browser:e2e` |

- Runner: `@playwright/test`. Single browser project (Chromium) by
  default; Firefox / WebKit opt-in via env.
- Specs (4 files, 1 per checklist group):
  - `motor-wizard.spec.ts` — checklist items 1–3.
  - `travel-wizard.spec.ts` — checklist items 5–7.
  - `home-wizard.spec.ts` — checklist item 8.
  - `post-purchase-redirect.spec.ts` — checklist items 4 + 9 (ABY-238).
- Fixtures provision a deterministic CY test tenant, a clean
  publicSessionToken, and stub CardCorp via the existing test-mode
  payment flag.
- No `waitForTimeout` (flakiness amplifier); use `data-testid` hooks
  on wizard nav buttons + `expect.toPass` polling on readiness.

## Tenancy contract

Browser specs MUST resolve their tenant through the same path as
production:

- `seed.ts` provisions the CY test tenant up-front (already done by
  `db:seed`).
- Spec fixtures call `runWithOperatingTenant(cyTenant, ...)` only in
  setup helpers that mirror what `tenantResolutionMiddleware` does in
  the API. Specs themselves drive the browser; the seed runs server-side.
- Forbidden: bypassing `tenantResolution.ts` or assuming a default
  tenant via env.

## Surfaces contract

The post-purchase redirect spec crosses the `public → client` surface
boundary. Per [surfaces.md](../contracts/surfaces.md):

- Specs do NOT auth-bypass into `client`. The customer signs up /
  verifies email through the real `/verify-email` OTP path (DASHBOARD_ACCESS
  OTP); the spec uses a deterministic OTP fixture exposed by the seed.
- The `client` surface bundle remains free of BO symbols
  (`proof:public-bundle-isolation`) — Playwright loads the same bundle
  the customer loads in staging.

## Tier 4 remains the migration lock

`smoke:quote-bind-issue` (tier 4) stays untouched and still gates
every release. Tier 5 is a customer-facing UX regression net layered
on top — if Playwright fails but tier 4 passes, the API contract is
intact and the failure is wizard-level (forms, navigation, copy).

## Consequences

- `package.json` gains `@playwright/test` (dev), `test:browser:e2e`,
  and a `browser_e2e` stage in [run-quality-gate.mjs](../../../tools/quality/ci/run-quality-gate.mjs)
  after `build_api`.
- CI provisions the Playwright browser image; staging-like and
  pre-deploy gates pick the same image.
- [pre-deploy-smoke-checklist.md](../../operate/pre-deploy-smoke-checklist.md)
  marks items 1–9 as "automated when green"; item 10 (Sentry 5-min
  watch) remains manual.

## Out of scope

- Cross-browser matrix (defer to a later ADR; Chromium-only at first).
- Visual regression / pixel diff (Playwright trace + screenshots are
  for failure triage only, not pass/fail).
- FNOL browser coverage (follow-up; wizard tier-1 + clientFnol.submit
  tests already cover its happy path).

## Links

- [docs/develop/test.md](../../develop/test.md) (tier table)
- [docs/operate/pre-deploy-smoke-checklist.md](../../operate/pre-deploy-smoke-checklist.md)
- [docs/architecture/contracts/tenancy.md](../contracts/tenancy.md)
- [docs/architecture/contracts/surfaces.md](../contracts/surfaces.md)
- ADR-0028, ADR-0029 (the canonical typed-handler pair this ADR builds on).
