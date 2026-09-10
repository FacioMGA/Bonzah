---
title: File size
audience: developer
status: living
owner: platform-eng
reviewed: 2026-08-14
binding: true
---

# File size

## Threshold

ESLint `max-lines` warns at **600 effective lines** (counts skip blank
lines and comments). Stage A of the ratchet is documented in
[ADR-0020](../architecture/decisions/ADR-0020-file-size-ratchet.md);
Stage B promotes the rule to `error` once the existing long tail
drains.

## Why

A 1000-line file is not an architectural choice. It is the absence of
an architectural choice. The ratchet exists because:

- Splitting after the fact (under canonical-ownership pressure) is
  significantly more expensive than refusing to merge a god-file
  in the first place.
- Files over the cap are nearly always hiding multiple concerns —
  per-section field tables in a mapper, per-handler bodies in a
  router, per-stage steps in a CLI script. Each concern is a real
  seam waiting to be named.

## How to split

Identify the **canonical concept** the file owns. Split that concept
into its natural seams (per-section mappers, per-handler subrouters,
per-stage pipelines, etc.). The parent file becomes a thin composer
that re-exports the public surface so consumers do not change their
imports. This is exactly the pattern used in PR 2.2 / 2.3 of the
errors-and-warnings cleanup:

- [`backend/modules/reporting/domain/bordereaux/lloydsV52.ts`](../../backend/modules/reporting/domain/bordereaux/lloydsV52.ts)
  composes `lloydsV52/{types,csv,columns,metadata,validation,fetchRows}.ts`
- [`backend/modules/reporting/domain/crsV52Motor.ts`](../../backend/modules/reporting/domain/crsV52Motor.ts)
  composes `crsV52Motor/{types,helpers,riskColumns,premiumColumns,claimsColumns,buildRow}.ts`
- [`backend/seed.ts`](../../backend/seed.ts) composes
  `seed/{context,helpers,binders,exampleAndClaimPolicies,renewalAndDemoLanes,reporting}.ts`
- [`backend/modules/auth/http/authRouter.ts`](../../backend/modules/auth/http/authRouter.ts)
  composes `authRouter/{helpers,loginRoute,emailOtpRoutes,passwordResetRoutes,signupRoute}.ts`

## Forbidden

- Splitting purely to satisfy the cap. Every split must respect the
  contract-spine rule (one canonical owner per concept). If you cannot
  name the seam, the file is not yet ready to split.
- `/* eslint-disable max-lines */` in code files. Permitted **only**
  for canonical data-spec tables that have no meaningful internal
  seam; each disable must carry a one-line justification.

## Escalation

If a file genuinely needs to grow past 600 effective lines, open an
ADR amending ADR-0020. The default answer is "split it."
