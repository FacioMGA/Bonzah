---
title: ADR-0024 Travel customer-residence as tax jurisdiction override
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-18
binding: true
---

# ADR-0024: Travel customer-declared country of residence as tax-jurisdiction override

## Status

Accepted. Implements the Travel BAA EU expansion authorised by BRIT (Belgium, Netherlands, Italy negotiated; France, Malta confirmed; Germany pending FOS). Sister to [ADR-0025](./ADR-0025-travel-objective-expat-eligibility.md) (objective expat eligibility) — both land together; one without the other is incoherent.

## Context

`docs/architecture/contracts/jurisdiction-product-config.md` (pre-this-ADR) is unambiguous: country resolution for `JurisdictionProductConfig` reads from `program → binder → tenant → source`, never from customer-supplied data. The contract's "Forbidden" list calls out *"Inferring country, tax regime, wording, Green Card output, or BDX defaults without resolving the config first"* and the resolver's history (`spine/v2` Wave 5) explicitly removed the placeholder/synthetic profiles to fail loud on missing rows.

That posture is correct for **Motor** and **Home**, where the risk is the vehicle/property and its location is bound by the operator's binder/program scope. It breaks for **Travel**: the risk per Insurance Europe (2025 indirect-taxation report) and the BRIT BAA is "where the policyholder is habitually resident", and the BAA negotiation explicitly authorises a single Abbeygate site (CY or PT today) to bind for an expat resident in any authorised territory. Forcing tenant-driven country resolution would either (a) require one operating tenant per EU country (an ops change touching auth, branding, BDX migration, and DB seeds for every customer), or (b) silently mis-tax non-tenant-country residents.

## Decision

The customer-declared `eligibility.countryOfResidence` overrides the tenant-derived country candidate when, and only when, `productCode === 'TRAVEL'`.

1. **Resolver input extended.** `JurisdictionResolverInput` gains an optional `customerCountryOfResidence?: string`. For TRAVEL, this candidate is consulted **first**, ahead of `source.countryCode`/program/binder/tenant. For non-TRAVEL products, passing the field is a runtime assertion failure (`assertCustomerOverrideOnlyForTravel`).
2. **Tenant identity unchanged.** Tenant remains the operating identity (auth, branding, currency, BDX migration, oversight). Only the **tax/regulatory/document** dimension flips per quote. `Policy.operatingTenantId` and `Policy.binderId` are still tenant/binder values, never customer-declared.
3. **Authorised list is the gate.** The 9 BRIT-authorised codes (`CY`, `PT`, `GR`, `ES`, `BE`, `NL`, `IT`, `FR`, `MT`) are the only values the resolver accepts via this override. Anything else fails as `ProductConfigurationError` with `reason: 'Country code is not supported by jurisdiction product configuration'`. Adding a country = add a `CONFIGS` row + tax JSON + manifest option; no resolver code change.
4. **Tax engine consumes the override.** `backend/products/travel/pricing/travelTaxes.ts` (new) reads the resolved `JurisdictionProductConfig` and applies the per-country rate from `data/travel-eu-tax-rates.json`. The legacy `applyTenantTaxes(tenant, net)` call inside `travelCalculator.ts` is deleted; tenant IPT no longer drives Travel premiums.
5. **No grandfathering.** Quotes rated under the pre-cutover single-tenant-IPT model and renewed after this ADR lands recalculate under the new per-residence model. There is no preservation of pre-cutover Travel quote tax breakdowns.
6. **Forbidden in this lane.** Customer-declared overrides for Motor and Home stay forbidden — the spine retains its existing posture for those products.

## Consequences

- **Customer journey:** Travel can be sold by any authorised Abbeygate site to any expat resident in the 9 authorised countries with deterministic, auditable per-country tax. Adding a country is one JSON row + one ADR-grade decision, not an ops migration.
- **Audit trail:** the resolved `JurisdictionProductConfig.countryCode` (with `customerCountryOfResidence` provenance noted in the calculation trace) is the authoritative jurisdiction of record on the quote. BDX export and document generation read from there.
- **Refusal mode preserved:** Off-list residence values still throw `ProductConfigurationError`. NL is configured but flagged `refer: true` in the tax JSON until BRIT confirms the partial-exemption treatment; the calculator emits a REFER lane (`TAX_PROFILE_REFER`) rather than guessing a number — `no-defensive-fallbacks` rule applies.
- **Lock test:** `resolveJurisdictionProductConfig({ productCode: 'MOTOR', customerCountryOfResidence: 'IT' })` throws — pinned in `productConfiguration.test.ts`.

## Alternatives considered

- **One operating tenant per EU country.** Rejected. Ops-heavy; couples regulatory taxation to authentication/branding, which are orthogonal concerns. Would also force a CY-resident customer onto the abbeygate-cy tenant even when the broker selling is Portuguese.
- **Treat `eligibility.countryOfResidence` as a `source.countryCode` synonym.** Rejected as silent. The contract's "Forbidden" list is explicit that customer data must not flow into resolver candidates implicitly. An explicit, named override field surfaces the architectural exception.
- **Per-product resolver function.** Rejected. Two resolvers diverge over time. One resolver with a Travel-specific override input + a runtime guard against misuse is the smaller, mechanically-checkable surface.

## Migration plan

1. Extend `JurisdictionCountryCode` with `BE | NL | IT | FR | MT`.
2. Add the override input + per-product guard to `resolveJurisdictionProductConfig`.
3. Author `data/travel-eu-tax-rates.json` (+ schema + loader) and `travelTaxes.ts`.
4. Switch `travelCalculator.ts` from `applyTenantTaxes` to `calculateTravelTaxes`.
5. Update [`jurisdiction-product-config.md`](../contracts/jurisdiction-product-config.md) Allowed/Forbidden blocks to encode the override.
6. Pin the override behaviour in `productConfiguration.test.ts` and `travelCalculator.test.ts` (per-country tax goldens).

## Links

- Sister: [ADR-0025](./ADR-0025-travel-objective-expat-eligibility.md) (objective expat eligibility)
- Contract: [jurisdiction-product-config.md](../contracts/jurisdiction-product-config.md)
- Canonical-ownership row affected: "Product rate tables (literal data)" → travel adds `data/travel-eu-tax-rates.json`
- Source: BRIT BAA expansion email thread, Peter / Danny / Jack 2026-04-20 to 2026-05-16
