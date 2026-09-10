---
title: ADR-0025 Travel objective expat eligibility
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-18
binding: true
---

# ADR-0025: Travel objective expat eligibility (replace `isExpat` self-declaration)

## Status

Accepted. Sister to [ADR-0024](./ADR-0024-travel-customer-residence-as-tax-jurisdiction.md). Implements the BRIT BAA expansion's eligibility model authored by Jack (BRIT) on 2026-04-20 and confirmed by Peter (Abbeygate) on 2026-05-16.

## Context

The current Travel wizard collects a single `eligibility.isExpat` Yes/No checkbox. This is a **self-declaration of a non-legal classification** — Jack's email is explicit:

> "Since 'expat' isn't a legal classification, relying on it directly can introduce ambiguity and uncertainty… I suggest we structure the portal around a concise set of factual, verifiable questions, such as country of current residence, duration spent living in that country, intended length of stay, residency status (citizen, work visa, visitor), and nationality."

The downstream UW gate "must be expat → decline if not" still applies (BRIT BAA limits cover to expatriate residents). What changes is *how* the platform reaches that conclusion: from a single subjective answer to a deterministic computation over factual inputs, with a clear audit trail per Lloyd's oversight expectations.

## Decision

`eligibility.isExpat` becomes a **derived UW outcome**, not a customer-input boolean. The wizard collects seven new objective answers; the calculator/UW automation derives `isExpat` server-side and emits one of five named decline codes if the gate fails.

### Customer inputs (canonical paths under `eligibility.*`)

- `nationality` — controlled country dropdown (canonical full country list, not limited to authorised residence territories per Peter 2026-05-16).
- `hasOtherNationality` — boolean.
- `otherNationality` — controlled country dropdown, required when `hasOtherNationality === true`.
- `residenceDuration` — `lt_1_year | 1_3_years | gt_3_years` — captured for audit, **not gated** (Peter 2026-05-16).
- `residencyStatus` — `permanent_resident | temporary_resident | work_visa | student_visa | visitor | other_visa` — captured for audit, **not gated**.
- `willRemainResident` — boolean.
- `legallyPermittedToReside` — boolean.
- `informationAccurate` — `mustAccept` declaration. Sits alongside the existing Lloyd's `legalAgreement` checkbox; both must be accepted.

### Decline-code vocabulary

Pinned by this ADR. The five codes drive the wizard inline error, the audit log entry, and the declined-quote email — one canonical message per code (Peter's verbatim wording).

| Code | Trigger | Customer-facing message |
|---|---|---|
| `NATIONALITY_EQUALS_RESIDENCE` | `nationality === countryOfResidence` | "We can only insure expatriate residents. Based on the answers selected, your nationality matches your country of residence." |
| `OTHER_NATIONALITY_EQUALS_RESIDENCE` | `hasOtherNationality && otherNationality === countryOfResidence` | (same as above) |
| `WILL_NOT_REMAIN_RESIDENT` | `willRemainResident !== true` | "We can only offer cover where you confirm that you will remain resident in your country of residence for the duration of the policy." |
| `NOT_LEGALLY_RESIDENT` | `legallyPermittedToReside !== true` | "We can only offer cover to applicants who are legally resident in their country of residence." |
| `INFORMATION_NOT_CONFIRMED` | `informationAccurate !== true` | "We can only offer cover where the declaration of accuracy is confirmed." |

### `isExpat` derivation

```text
isExpat = (countryOfResidence !== nationality)
       && (!hasOtherNationality || otherNationality !== countryOfResidence)
       && willRemainResident === true
       && legallyPermittedToReside === true
       && informationAccurate === true
```

Computed inside `evaluateTravelUw` only. Stored on the policy snapshot for BDX/audit; never written by the wizard form.

### What this ADR forbids

- **Self-declared `isExpat` in the wizard.** The path remains in the canonical schema (BDX/audit) but is removed from the `eligibility` step's customer-facing field set.
- **Duration-based REFER or decline.** Peter's directive: residence duration is captured and surfaced in BO, but never gates a quote.
- **Free-text nationality comparison.** The 9-country residence list and the broader nationality list both store canonical country names; comparison is normalised string equality on those values. No `"Cypriot" vs "Cyprus"` heuristics.
- **Per-surface decline copy.** Wizard, audit log, and email all pull from the single canonical `UwDecision.reasons[].message` for the matched code. Renderers do not author their own message.

## Consequences

- **Auditable eligibility.** Every Travel quote carries the seven inputs + the derived `isExpat` flag + (if declined) the named code. Lloyd's oversight has a deterministic trail; "why was this customer declined" answered by reading one row.
- **Tighter UX.** Customers receive a precise reason on screen and can amend the relevant answer without restarting the journey. Per Peter: *"any nonplus answers we say why so client can re-check"*.
- **Wider nationality net.** A British national resident in Cyprus is a normal pass case (nationality dropdown contains UK; comparison against "Cyprus" returns *not equal*). The previous self-declaration could not distinguish "I am British, living in CY" from "I am Cypriot, living in CY".
- **Data shape stable for BDX.** The canonical Travel schema gains seven new paths but `eligibility.isExpat` is preserved — BDX/migration consumers that already read it see derived values where they used to see customer-declared.

## Alternatives considered

- **Keep `isExpat` self-declaration alongside the seven objective answers.** Rejected. Two sources of truth; reconciling them in UW automation reintroduces the ambiguity Jack's note exists to remove.
- **Drop the UW gate ("offer cover to anyone resident in an authorised country").** Rejected — outside binder authority. BRIT BAA is expat-only.
- **Gate on residence duration (e.g. require ≥ 1 year).** Rejected by Peter 2026-05-16. The objective inputs that *do* gate are: nationality vs residence (twice), `willRemainResident`, `legallyPermittedToReside`, `informationAccurate`. Duration and status are advisory/auditable only.

## Migration plan

1. Extend `packages/products/src/travel/profile.ts` with the seven new field contracts + cross-field refinements (one per decline code).
2. Update `packages/products/src/travel/manifest.ts`: 9 BRIT-authorised residence options; canonical full-country list as nationality options; new duration + status enums.
3. Rewrite `frontend/src/products/travel/wizard/components/steps/Step1Eligibility.tsx` to render the new questions. Drop the `isExpat` Yes/No block.
4. Extend `backend/products/travel/underwriting/travelUwAutomation.ts` with the five decline codes + the derivation function. Preserve the existing decline-on-not-expat gate.
5. Pin the decline-code vocabulary + customer-facing copy in `travelUwAutomation.test.ts` (one test per code, exact-string assertion).
6. Update `packages/products/src/travel/__tests__/profile.canonical.test.ts` with positive + each negative path; assert duration/status do not gate.

## Links

- Sister: [ADR-0024](./ADR-0024-travel-customer-residence-as-tax-jurisdiction.md) (per-residence tax)
- Validation contract: [validation.md](../contracts/validation.md)
- Source: BRIT BAA expansion email thread, Jack 2026-04-20, Peter 2026-05-16
