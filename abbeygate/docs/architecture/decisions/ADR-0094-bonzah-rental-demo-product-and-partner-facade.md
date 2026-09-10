---
title: ADR-0094 Bonzah rental demo product and partner facade
audience: architect
status: living
owner: product-platform
reviewed: 2026-09-03
binding: true
---

# ADR-0094: Bonzah rental demo product and partner facade

## Context

The Bonzah demonstration needs vehicle-aware rental protection in a fictional
partner checkout plus a Postman-visible partner API. Personal Motor models an
owned vehicle and is not the correct authority for short-term rental cover.

## Decision

Add `RENTAL` as a product-owned manifest, validation profile and runtime adapter.
Compose Summit Rentals inside the existing public surface. Public and partner
HTTP adapters call the same rental quote application service and rated snapshot
store. The partner facade is demo-only and uses a scoped bearer token plus
partner and idempotency headers; it fails closed in production unless enabled.

Rates, eligibility, payment and binding are synthetic. API responses and the
presenter view label this explicitly; the customer checkout omits simulation labels.
No Insillion, carrier, bank, payment-provider or production-data integration is
implied. A future production integration requires a separate ADR and contract.

## Consequences

Rental rules stay outside shared and Motor code. Postman can retrieve the exact
quote created by the browser. The in-memory store is suitable only for this
focused demo and is replaced by canonical policy persistence before production.

## Presenter operation

Open `/summit-rentals?presenter=1` before starting the journey. Integration details
captures up to 100 real public-adapter requests, responses, timings and HTTP statuses
in browser memory. Normal `/summit-rentals` has no presenter controls or capture.
The query flag is a presentation switch, not authentication; it exposes only traffic
available to that browser and never partner credentials. Reload clears the capture.
Download JSON exports the captured traffic, including accurate simulation metadata.
Retrieve current quote records a fresh public GET. Use the exported quote ID and
`summit-rentals-demo` partner ID in Postman to retrieve the same canonical snapshot.
Export contains quote/bind data; renter contact fields are not sent by this contract.
Present the customer journey first, then expand quote and bind JSON and download it.
Export is preparation for sharing; it does not send data to clients automatically.

## Links

- `packages/products/src/rental/manifest.ts`
- `backend/products/rental/runtime.ts`
- `backend/modules/bonzah/`
