---
title: Product-owned IPID variant selection
audience: architect
status: living
owner: platform-eng
reviewed: 2026-09-06
binding: true
---

# ADR-0099: Product-owned IPID variant selection

## Status
Accepted for the owner-authorized Annual Travel IPID implementation on 2026-09-06.

## Context
IPID selection previously accepted only the operating country. Travel offers
Single-Trip and Annual Multi-Trip, each with a different approved IPID. A country
alone cannot select the correct pre-purchase disclosure or policy attachment.

## Decision
- `IProductAdapter.resolveIpidAsset` accepts an optional typed
  `ProductIpidSelectionContext` with `quoteData?: unknown` and `variant?: string`.
  The product owns parsing its canonical quote shape and allowed variants.
- The registry passes selection context unchanged. The public IPID route accepts
  one optional `variant` string and forwards it without product-specific parsing.
- Travel resolves `single_trip` or `annual_multi_trip` from canonical
  `quoteData.trip.planType` or the explicit variant. Missing, unsupported or
  conflicting selection fails closed; no Single-Trip default is permitted.
- Travel wizard disclosure links provide the selected variant. Quote email
  attachments pass canonical quote data. The product document generator uses
  the same resolver with the immutable document-pack quote context.
- Other products retain their existing country-specific selection behavior.
- Existing issued document records and recorded asset evidence are preserved.
  New generation uses the approved variant asset; this decision does not
  authorize historical document replacement or renewal dispatch activation.

## Validation
Cover both Travel variants across public resolution, quote email and issued
packs; reject missing, invalid and conflicting selection; pin approved PDF
hashes; verify both runtime images contain the assets; retain existing product
IPID and issued-pack recovery tests.

## Links
[Products](../contracts/products.md) ·
[Canonical ownership](../contracts/canonical-ownership.md) ·
[Jurisdiction configuration](../contracts/jurisdiction-product-config.md)
