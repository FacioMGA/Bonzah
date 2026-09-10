---
title: Jurisdiction-aware product configuration contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Jurisdiction-aware product configuration — binding contract

## Governs
Country / tax / wording / Green Card / BDX defaults / statutory claims-handling deadlines — all keyed by `(product, binder, country)`, optionally refined by program and source.

## Allowed
- Resolve `JurisdictionProductConfig` via `resolveJurisdictionProductConfig({ productCode, program, binder, tenant, source, customerCountryOfResidence? })` before pricing, document rendering, or BDX I/O.
- Add a country / product pair: write a `JurisdictionProductConfig`, named tax profile (or `unsupported`), document + Green Card config, BDX import defaults + export mapping, golden BDX reconciliation test.
- Use named tax profiles (e.g. `CY_MOTOR_ABBEYGATE_CURRENT`, `PT_MOTOR_VOLANTE_BDX_12_9_CONVERGENCE`). Each profile name describes the business method it implements.
- **TRAVEL only — customer-declared override** ([ADR-0024](../decisions/ADR-0024-travel-customer-residence-as-tax-jurisdiction.md)): for `productCode === 'TRAVEL'` the resolver consults `customerCountryOfResidence` ahead of tenant/program/binder/source candidates. Tenant remains the operating identity (auth, branding, BDX migration); only tax/regulatory/document dimensions flip per quote.
- **Statutory claims-handling deadlines** ([ADR-0065](../decisions/ADR-0065-statutory-claims-handling-jurisdiction-concern.md)): optional `claimsHandling` block (working-day timetable, e.g. PT/MOTOR DL 291/2007). Keys off resolved `(country, product)`, never the binder's `workingDaysJurisdiction`. Absence = no encoded timetable. LEGAL-VERIFY values, computed by the claims deadline engine.

## Forbidden
- Inferring country, tax regime, wording, Green Card output, or BDX defaults without resolving the config first.
- DB reads or mutation inside the resolver. Callers load `Program`, `Binder`, `Tenant`, `source` first.
- Hidden country fallback (`"Cyprus"`, `"Cypriot"`, `"CY"`, source-specific migration codes). Missing config throws `ProductConfigurationError`.
- `if (country === 'PT')` branches in core pricing, document, or BDX code. If you need one, the config shape is missing a dimension — extend it.
- Hardcoded wording in templates or view models. All wording comes from `documentConfig` / `greenCardConfig`.
- Passing `customerCountryOfResidence` to the resolver for any product other than TRAVEL — `assertCustomerOverrideOnlyForTravel` throws.

## Escalation
- **Write an ADR** to: add a top-level concern to `JurisdictionProductConfig`, introduce a parallel jurisdiction lookup, replace the named-profile tax model, add a tax profile that is not country-product specific, extend the customer-override exception to a second product.

## Links
- Related: [tenancy.md](./tenancy.md) · [products.md](./products.md) · [product-engine-authority.md](./product-engine-authority.md)
- ADRs: [ADR-0024](../decisions/ADR-0024-travel-customer-residence-as-tax-jurisdiction.md) · [ADR-0025](../decisions/ADR-0025-travel-objective-expat-eligibility.md)
- Validate: `npm run test:bdx-import` (reconciliation report)
