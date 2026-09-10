---
title: ADR-0046 Product channel switches gate the public journey per product
audience: architect
status: living
owner: platform-eng
reviewed: 2026-06-29
binding: true
---

# ADR-0046: Product channel switches (questions / quote / payment)

## Status

Accepted.

## Context

Abbeygate sells multiple products across the `.cy`, `.pt`, `.gr` (and `.es`)
operating tenants. For the July 1 launch, travel and immigration medical go
live fully online, while motor, home, business and open-market must be
referral-only: customers may see indicative prices but must not pay online
until the relevant approval lands (e.g. Lloyd's for motor). The team also wants
to take down the quote page, or even the questionnaire, per product without a
deploy.

There was no canonical, server-enforced way to express "this product is
purchasable / quotable / fillable on this site". `catalog.availableCountryCodes`
is a frontend-only projection, and `resolveJurisdictionProductConfig` is static
code whose contract forbids DB reads and BO mutation.

## Decision

Introduce three independent, per `(operatingTenant, product)` switches:

- `questionsEnabled` — the public may open/fill the quote wizard.
- `quoteEnabled` — the public may run rating / see a price.
- `paymentEnabled` — the public may pay online (CardCorp checkout).

They are stored in the tenant-scoped `ProductChannelSetting` table (RLS per
ADR-0019), edited from a Back Office settings screen, and read at runtime via
`resolveProductChannel(productCode)`. The backend enforces each switch at the
public chokepoints (session create, rate, checkout). The public frontend reads
a read-only projection (`GET /api/public/product-channels`) to hide gated steps
and show a referral ("request a callback") completion when payment is OFF.

A logged-in Back Office user (`BO_ROLES`) bypasses any OFF gate. Bypass is
enforced server-side via `optionalAuthenticate` on the public routers — UX
gating is not a security boundary (surfaces contract).

Launch defaults (seeded): travel + health all ON; motor/business payment
OFF; open-market quote + payment OFF. Amendment 2026-07-01: HOME opened for
full online purchase (payment ON) — code default + migration
`20260701160000_open_home_payment_channel` flip existing rows; binder authority
still gates issuance per territory.

## Consequences

- One canonical owner: `backend/modules/policy/app/productChannel/`. The
  frontend catalog stays a read-only mirror.
- Motor goes fully online by flipping `paymentEnabled` in Back Office once
  Lloyd's approves — no deploy.
- Resolver falls back to a reviewed in-code default map when a row is absent
  (new tenants/products), so a missing row never silently enables payment.
- BO writes apply within the tenant-config cache TTL (or via explicit
  invalidation).
