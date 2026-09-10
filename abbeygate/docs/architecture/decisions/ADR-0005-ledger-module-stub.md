---
title: ADR-0005 Ledger module — planned, intentionally absent
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-09
binding: true
---

# ADR-0005: Ledger module — planned, intentionally absent

## Status

Accepted. Amended 2026-05-10 to remove the empty-stub prescription (PR 1A of the stale-code-removal program). The `backend/modules/ledger/` directory is intentionally absent from the repo until real ledger code lands.

## Context

The target architecture includes `backend/modules/ledger/` as a canonical business domain. The platform does **not** implement a shared double-entry ledger today. Claims financials are modelled through an event-driven worksheet; billing, invoicing, CardCorp payment processing, and reconciliation live in `modules/payments/` and related policy financial flows.

The earlier decision was to keep `backend/modules/ledger/` as an **explicit empty stub** so the module appeared in dependency graphs and conformance reports. In practice the empty `domain/` + `app/` directories with `.gitkeep` files only created false architectural confidence: contributors saw a folder, assumed there was something there, and the stub itself imposed no contract or guard. Stubs are useful when they protect imports, contracts, or migration sequencing — none of which applied here.

## Decision

The `ledger` module is **planned and deferred**, not stubbed. The repo says so plainly:

- No `backend/modules/ledger/` directory exists.
- The generated module inventory at `docs/reference/modules.md` does not list `ledger`.
- No production code imports anything from `modules/ledger/...`.

When real ledger code lands:

1. The first PR creates `backend/modules/ledger/` with at least one substantive file (a domain type or use case), not a `.gitkeep`.
2. That PR adds a row to the canonical-ownership map naming the ledger as the owner of whatever concept it now governs (e.g. double-entry transaction records, settlement tracking).
3. CHAMPS architecture-conformance and module-delegation guards pick it up automatically; no manual guard work is required to "register" the module.

Until that PR, financial logic continues to live across `modules/payments/`, `modules/policy/app/billing/`, and the claims worksheet, as the codebase already reflects.

## Consequences

- The architecture description matches reality: contracts describe **enforced** state, not aspirational folders.
- Onboarding documentation no longer suggests editing or extending an empty stub.
- The `docs/reference/modules.md` row regenerates automatically when ledger code lands.
- ADR-0010's "code and docs disagree" rule is observed — the doc-vs-code drift the empty stub created is removed.

## Migration / cleanup

PR 1A of the stale-code-removal program:

- Deleted `backend/modules/ledger/domain/.gitkeep`, `backend/modules/ledger/app/.gitkeep`, and the empty parent directories.
- Re-ran `npm run docs:generate` so the generated module inventory drops the `ledger` row.
- Amended this ADR.

No code or test changes were required: zero modules imported anything from `modules/ledger/`.

## Links

- Plan: `aggressive-stale-code-deletion` PR 1A
- Companion guard for the same program: `tools/quality/check-no-deleted-identifiers.mjs`
- Generated inventory (auto-updated): `docs/reference/modules.md`
