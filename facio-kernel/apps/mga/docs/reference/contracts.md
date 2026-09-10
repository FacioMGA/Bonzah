---
title: Cross-Codebase Contracts Inventory
audience: agent
status: living
owner: platform-eng
reviewed: 2026-09-09
binding: false
generated_by: tools/docs/generate-contracts.mjs
---
<!--
  GENERATED FILE — DO NOT EDIT BY HAND.
  Run `npm run docs:generate -- --only=contracts` to regenerate.
  CI: `npm run docs:generate -- --check` fails on drift.
-->

# Cross-Codebase Contracts Inventory

The substrate `guard:contracts-product-consistency` will use to make Product field-contract drift impossible (ADR-0010). Each row is the canonical record of one contract that crosses module / package / surface boundaries.

## Sources

| Family | Pattern |
|--------|---------|
| Validation | `packages/validation/src/**/contract.ts` |
| Product Profile | `packages/products/(src/)?<product>/profile.ts` |
| Event | `backend/modules/<module>/domain/events/*.ts` |
| Authority | `backend/products/**/*Authority.ts` |

## Inventory (12 contracts)

| Contract | Family | Owner | Source | Products using it | Content revision |
|----------|--------|-------|--------|-------------------|--------------|
| `quoteDataAuthority` | Authority | platform-products | `backend/products/health/quoteDataAuthority.ts` | `health` | content:29605cecd7db |
| `quoteDataAuthority` | Authority | platform-products | `backend/products/home/quoteDataAuthority.ts` | `home` | content:0db241da225a |
| `quoteDataAuthority` | Authority | platform-products | `backend/products/travel/quoteDataAuthority.ts` | `travel` | content:553e02a5fa7d |
| `business profile` | Product Profile | platform-products | `packages/products/src/business/profile.ts` | `business` | content:23958764327d |
| `commercial profile` | Product Profile | platform-products | `packages/products/src/commercial/profile.ts` | `commercial` | content:aad9e8c88aa5 |
| `health profile` | Product Profile | platform-products | `packages/products/src/health/profile.ts` | `health` | content:829d8433877a |
| `home profile` | Product Profile | platform-products | `packages/products/src/home/profile.ts` | `home` | content:ce1d1ecebf42 |
| `motor profile` | Product Profile | platform-products | `packages/products/src/motor/profile.ts` | `motor` | content:de3548d142d5 |
| `open-market profile` | Product Profile | platform-products | `packages/products/src/open-market/profile.ts` | `open-market` | content:2156b434ca8c |
| `rental profile` | Product Profile | platform-products | `packages/products/src/rental/profile.ts` | `rental` | content:c83b02414c76 |
| `travel profile` | Product Profile | platform-products | `packages/products/src/travel/profile.ts` | `travel` | content:583f62bf3fd2 |
| `nationality` | Validation | platform-validation | `packages/validation/src/nationality/contract.ts` | _n/a_ | content:64b8216e91a7 |
