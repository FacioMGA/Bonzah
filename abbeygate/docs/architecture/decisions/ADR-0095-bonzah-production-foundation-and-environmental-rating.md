---
title: ADR-0095 Bonzah production foundation and environmental rental rating
audience: architect
status: living
owner: product-platform
reviewed: 2026-09-07
binding: true
---

# ADR-0095: Bonzah production foundation and environmental rental rating

## Context

ADR-0094 introduced an explicitly synthetic partner demonstration. The direct
Bonzah journey now needs a production-shaped contract while carrier-approved
rates, filings, wording, payment and policy issuance remain launch gates.

## Decision

Keep `RENTAL` product-owned and introduce an effective-dated rating dataset.
Premium factors use vehicle value, repair profile, class, powertrain, model
theft exposure, pickup-state road-risk exposure and seasonal weather exposure.
Road risk is a FARS severity proxy normalised by FHWA travel, not a claim of
all-crash frequency. Weather uses NOAA historical event data. Every response
pins source versions, geographic resolution, configured fallbacks and a
customer-safe explanation; missing mandatory configuration fails closed.

CDW consumes vehicle and environment factors. RCLI and SLI consume road,
season and eligible-use factors. PAI/PEI remains duration-rated. The insurance
service fee is fixed by effective-dated program configuration and is never a
risk factor. Product authority owns factor ranges, referral/decline thresholds
and approved fallback rules.

Public and partner APIs share immutable quote snapshots and idempotent bind.
Bind accepts a payment-provider token, versioned consent evidence and re-rates
against the quote's pinned dataset. Raw PAN and CVC are forbidden. Simulation
is an explicit non-production execution mode and must fail closed when the
production runtime is selected.

The direct Bonzah consumer website and the Summit rental-booking demonstration
remain separate customer applications. `/bonzah` owns the insurance-first
journey and its state, while `/summit-rentals` owns the rental-company booking
journey and its state. Neither route redirects to, imports, or renders the
other page. They may consume the same product-owned rating and quote contracts;
that shared infrastructure does not make either website an extension of the
other.

## Delivery boundary

This ADR authorises a fully working staging foundation. The existing in-memory
repository remains a development adapter behind a persistence interface until
the canonical database adapter is connected. Live sale remains disabled until
carrier, actuarial, legal/filing, wording, tax, payment and operations approvals
are recorded in program configuration.

## Consequences

Exact-model theft data may use a configured vehicle-class fallback with a trace;
an unknown state or unavailable mandatory dataset refers. Existing quotes never
change when a new dataset activates. Direct and embedded channels use the same
rating request, snapshot and bind invariants.
