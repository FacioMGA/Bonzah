---
title: Product overview
audience: developer
status: living
owner: platform-eng
reviewed: 2026-05-04
binding: false
---

# Product overview — Insurance OS

One Lloyd's coverholder scheme · one application deployment · multi-jurisdiction · multi-product. Read this before any architectural contract.

## Four jurisdictions
| Tenant slug | Country | IPT model |
|---|---|---|
| `abbeygate-cy` | Cyprus | flat €2 fee |
| `abbeygate-pt` | Portugal | 9% rate |
| `abbeygate-es` | Spain | 8.15% rate |
| `abbeygate-gr` | Greece | 15% rate |

Each jurisdiction owns its IPT, legal/compliance pack (templates, T&Cs), UW authority thresholds, branding, coverholder email config. All four served by one running process. Contract: [tenancy.md](../architecture/contracts/tenancy.md).

## Products
| Product | Status | Notes |
|---|---|---|
| Motor | Live CY, GR; PT mid-rollout | Most mature. Has the legacy Motor wizard schemas Phase 8 will retire. |
| Home | Live CY, GR | Unified validation runner from day one. Greece country loading ([ADR-0052](../architecture/decisions/ADR-0052-home-greece-country-loading.md)). |
| Travel | Live CY, GR (+ BRIT expat countries) | Unified validation runner; customer-residence tax override (ADR-0024). |
| Health | Live CY (Phase 1); GR gated | Brit Immigration Medical — overlays BRIT travel binders ([ADR-0032](../architecture/decisions/ADR-0032-health-product-introduction.md)). GR blocked pending regulatory sign-off ([ADR-0053](../architecture/decisions/ADR-0053-health-greece-jurisdiction-gate.md)). |
| Business | Live CY, GR | Manual-referral placement (quote on, online payment off). |
| Open Market | Live CY, GR | Manual intake only (quote + payment off). |

Each product registered in `packages/products/<name>/` (profile, manifest, validation, runtime, document config); FE + BE consume via `@facio/products`. Contract: [products.md](../architecture/contracts/products.md).

## Lifecycle (the only thing every team must agree on)
```text
quote → bind → issue → endorse → renew | claim
```
| Stage | Owner | Surfaces |
|---|---|---|
| `quote` | Wizard or BO Quote tab | public, bo |
| `bind` | BO bind action or wizard payment | public, client, bo |
| `issue` | Server-side `evaluateIssueReadiness` gate | bo |
| `endorse` | BO endorsement → `RiskTransaction.ENDORSEMENT` | bo |
| `renew` | `RENEWAL.EMAIL_SCAN` worker → invite/chaser | bo, client |
| `claim` | FNOL → `Claim` lifecycle | client (FNOL), bo (handle) |

Every transition is a domain event + outbox entry. Contract: [events-and-projections.md](../architecture/contracts/events-and-projections.md).

## Decision flow (every architectural change)
```text
ADR → binding contract → generated inventory → CI guard
```
ADRs in [decisions/](../architecture/decisions/) · contracts in [contracts/](../architecture/contracts/) · inventories in [reference/](../reference/) · guards in [`tools/quality/`](../../tools/quality/).

## What's not here
| Goal | Go to |
|---|---|
| UMR, MGA, BDX, FNOL, MTA definitions | [glossary.md](./glossary.md) |
| Claims lifecycle (binding) | [claims-lifecycle.md](./claims-lifecycle.md) |
| Customer email triggers | [email-triggers.md](./email-triggers.md) |
| Display labels | [frontend-display-labels.md](./frontend-display-labels.md) |
| Live module / worker / guard / contract inventories | [reference/](../reference/) (generated) |
