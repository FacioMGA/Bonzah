---
title: Health (Brit Immigration Medical) — product overview
audience: developer
status: living
owner: platform-eng
reviewed: 2026-05-22
binding: false
---

# Health — Brit Immigration Medical Insurance

CY-only Phase 1. Section A only (Inbound Individual Medical Insurance). Sold to expat residents of the Republic of Cyprus to support their immigration application. Underwritten under the BRIT BAA, riding the **same binder family as Travel** (UMR series `B176023–B176026EEA6153`). See [ADR-0032](../architecture/decisions/ADR-0032-health-product-introduction.md).

## Eligibility (objective-expat, same shape as Travel ADR-0025)

The wizard collects seven objective answers; `isExpat` is server-derived, never asked of the customer:

1. Country of residence (CY-only Phase 1).
2. Nationality (must not equal residence).
3. Any other nationality? + value (must not equal residence either).
4. Residence duration (audit-only — no UW gate).
5. Will remain resident for the policy term (must be true).
6. Residency status (audit-only — no UW gate).
7. Legally permitted to reside (must be true).

Plus the Lloyd's residency declaration and the "information is accurate" confirmation. Decline copy is byte-identical to Travel's canonical strings — single source of truth in `healthValidationProfile`.

## Premium model

Age-banded gross premium per insured; multi-insured = sum of per-insured rates. 30 % commission off the gross.

| Age band | Gross (EUR) | Excess |
|---|---:|---|
| 0–62 | 175 | 10 % co-insurance |
| 63–65 | 210 | €200 |
| 66–70 | 245 | €900 |
| 71–74 | 270 | €1,400 |
| 75–79 | 315 | €1,900 |
| 80 + | 430 | €2,800 |

Rates live in `backend/products/health/pricing/data/brit-health-2026.json` (zod-validated, deep-frozen at boot). No inline rate tables — `guard:no-inline-rate-tables` enforces this.

## Fixed cover amounts (Section A)

| Cover | Amount |
|---|---:|
| Inpatient per illness or accident | €8,600 |
| Inpatient per period and per person | €13,700 |
| Daily hospitalisation — regular | €75 / day |
| Daily hospitalisation — Emergency Room | €170 / day |
| Childbirth lump sum (natural or caesarean) | €515 once-off |
| Transportation of remains | up to €3,420 |

These amounts are the same for every policy regardless of age or cover type. They live in the rate JSON as `baseCover`.

## GHS extension (conditional — no premium impact)

Insureds who are beneficiaries of the General Healthcare System (GHS) of Cyprus get an extended outpatient block, available **only** when `ghs.isBeneficiary === true` on the quote.

| Extension | Amount |
|---|---:|
| Outpatient per illness | €700 |
| Outpatient per period | €1,750 |
| Per doctor's visit | €20 |
| Doctor visits per period | €175 |
| Medications | €180 |
| Outpatient excess | €50 |
| Co-insurance | 90 % |

Implemented as an MBE endorsement (`HEALTH-GHS-EXTENSION`) with `option_defaults.selectedWhen: [{ path: 'ghs.isBeneficiary', equals: true }]`. The same trigger auto-applies Endorsement No. 141 (`HEALTH-GESY-CLAIMS-CONDITION`): Section A claims require documentary evidence that GESY was approached and declined before the Company admits or pays; the schedule prints the full wording in its ENDORSEMENTS section. The wizard, BO Programs > Coverage tab, and PDF schedule all read the same MBE-resolved endorsement set — one source of truth.

## Documents

| Document | Source | Generated per quote |
|---|---|---|
| Schedule (Lloyd's jacket + Abbeygate sheet) | `schedule.html` template | Yes |
| Certificate of Insurance | `certificate.html` template | Yes |
| Statement of Fact | `statement-of-fact.html` template | Yes |
| Insurance Product Information Document (IPID) | `static/BritImmigrationHealthIPID.pdf` | No (static) |
| Policy Wording (Section A) | `static/Abbeygate_Immigration_Health_Wording.pdf` | No (static) |

All five flow through the canonical issued doc-pack spine (ADR-0013) and attach to the welcome email.

## Multi-tenant scope

| Tenant | Status |
|---|---|
| `abbeygate-cy` | Live (Phase 1) |
| `abbeygate-pt` | Pending — `PT/HEALTH` config row not yet added |
| `abbeygate-es` | Pending — `ES/HEALTH` config row not yet added |
| `abbeygate-gr` | Pending — `GR/HEALTH` config row not yet added |

The conformance matrix auto-includes a `(tenant, HEALTH)` combo as soon as the corresponding `CONFIGS` row is added.

## Open follow-ups

See [ADR-0032 §Open follow-ups](../architecture/decisions/ADR-0032-health-product-introduction.md) for the full list (age cap, CY IPT rate, admin fee, BDX, Section B).
