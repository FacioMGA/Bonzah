---
title: ADR-0026 Motor driver coverage restriction (`driverRestriction`)
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-18
binding: true
---

# ADR-0026: Motor driver coverage restriction

## Status

Accepted (ABY-232). Establishes `driverRestriction` as the canonical motor coverage-basis enum across schema, pricing, documents and claims.

## Context

The motor wizard historically asked a single boolean — "Will there be any additional drivers on this policy?" — and projected a separate `driverPricingBasis` (`NAMED_DRIVERS` / `OPEN_DRIVERS`) used by the pricing engine. Two problems:

1. The certificate hard-codes "aged between 25 and 70" wording but the policy was actually sold (and rated) as named-only. Customer reports (Marker.io ABY-222) flagged the contradiction: "the system is not differentiating between a client who asked for named drivers, and therefore receives a discount, and somebody who asks for any driver over the age of 25 and under the age of 70 who will receive no discount."
2. The scheme rating sheet (Peter Sheppard, 2026‑05) explicitly lists two driver-basis tiers — "Insured or 2 Named Drivers –15%" and "AAD 25+ Rate" — but the wizard had no way for the customer to choose between them and no place in the data to record the choice.

The source system Effie referenced (`Marker.io ABY-232`) ships a four-option select: **Policy Holder**, **Named Drivers Only**, **Any Driver Over 25**, **Any Driver Over 40**.

## Decision

### 1. Canonical enum

Introduce `driverRestriction: MotorDriverRestriction` on the canonical motor profile (`packages/products/src/motor/profile.ts`) and `QuoteData` (`backend/platform/types/autoInsurance.ts`). Values:

| Value | Meaning | Pricing basis | Min age | Cert wording |
|---|---|---|---|---|
| `POLICYHOLDER_ONLY` | Only the policyholder drives | `NAMED_DRIVERS` (−15% discount) | — | "The Policyholder only." |
| `NAMED_DRIVERS` | Policyholder + named additional drivers | `NAMED_DRIVERS` (−15% discount) | — | "The Policyholder and the Named Drivers listed in this Certificate…" |
| `ANY_DRIVER_25_PLUS` | Open driving, ages 25–70 | `OPEN_DRIVERS` (rate, no discount) | 25 | "… any authorised driver aged between 25 and 70 …" |
| `ANY_DRIVER_40_PLUS` | Open driving, ages 40–70 | `OPEN_DRIVERS` (−7.5% age-band discount) | 40 | "… any authorised driver aged between 40 and 70 …" |

`driverPricingBasis` is now a **projection** of `driverRestriction` (resolved by `resolveDriverPricingBasis` in `backend/products/motor/pricing/factors/abbeygateFactors.ts`). It is no longer a separate writable field — legacy values are honoured only when `driverRestriction` is absent.

### 2. `hasAdditionalDrivers` stays as a UI signal

`hasAdditionalDrivers` is preserved as a separate canonical field with one purpose: when `driverRestriction === 'NAMED_DRIVERS'`, it asks "do you want to add named drivers beyond the policyholder?" and gates the `additionalDrivers` list collection. For every other `driverRestriction` value the wizard / BO controllers cascade-clear it to `false` and the array to `[]`.

This separation matches the client's framing ("these are two different concepts — `hasAdditionalDrivers` is for registering more drivers and rendering the relevant fields; `driverRestriction` is the coverage basis").

### 3. Pricing alignment (scheme)

| Restriction | Named-driver discount (−15%) | Under-25 added-driver loading | Over-80 added-driver loading |
|---|---|---|---|
| `POLICYHOLDER_ONLY` | Yes | n/a (no added drivers) | n/a |
| `NAMED_DRIVERS` | Yes | Applies per scheme ladder | Applies (>80 → +20%) |
| `ANY_DRIVER_25_PLUS` | No | Suppressed (policy excludes <25) | n/a |
| `ANY_DRIVER_40_PLUS` | No; applies separate −7.5% open-driver age-band discount | Suppressed | n/a |

