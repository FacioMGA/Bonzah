---
title: ADR-0088 BO policy creation authority and legacy repair
audience: architect
status: living
owner: policy-platform
reviewed: 2026-08-30
binding: true
---

# ADR-0088: BO policy creation authority and legacy repair

## Context

BO creation accepted a product-less draft. It therefore could not select a
canonical Program–Binder pair, leaving drafts unable to rate or send.

## Decision

1. BO `POST /api/policies` requires an operator-selected `productType`.
   Inside its creation transaction it calls
   `findLatestActiveBinderLinkForProduct(productType, inceptionDate)` and
   persists that exact pair plus the authority snapshot mirrors. No eligible
   pair is a `NO_ACTIVE_BINDER` refusal before any policy write.
2. Existing BO DRAFT rows are repaired only by the registered operator
   preview/confirmation tool. Its preview reports affected, safe, and skipped
   counts; its single-use token is required for an explicit commit.
3. The repair considers only BO-origin DRAFT policies with a known product and
   a missing policy authority field. It resolves through the same canonical
   function at the policy inception date, fills only missing matching authority
   fields and snapshot mirrors in one transaction, and skips missing,
   conflicting, or ineligible configuration. It never infers a product or
   creates/changes Program, Binder, link, or authority configuration.

## Consequences

- No creation fallback, startup repair, migration, or worker may assign a
  binder/program implicitly.
- Operators must inspect the preview and confirm the scoped repair; each
  committed row is auditable and idempotent.
- Configuration or inconsistent legacy data remains a visible skipped result
  for explicit remediation.

## Links

- `policy/app/binders/binderAuthority.ts`
- ADR-0019 · ADR-0081 · `docs/operate/database-migrations.md`
