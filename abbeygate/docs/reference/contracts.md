---
title: Cross-Codebase Contracts Inventory
audience: agent
status: living
owner: platform-eng
reviewed: 2026-09-07
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

## Inventory (11 contracts)

| Contract | Family | Owner | Source | Products using it | Last changed |
|----------|--------|-------|--------|-------------------|--------------|
| `quoteDataAuthority` | Authority | platform-products | `backend/products/health/quoteDataAuthority.ts` | `health` | 2026-08-28 (+0000) |
| `quoteDataAuthority` | Authority | platform-products | `backend/products/home/quoteDataAuthority.ts` | `home` | 2026-08-30 (+0000) |
| `quoteDataAuthority` | Authority | platform-products | `backend/products/travel/quoteDataAuthority.ts` | `travel` | 2026-07-23 (+0000) |
| `business profile` | Product Profile | platform-products | `packages/products/src/business/profile.ts` | `business` | 2026-06-05 (+0000) |
| `health profile` | Product Profile | platform-products | `packages/products/src/health/profile.ts` | `health` | 2026-08-28 (+0000) |
| `home profile` | Product Profile | platform-products | `packages/products/src/home/profile.ts` | `home` | 2026-08-31 (+0000) |
| `motor profile` | Product Profile | platform-products | `packages/products/src/motor/profile.ts` | `motor` | 2026-06-18 (+0000) |
| `open-market profile` | Product Profile | platform-products | `packages/products/src/open-market/profile.ts` | `open-market` | 2026-06-05 (+0000) |
| `rental profile` | Product Profile | platform-products | `packages/products/src/rental/profile.ts` | `rental` | never |
| `travel profile` | Product Profile | platform-products | `packages/products/src/travel/profile.ts` | `travel` | 2026-08-07 (+0000) |
| `nationality` | Validation | platform-validation | `packages/validation/src/nationality/contract.ts` | _n/a_ | 2026-05-03 (+0000) |