The new helper `addedDriversUnder25FactorWithRestriction` explicitly gates the under-25 ladder on `driverRestriction === 'NAMED_DRIVERS'`. Even if a stale `hasAdditionalDrivers === true` and `youngestDriverAge` leaks through a basis switch, the calculator collapses the factor to 1.0 in open modes (drivers under the restriction's min age are not covered by definition).

`ANY_DRIVER_40_PLUS` was confirmed by Peter Sheppard on 2026-05-19 as attracting a 7.5% discount versus `ANY_DRIVER_25_PLUS`. The factor is implemented as `openDriverAgeBandDiscountFactor` so it remains distinct from the named-driver discount.

### 4. Document wording

`backend/products/motor/documents/viewModel.ts` no longer hard-codes "25 and 70". `buildDriversBlock` returns mode-specific `age_band` and `entitled_classes`. The `statement.drivers` array now merges `quoteData.additionalDrivers` into the statement of fact when (and only when) the policy is on the `NAMED_DRIVERS` basis.

### 5. Claims FNOL

- `extractNamedDriversFromPolicy` returns only the policyholder in `POLICYHOLDER_ONLY` / `ANY_DRIVER_25_PLUS` / `ANY_DRIVER_40_PLUS` modes, and policyholder + additional named drivers in `NAMED_DRIVERS` mode. Pre-ABY-232 policies fall back to the historical multi-shape extraction.
- `validateGuidedFnolForm` accepts an optional `driverRestriction` argument. When the policy is on an open-driver basis, every driver (named, "any-authorised-driver", and explicitly `kind: 'unauthorized'`) must declare a DOB; the validator rejects drivers below the restriction's min age and above 70.
- A new helper `resolveDriverRestrictionFromPolicy` reads the canonical value from `policy.quoteData` or its `driverInfo` projection. Eventually `defaultClaimsContract.fullClaimForm.fields[]` should declare a `prefillPath: 'policy.driverRestriction'` field, but motor's `fullClaimForm.fields` is empty today (external_spec); the runtime path is wired and tracked as a follow-up.

### 6. Underwriting analysis

A new yellow trigger `YELLOW.OPEN_DRIVER_PROPOSER_UNDER_RESTRICTION` fires when `driverRestriction === 'ANY_DRIVER_25_PLUS' | 'ANY_DRIVER_40_PLUS'` and the proposer themselves is below the restriction's threshold. Surfaces in `underwritingAnalysis` per the underwriting-analysis contract; BO renders, never re-derives.

### 7. Legacy back-compat

`MotorProductAdapter.normalizeQuoteDataForValidation` includes `normalizeDriverRestrictionCompatibility`. Pre-ABY-232 quotes (no `driverRestriction`) are derived on read:

- `hasAdditionalDrivers === false` → `POLICYHOLDER_ONLY`
- `hasAdditionalDrivers === true`  → `NAMED_DRIVERS`

Unknown enum values are preserved verbatim so the stage validator can reject them explicitly (no silent coercion). New writes must supply a valid value.

## Consequences

- **Calculator parity.** `POLICYHOLDER_ONLY + 0 additional drivers` rates identically to the historical `hasAdditionalDrivers === false` shape. Legacy quotes carry forward without re-rating.
- **Certificate corrections.** Certificates issued going forward will reflect the actual coverage basis, eliminating the Marker.io contradiction.
- **Claims gating.** Open-mode claims now enforce the age band server-side, so a 22-year-old uncle cannot legitimately make a claim under an `ANY_DRIVER_25_PLUS` policy even if the FNOL UI labels them as "unauthorized".
- **`ANY_DRIVER_40_PLUS` pricing.** Confirmed by Peter Sheppard on 2026-05-19 at −7.5% versus `ANY_DRIVER_25_PLUS`.

## Alternatives considered

- **Reuse `driverPricingBasis` as the canonical write field.** Rejected: the existing enum has only two values (`NAMED_DRIVERS` / `OPEN_DRIVERS`) and cannot distinguish `POLICYHOLDER_ONLY` from `NAMED_DRIVERS`, or `ANY_DRIVER_25_PLUS` from `ANY_DRIVER_40_PLUS`. The certificate wording and the claims age-gate both require the richer enum.
- **Two booleans (`hasAdditionalDrivers` + `openDriverRestriction`).** Rejected: encodes one concept in two fields, violates `canonical-ownership.md` ("one canonical owner per concept; everything else is a wrapper / projection / derived UI").
- **Move to `Tenant.authority.motor` immediately.** Out of scope. Tracked as a future ADR to migrate the driver factor literals (under-25 ladder, –15% discount, ANY_DRIVER_40_PLUS −7.5% factor) into authority.
