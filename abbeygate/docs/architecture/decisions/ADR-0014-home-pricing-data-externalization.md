---
title: ADR-0014 Home pricing data externalization
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-09
binding: true
closed: 2026-05-10
---

# ADR-0014: Home pricing data externalization

## Status

**Closed (2026-05-10).** Accepted, fully implemented, no follow-ups
outstanding. The frontmatter `status` stays `living` because the
docs-frontmatter guard restricts the field to a fixed enum
(`living | archived | draft | reference`); the dedicated `closed:`
key + the prose below carry the closure record.

PR7 of the program landed the JSON
+ zod + loader (commit `e7b83a7d`). PR 5 of the stale-code-removal
program closed the ADR by:

- Migrating the last consumer (`backend/products/home/pricing/homeCalculator.ts`)
  off the `homeRateCards.ts` re-export shim onto `data/loader.js`.
- Deleting the shim file.
- Removing the `isPureReExportShim` exemption from
  `tools/quality/check-no-inline-rate-tables.mjs` (no shim left to
  exempt).
- Adding the `home-rate-cards-import` row to
  `tools/quality/deleted-identifiers.json` so the legacy import path
  cannot be resurrected without an explicit ADR amendment.

## Context

`docs/architecture/contracts/canonical-ownership.md` mandates that product rate
tables live as JSON + zod schema + loader under
`backend/products/<product>/pricing/data/`, not as inline TypeScript literals.
Motor already complies (`backend/products/motor/pricing/data/abbeygate-auto-cyprus-2022.{json,schema.ts,loader.ts}`)
and `tools/quality/check-no-inline-rate-tables.mjs` enforces the rule for motor.

Home pricing currently violates the rule: rate cards (Spain, Portugal, …) are
declared as large `const` objects in `backend/products/home/pricing/homeRateCards.ts`.
This is the same artifact class the contract forbids; it just hasn't been swept
yet. Travel scaffolding is symmetric with home and will need the same treatment
when it grows real rate tables.

## Decision

1. Extract every per-jurisdiction home rate card from
   `backend/products/home/pricing/homeRateCards.ts` to a JSON file under
   `backend/products/home/pricing/data/<jurisdiction>-<vintage>.json`. One file
   per (jurisdiction, vintage) pair so rates can be rotated atomically.
2. Author a sibling zod schema (`backend/products/home/pricing/data/home-rates.schema.ts`)
   that validates the structure and exports the matching TypeScript types.
3. Author a sibling loader (`backend/products/home/pricing/data/loader.ts`) that
   reads the JSON, validates against the schema, deep-freezes the result, and
   caches it. The loader is the only legal consumer-facing entry point; callers
   import from the loader, never from the JSON or schema directly.
4. Update `backend/products/home/pricing/homeCalculator.ts` to call the loader.
   Delete `homeRateCards.ts` once no consumers remain.
5. Extend `tools/quality/check-no-inline-rate-tables.mjs` to cover
   `backend/products/home/pricing/` (and `travel/pricing/` once travel rate
   tables exist) so the prior pattern cannot return.
6. Update the "Product rate tables" row in
   `docs/architecture/contracts/canonical-ownership.md` to reference home and
   travel alongside motor.

## Consequences

- **Behavior:** rate computation is unchanged; this is a pure relocation. The
  same numbers, validated by the same schema constraints, return from the loader.
- **Operational:** rate rotations now happen in a JSON file diff and pass through
  the canonical schema before reaching the calculator. Reviews catch shape
  drift mechanically.
- **Tenant / jurisdiction parity:** when a new jurisdiction lands, only a new
  JSON file is added; no TypeScript changes required.
- **Migration:** PR7 ships the move in a single PR. Rollback is a `git revert`;
  no data migration involved.

## Alternatives considered

- **Per-jurisdiction TS modules.** Rejected: still inline literals, still fails
  the canonical-ownership rule, and creates per-product import surfaces that
  the guard cannot reason about.
- **Database-backed rate tables.** Out of scope; no current need to mutate
  rates outside a release. A future ADR can introduce DB-backed overrides for
  emergency rate adjustments without invalidating this decision.

## Links

- Canonical-ownership contract: [canonical-ownership.md](../contracts/canonical-ownership.md)
- Inline rate tables guard: `tools/quality/check-no-inline-rate-tables.mjs`
- Plan: `aggressive-stale-code-deletion` PR7
