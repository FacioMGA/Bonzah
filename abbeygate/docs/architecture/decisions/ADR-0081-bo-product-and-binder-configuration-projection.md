---
title: ADR-0081 BO product and binder configuration projection
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-27
binding: true
---

# ADR-0081: BO product and binder configuration projection

## Status

Accepted.

## Context

The BO previously allowed a Program without a product and exposed an
unconstrained product-code field in Binder Authority. Both paths could create
configuration that a policy could not resolve safely; the Home quote incident
showed the resulting ambiguity reaching a customer-facing quote action.

## Decision

BO configuration uses the existing active `ProductDefinition` catalogue as a
read-only selection projection. Creating a Program requires a selected active
definition and persists its code to `Program.productType`. The Binder Authority
tab selects the same catalogue and writes only the existing canonical
`BinderProductAuthority` row. Program–Binder relationships remain owned by
`ProgramBinderLink`.

This is a tabbed BO workflow, not a ProductLaunchDraft publish path and not a
new product-onboarding mechanism. Adding a product line still follows the
registered product/profile contract.

## Consequences

- UI cannot manufacture a product code or a second authority store.
- A new configuration is complete enough for policy assignment before it can
  be used for rating or customer correspondence.
- Existing Programs with no `productType` are not inferred or rewritten;
  they require explicit operator remediation.

## Forbidden

- A hard-coded product list in BO configuration.
- Writing runtime configuration through `ProductLaunchDraft`.
- Creating a product line by inserting a `ProductDefinition` from BO.

## Links

- [Canonical ownership](../contracts/canonical-ownership.md)
- [Products contract](../contracts/products.md)
