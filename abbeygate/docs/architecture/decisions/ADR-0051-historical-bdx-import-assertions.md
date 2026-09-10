---
title: ADR-0051 Historical BDX import assertions
audience: architect
status: living
owner: platform-eng
reviewed: 2026-07-16
binding: true
---

# ADR-0051: Historical BDX import assertions

## Status

Accepted for go-live BDX import.

## Context

June 2025-June 2026 Lloyds BDX files for Beazley Home and Britt Travel are
already-issued legacy policies, not new customer quote submissions. The Lloyds
v5.2 rows carry policy identity, dates, premiums, residence/risk location and
traveller/property data, but not every wizard-only answer added later to the
canonical Home and Travel profiles.

The import spine re-rates and issues through `IProductAdapter.buildQuoteResponse`;
therefore imported rows must still produce canonical quote data. Silently
filling missing required fields would violate the validation contract, while
rejecting all historical rows blocks go-live.

## Decision

1. **Canonical owner.** Historical import reconstruction lives only in the
   per-product BDX mappers under
   `backend/modules/reporting/app/bdxImport/productMappers/`.
2. **Travel assertion.** Britt/AbbeyTravel BDX rows with no nationality or
   residence-duration cells are reconstructed with an explicit
   `bdxImportAssertions.profile = BDX_HISTORICAL_TRAVEL_LLOYDS_V52_BRITT_2025_2026`
   and non-residence eligibility assertions needed by the Travel profile.
   Additional-traveller ID numbers missing from the legacy workbook are
   generated deterministically from `Certificate Ref + traveller index`.
3. **Home assertion.** Beazley Home BDX rows use the observed Beazley column
   layout where sums insured are in the adjacent premium-labelled columns, and
   add `bdxImportAssertions.profile = BDX_HISTORICAL_HOME_LLOYDS_V52_BEAZLEY_2025_2026`
   for wizard-only property risk answers absent from the BDX. The Home
   validation profile may skip the public-quote "start today or later" rule
   only for this historical assertion profile; the actual imported policy term
   still comes from the BDX inception/expiry dates. It may also skip the
   current new-business 20 % high-risk-items contents cap for already-issued
   rows while preserving the source sums insured for audit/import.
4. **Historical binder lifecycle.** BDX commit may bind already-issued rows to
   linked binders whose dates cover the policy inception even when the program
   link or binder is now `EXPIRED` or not yet `ACTIVE`; issue-readiness still
   enforces the binder and product-authority date windows.
5. **No generic fallback.** These assertions are bounded to historical BDX
   reconstruction. New quote, BO edit, endorsement, and public API paths remain
   governed by the normal product validation profiles.

## Consequences

- Imported policies retain an audit marker showing which fields were migration
  assertions rather than source workbook cells.
- Source workbook identity, row number and migration-compliance data remain in
  `PolicyStateCurrent.snapshot.bdxImport`.
- Future BDX files with different shapes must either map real columns or get a
  new explicit ADR/profile; they must not silently reuse this decision.

## Refused alternatives

- Defaulting missing fields without an audit marker. This is forbidden by the
  validation contract and no-defensive-fallbacks rule.
- Relaxing Home/Travel validation globally. BDX import is an ingestion consumer,
  not a new customer journey.
- Importing the rows without re-rating through the product adapter. That would
  bypass the quote-response and pricing-integrity spine.
