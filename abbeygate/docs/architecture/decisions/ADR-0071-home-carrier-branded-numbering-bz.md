---
title: ADR-0071 Home carrier-branded numbering (BZ)
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-14
binding: true
---

# ADR-0071: Home carrier-branded numbering (BZ)

## Status

Accepted. Extends ADR-0047 (carrier-branded, product-scoped numbering), which
amends ADR-0034. The canonical owner (`platformIds.ts`), the single formatter
rule, the global `@@unique([policyNumber, renewalSequence])` constraint, and the
"recognise via `isReservedQuoteId` / `isReservedPolicyNumber`" rule all still
stand. This ADR adds one product scheme (Home) and makes a registry entry's
branded QUOTE scheme optional.

## Context

Home was absent from the branded registry, so it fell to the ADR-0034 default
`ABOLV/<CC><SEQ>`. Danny's first issued Home policy therefore read
`ABOLV/CY…`. Peter/Danny (2026-08-14) require the carrier-branded Home prefix
`BZ` (LV is the Motor scheme; `ABOLV` is the generic default, not a motor code).

Only the issued POLICY number is branded. Home quotes stay on the default
`ABQ/<CC><SEQ>` — the default already prefixes quotes (`ABQ`) and policies
(`ABOLV`) differently, so leaving Home quotes on `ABQ` while branding the policy
`BZ` is consistent with existing behaviour, not a regression.

## Decision

### 1. Home policy scheme in the registry

Add a `HOME` entry to `policyNumberScheme.ts` (the data-only registry consumed
only by `platformIds.ts`):

- **Policy**: `BZ/<CC><SEQ>` e.g. `BZ/CY5000001`, start `5000001`, counter key
  suffix `BZ`. Country code is concatenated directly onto the 7-digit
  zero-padded sequence, mirroring the ADR-0034 default layout with the carrier
  prefix. `<CC>` is `CY`, `PT`, etc. (always present).
- **Quote**: none. Home keeps the ADR-0034 default `ABQ/<CC><SEQ>`.

`SEQ` is 7-digit zero-padded, so lexicographic order on `policyNumber` matches
numeric order (the floor-scan guarantee ADR-0034 relies on).

### 2. Optional branded QUOTE

`ProductSchemes.QUOTE` becomes optional. `getBrandedNumberScheme(_, 'QUOTE')`
returns `null` for a product with no branded quote scheme, so the default path
in `formatQuoteId` / `reserveNextQuoteId` applies. `matchesBrandedNumber` skips a
missing QUOTE entry. Travel/Health/Motor are unchanged (they keep their branded
quotes).

### 3. No renaming of existing rows

Already-issued `ABOLV/…` Home rows keep their number forever (Lloyd's bordereaux
identity, ADR-0056). The canonical predicates recognise both the old (`ABOLV`)
and new (`BZ/…`) shapes so lifecycle detection works across both. Any bulk
renumber of existing Home policies is a separate, audited, backed-up migration
with bordereaux reconciliation sign-off — out of scope here.

## Forbidden

- A policy number built outside `formatPolicyId` / `reserveNextPolicyId`.
- A per-product `if (productType === 'HOME')` branch at a call site; the branch
  lives once, as data, in the scheme registry.
- Renaming existing `ABOLV` Home rows as a side effect of this change.

## Migration plan

1. **Schema:** none. `BZ/<CC><SEQ>` fits `policyNumber`; the unique constraint
   stays global.
2. **Code:** add the `HOME` scheme + optional QUOTE to `policyNumberScheme.ts`.
3. **Tests:** extend `platformIds.test.ts` with Home `BZ/CY…` / `BZ/PT…` policy
   and `ABQ` quote-default cases; recognise `BZ/…` in `isReservedPolicyNumber`.

## Links

- ADR-0034 — multi-tenant policy-number namespace
- ADR-0047 — carrier-branded, product-scoped numbering (extended here)
- ADR-0056 — BDX import identity (why existing rows are not renamed)
- `backend/platform/utils/platformIds.ts` — single owner of policy/quote numbers
- `backend/platform/utils/policyNumberScheme.ts` — scheme registry (this ADR)
