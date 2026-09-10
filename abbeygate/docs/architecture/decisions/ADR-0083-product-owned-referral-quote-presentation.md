---
title: Product-owned referral quote presentation
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-28
binding: true
date: 2026-08-28
---

# ADR-0083: Product-owned referral quote presentation

## Decision

`QuotePresentationShell` may render an optional product-provided referral slot. The shell supplies placement only; a product owns the copy and whether it renders any referral information.

Motor renders its calculated annual premium in this slot only for a `REFERRAL` response with a finite positive premium. It labels the amount *indicative*, states that underwriting approval is required, and offers no bind or payment CTA.

## Consequences

The canonical amount remains `IProductAdapter.buildQuoteResponse`; no frontend pricing is derived. Other products remain unchanged unless their approved product journey opts in explicitly.
