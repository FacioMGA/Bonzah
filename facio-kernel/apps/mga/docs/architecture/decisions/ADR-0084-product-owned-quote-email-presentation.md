---
title: Product-owned quote-email presentation
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-28
binding: true
date: 2026-08-28
---

# ADR-0084: Product-owned quote-email presentation

## Context

The shared quote-email shell needs a cover label and excess disclosure. Those values are not
uniform across products: Travel derives them from the selected plan and trip type.

## Decision

`IProductAdapter.buildQuoteEmailPresentation` is the single product extension point for those
two values. The policy email context invokes the registered adapter without product branches.
Each product that implements it must derive both fields from its own canonical quote data and
fail closed when required disclosure inputs are absent.

## Consequences

Travel's quote letter now shows its actual cover and excess wording. New product-specific
conditions belong in the product adapter, not in communications or the policy module.
