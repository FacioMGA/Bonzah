---
title: Travel Your Trip journey
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-28
binding: true
date: 2026-08-28
---

# ADR-0085: Travel Your Trip journey

## Decision

The public Travel wizard begins with one *Your Trip* stage that presents the objective eligibility and traveller-detail sections together. It then continues through Trip, Choose plan, Options, Your details, and Declarations: six customer-facing stages in total.

This is a presentation grouping only. The canonical eligibility and traveller field contracts, their validation profiles, and underwriting evaluation remain unchanged. Existing `step=eligibility` and `step=travellers` deep links resolve to *Your Trip*.

## Consequences

The first page mirrors the established Abbeygate Travel journey without duplicating data or validation. New Travel deep links must use the six-stage route keys; legacy first-stage links remain supported.
