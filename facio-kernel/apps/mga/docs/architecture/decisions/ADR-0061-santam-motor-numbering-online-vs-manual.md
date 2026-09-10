---
title: ADR-0061 Santam-branded Motor numbering with online-vs-manual streams
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-05
binding: true
---

# ADR-0061: Santam-branded Motor numbering with online-vs-manual streams

## Status

Accepted. Amends ADR-0047 (carrier-branded, product-scoped numbering), which
itself amends ADR-0034. The canonical owner (`platformIds.ts`), the single
formatter rule, the global `@@unique([policyNumber, renewalSequence])`
constraint, and the "recognise via `isReservedQuoteId` / `isReservedPolicyNumber`"
rule all still stand. This ADR (a) adds a Motor/Santam scheme and (b) introduces
one new axis — issue **origin** — to the reservation path.

## Context

Motor on Facio is written on the Santam binder (CY, PT, ES — Santam does not yet
permit Greece). Peter (Aug 2026) requires Santam-branded, product-distinct
numbers, and — new — **two policy-number streams** distinguished by how the
policy was created:

- Online sales (customer completes the public quote and pays): start `5000100`
- Manually entered (operator keys the policy in the back office): start `1000100`

Both streams share one visible format. Cyprus carries no country token; PT/ES do:

```
Country  Online policy       Manual policy       Quote (online only)
CY       AB/ST/5000100       AB/ST/1000100       Q/1000100
PT       AB/ST/PT/5000100    AB/ST/PT/1000100    Q/PT/1000100
ES       AB/ST/ES/5000100    AB/ST/ES/1000100    Q/ES/1000100
GR       — (not permitted)   —                   —
```

Two things the ADR-0047 spine could not express:

1. **Origin axis.** The only reservation axis was `POLICY` vs `QUOTE`. Two policy
   streams on one product/tenant needs a third input.
2. **CY drops the country token.** ADR-0034/0047 always embed the country code.
   Santam is the sanctioned exception (CY is the home market; PT/ES are marked).

## Decision

### 1. Motor/Santam schemes in the registry

Add `MOTOR` schemes to `policyNumberScheme.ts` (the data-only registry consumed
only by `platformIds.ts`):

- **Policy — online**: `AB/ST/[<CC>/]<SEQ>`, start `5000100`, counter key suffix
  `AB/ST/ONLINE`.
- **Policy — manual**: `AB/ST/[<CC>/]<SEQ>`, start `1000100`, counter key suffix
  `AB/ST/MANUAL`.
- **Quote**: `Q/[<CC>/]<SEQ>`, start `1000100`, counter key suffix `Q`. Quotes are
  online-only; manual entries go straight to a policy number with no quote.

`<CC>` is omitted for CY and present for PT/ES. `SEQ` is 7-digit zero-padded, so
lexicographic order on `policyNumber` still matches numeric order (the floor-scan
guarantee ADR-0034 relies on).

### 2. Origin is a reservation input, not a call-site branch

`reserveNextPolicyId(tx, productType, origin)` takes an `IssueOrigin`
(`'ONLINE' | 'MANUAL'`, default `'ONLINE'`). The origin selects the stream's
start sequence and per-tenant counter key; it does **not** change the emitted
format (both streams read `AB/ST/…`). Products without a Santam scheme ignore
`origin` entirely, so Home/Travel/Health are unaffected.

Call sites pass origin from what they already know — no `if (productCode …)`
branch:

- `cardcorpPolicyIssuanceService` (customer paid online) → `ONLINE`.
- `BindPolicy`, `v1PoliciesRouter` (operator-driven bind) → `MANUAL`.
- `CreateFromQuote` → origin by actor: a `CUSTOMER` self-onboarding (incl. an
  immediate `paid` issuance) is `ONLINE`; an operator-entered policy is `MANUAL`.

### 3. Two streams, one prefix — floored by numeric band

Because online (`5,000,100+`) and manual (`1,000,100+`) share the `AB/ST/`
prefix, each stream's reservation floor scans only its own numeric band
(`gte`/`lt` bounds on `policyNumber`, valid because the sequence is fixed-width).
This keeps the manual counter from being dragged up to the online range by an
existing online row, and vice-versa.

### 4. No renaming of existing rows

Existing Motor rows keep their `ABOLV`/`ABQ` numbers forever (a number changes
only when a term ends and a new contract is issued). The canonical predicates
recognise old (`ABOLV`/`ABQ`) and new (`AB/ST/…`, `Q/…`) shapes so lifecycle
detection still works across both.

## Forbidden

- A policy/quote number built outside `formatPolicyId` / `formatQuoteId` /
  `reserveNext*`.
- Deriving online-vs-manual from the number's numeric range anywhere; origin is
  an explicit input at reservation time, then persisted as the row itself.
- Per-product `if (productCode === 'MOTOR')` branches at call sites; the branch
  lives once, as data, in the scheme registry.
- Adding a Santam quote number to a manually-entered policy.

## Migration plan

1. **Schema:** none. The new formats fit `policyNumber`; the unique constraint
   stays global.
2. **Code:** add Motor schemes + `IssueOrigin` to `policyNumberScheme.ts`; make
   `reserveNextPolicyId` / `generatePolicyId` origin-aware; band-aware floor in
   `reserveNextBrandedNumber`; pass origin from the four issuance call sites.
3. **Docs:** update the numbering row in `canonical-ownership.md`.
4. **Tests:** extend `platformIds.test.ts` with Santam online/manual/quote and
   CY-no-code / PT-with-code cases.

## Links

- ADR-0034 — multi-tenant policy-number namespace
- ADR-0047 — carrier-branded, product-scoped numbering (amended here)
- ADR-0060 — motor market integrations (Segurnet/FIVA) — unrelated to numbering
- `backend/platform/utils/platformIds.ts` — single owner of policy/quote numbers
- `backend/platform/utils/policyNumberScheme.ts` — scheme registry (this ADR)
- `docs/architecture/contracts/canonical-ownership.md` — numbering row
