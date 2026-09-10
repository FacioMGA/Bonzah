---
title: Surfaces contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Surfaces — binding contract

## Governs
The three deployable frontend surfaces, what each owns, and the strict isolation between them.

## Surfaces
| Surface | Base path | Audience |
|---|---|---|
| `public` | `/public/` | Unauthenticated (quotes, login, FNOL) |
| `client` | `/client/` | Policyholders / customers |
| `bo` | `/bo/` | Back-office (underwriters, admins) |

## Allowed
- A surface imports any product's `index.ts` and from `frontend/src/shared/`.
- A surface owns its routing, page shells, layout composition.
- Public and client product-entry projections MUST filter `productCatalog` through the canonical `isProductAvailableInCountry` using the operating host country; a surface must not advertise a product outside its configured territory.
- Client billing state MUST render the canonical `Policy.paymentStatus` supplied by the policy read model; quote-answer balance fields are not a payment-state source.
- Public portal overlays (for example, date calendars) use shared primitives and must remain fully within the usable viewport; product wizards must not add their own placement rules.
- State management: server → React Query, client → Zustand (only when needed), URL → React Router, forms → React Hook Form + Zod.
- On issued policies, the BO workspace becomes writable only for a server-confirmed draft endorsement; the versions list may activate that mode while its snapshot hydrates.
- Build: `npm run build:frontend:<surface>` or all with `npm run build:frontend`.

## Forbidden
- Surfaces importing each other's internals. `bo`, `client`, `public` are independent.
- Surfaces importing product internals — only `index.ts`.
- Business logic in surfaces. Pages compose products; they do not implement features.
- BO symbols in the public bundle (`npm run proof:public-bundle-isolation`). Leak = security regression.
- Surface bypassing `evaluateIssueReadiness`. UX gating is not a security boundary.

## Escalation
- **Write an ADR** to: add a fourth surface, change `manualChunks` strategy in `frontend/vite.config.ts`, change the build output structure (the deploy contract depends on it).
- **Stop and ask** to: add cross-surface code (belongs in `products/` or `shared/`), import a product internal from a surface.

## Links
- Performance budgets per surface: [performance-budgets.md](./performance-budgets.md)
- Related: [modules-and-layers.md](./modules-and-layers.md) · [products.md](./products.md)
- Vite config (chunk strategy): [`frontend/vite.config.ts`](../../../frontend/vite.config.ts)
