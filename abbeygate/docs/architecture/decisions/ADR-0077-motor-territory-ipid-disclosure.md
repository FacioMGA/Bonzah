---
title: ADR-0077 Motor territory IPID disclosure
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-19
binding: true
---

# ADR-0077: Motor territory IPID disclosure

## Status

Accepted.

## Context

Cyprus Motor has an approved Santam IPID, but no approved Portugal or Spain
Motor IPID is present. The issued-pack contract currently declares one global
set of required documents, so adding a Cyprus-only IPID there would either
mis-deliver it cross-territory or make PT/ES issuance incomplete.

## Decision

1. Motor IPIDs resolve from product-owned assets by tenant territory.
2. The quote surface discloses the IPID before purchase only when that tenant
   has an approved asset, through the canonical public IPID route.
3. Resolution fails closed; an IPID is never borrowed from another territory.
4. Motor IPIDs remain outside issued-policy packs until approved assets exist
   for every active Motor territory or required document sets become
   jurisdiction-aware.

## Consequences

- Cyprus customers can read the approved Santam IPID before purchase.
- Portugal and Spain show no Cyprus document and continue their existing
  issuance path.
- Adding IPIDs to issued emails requires a separately approved contract change.
