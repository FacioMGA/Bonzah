---
title: ADR-0082 Shared date entry primitive
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-28
binding: true
---

# ADR-0082: Shared date entry primitive

## Status

Accepted.

## Context

Native browser date controls differ by browser and cannot provide the agreed
large calendar with month and year navigation. The existing `DateInput` is
already consumed by public, client and BO forms, but its entry affordances
were inconsistent.

## Decision

`frontend/src/shared/ui/primitives/DateInput.tsx` remains the single shared
date-entry primitive. It owns `DD/MM/YYYY` draft formatting, ISO-date output,
the portal-rendered calendar panel, and enforcement of its supplied `min` and
`max` interaction bounds for both typing and calendar selection.

Product schemas remain the canonical owners of date validity and business
rules. Surfaces and products pass declared bounds to the primitive; they do
not build competing calendars or reinterpret dates locally.

## Consequences

- Date panels are positioned outside overflow-clipped containers and update
  while the page scrolls or resizes.
- A range-ineligible typed date is not emitted to the form value.
- Existing consumers retain the ISO `YYYY-MM-DD` value contract.

## Forbidden

- Native or product-specific calendar replacements for shared date fields.
- Surface-specific parsing or range enforcement for the same field.
