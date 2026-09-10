---
title: ADR-0047 Carrier-branded, product-scoped policy/quote numbering
audience: architect
status: living
owner: platform-eng
reviewed: 2026-07-01
binding: true
---

# ADR-0047: Carrier-branded, product-scoped policy/quote numbering

## Status

Accepted. Amends ADR-0034 (multi-tenant policy-number namespace). The
canonical owner, the global `@@unique([policyNumber, renewalSequence])`
constraint, and the "one formatter, no string literals" rule from ADR-0034
all stand. This ADR only widens the *format* the formatter may emit.

## Context

ADR-0034 mandated one identifier shape for every product:
`<PREFIX>/<COUNTRY_CODE><7_DIGIT_SEQ>` (`ABOLV/CY1000001`, `ABQ/CY1000001`).

For the CardCorp go-live, Peter requires the customer-facing Brit products
(Travel and Immigration Medical / Health) to carry carrier-branded,
product-distinct numbers on issued documents and correspondence:

- Travel policy: `DIRECT/BRIT/ABG/<CC>/<SEQ>`, sequence starting `5000010`
- Immigration policy: `BRIT/ABG/<CC>/IM/<SEQ>`, sequence starting `5001025`

Motor (Volante) and Home (Beazley) keep the ADR-0034 `ABOLV`/`ABQ` shape.
The single ADR-0034 format cannot express carrier tokens, a product marker,
or a per-product start sequence, so the formatter must become product-aware.

## Decision

### 1. Product-scoped number schemes

Introduce a data-only scheme registry keyed by product code
(`backend/platform/utils/policyNumberScheme.ts`) — the single source of
truth for how each product's identifier is built. Each scheme declares its
policy/quote segment prefix, country-code placement, start sequence, the
per-tenant sequence-key suffix, and the regex used to floor the reservation
sequence above existing rows. Products absent from the registry fall through
to the ADR-0034 default (`ABOLV`/`ABQ`), so Motor/Home are unchanged.

Canonical formats (`SEQ` = 7 digits, `CC` = operating-tenant country code):

```
Product     Policy                          Quote                             Start
TRAVEL      DIRECT/BRIT/ABG/<CC>/<SEQ>      DIRECT/BRIT/ABG/<CC>/Q/<SEQ>      5000010
HEALTH      BRIT/ABG/<CC>/IM/<SEQ>         BRIT/ABG/<CC>/IM/Q/<SEQ>          5001025
(default)   ABOLV/<CC><SEQ>                ABQ/<CC><SEQ>                     1000001
```

Quotes carry a `/Q` marker so a quote number is self-identifying and never
collides with the issued-policy sequence for the same product. Policy and
quote sequences are independent per-tenant counters (as in ADR-0034).

`formatPolicyId` / `formatQuoteId` / `reserveNextPolicyId` /
`reserveNextQuoteId` / `generatePolicyId` / `generateQuoteId` all take a
`productType`. The reservation floor scan is generalised to the scheme's
prefix + sequence regex instead of the hard-coded `<PREFIX>/<CC>` shape.

### 2. Canonical predicates replace prefix literals

Because a policy number no longer always starts with `ABOLV` (and a quote
no longer always starts with `ABQ`), the load-bearing
`startsWith('ABQ')` / `startsWith('ABOLV')` checks at the issuance call
sites are wrong for Brit products. ADR-0034 previously *sanctioned* those
`startsWith` prefix checks; this ADR supersedes that: the only sanctioned
way to classify an identifier is the canonical predicates
`isReservedQuoteId(value)` / `isReservedPolicyNumber(value)`, exported from
`platformIds.ts`, which recognise every scheme (old + new). Direct
`startsWith('ABQ'|'ABOLV')` and regex literals outside the formatter/
predicates remain forbidden.

### 3. No renaming of existing rows

Travel/Health are fresh namespaces; their reservation floor is the scheme
`startSeq` until the first branded row exists. Existing `ABOLV`/`ABQ`
Travel/Health rows (BDX imports, prior issuance) keep their numbers — the
predicates recognise them so lifecycle detection still works.

## Forbidden

- A second policy-number generator or format constructed outside
  `formatQuoteId` / `formatPolicyId` / `reserveNext*`.
- `startsWith('ABQ')` / `startsWith('ABOLV')` or `^AB(Q|OLV)\d+$` matching
  outside `platformIds.ts` — use `isReservedQuoteId` / `isReservedPolicyNumber`.
- Per-product `if (productCode === …)` branches at call sites; the branch
  lives once, as data, in the scheme registry.

## Migration plan

1. **Schema:** none. The branded formats fit the existing `policyNumber`
   column; the unique constraint stays global.
2. **Code:** add `policyNumberScheme.ts`; make the formatter/reservers
   product-aware; add the predicates; route the issuance call sites through
   them (`BindPolicy`, `cardcorpPolicyIssuanceService`, `v1PoliciesRouter`,
   `CreateFromQuote`, `mutationsRouter`, motor `quoteSessionOps`,
   `policyCompliance`, seeds).
3. **Docs:** update the "Policy / quote number generation" row in
   `canonical-ownership.md`.
4. **Tests:** extend `platformIds.test.ts` with the Travel/Health scheme +
   start-seq cases.

## Links

- ADR-0034 — multi-tenant policy-number namespace (amended here)
- ADR-0019 — tenancy + authority fail-closed
- `backend/platform/utils/platformIds.ts` — single owner of policy/quote numbers
- `backend/platform/utils/policyNumberScheme.ts` — scheme registry (this ADR)
- `docs/architecture/contracts/canonical-ownership.md` — numbering row
