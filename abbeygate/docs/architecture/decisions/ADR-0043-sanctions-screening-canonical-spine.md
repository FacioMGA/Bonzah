---
title: ADR-0043 Sanctions screening canonical spine
audience: architect
status: living
owner: platform-eng
reviewed: 2026-06-09
binding: true
---

# ADR-0043: Sanctions screening canonical spine

## Status

Accepted. Establishes sanctions / PEP screening as a canonical
multi-site concern. Supersedes ad-hoc per-route screening that existed
only at bind/issue.

**Amended by [ADR-0067](./ADR-0067-screening-on-bind-not-quote.md)
(Aug 2026):** the quote-time gate described below was REMOVED. Screening
is now enforced only at bind / payment / issue, where a real, saved
identity exists. Everything else in this spine — provider, service,
repository, audit persistence, BO surface, tipping-off rules, fail-closed
semantics at bind — is unchanged and still binding.

## Context

Lloyd's binders carry sanctions clauses (LMA3100 family) and MLR 2017
reg 28(11) requires customer due diligence "as soon as practicable"
after establishing a business relationship. Quoting a sanctioned or PEP
individual is itself a regulated step under that obligation, so
gating only at bind/issue is too late: a sanctioned subject can walk an
entire wizard and a BO operator can hand-craft a priced quote before
anyone screens. The previous bind-only gate (`v1PoliciesRouter`,
`BindPolicy`, `BindCoverage`, `IssuePolicy`) also persisted a
metadata-only summary — no PDF report, no first-hit projection — so BO
underwriters could not triage a block without re-running the search by
hand.

Three forces drive a single canonical spine:

1. **One concept, many touchpoints.** Every priced quote and every bind
   on every product (Motor, Home, Travel, Health) and every surface
   (customer wizard, BO Recalculate, CardCorp pre-charge re-rate,
   public API bind) must screen against the same provider, same
   datasets, same threshold, same fail-closed semantics.
2. **Audit-first persistence.** The provider response is the regulatory
   evidence. The raw JSON must be stored for every run — clean OR hit —
   and the PDF report stored when one exists. Re-quoting the same
   subject must not burn duplicate Creditsafe credits.
3. **Tipping-off compliance (POCA 2002 s.333A; MLR 2017 reg 86).**
   Customer surfaces MUST NOT reveal that a subject was flagged. BO
   surfaces MUST see the truth (top-hit row + PDF link) for triage.

## Decision

Adopt one spine with one canonical owner per layer.

| Layer | Canonical owner | Notes |
|---|---|---|
| Domain types | `backend/modules/compliance/domain/sanctionsTypes.ts` (`SanctionFirstHit`, `SanctionScreeningRunRecord`, `ScreeningActionType`, `SanctionOutcome`) | Adding a screening site = new value in `ScreeningActionType` + whitelist entry in repository. No competing enum. |
| Service | `backend/modules/compliance/app/sanctionsService.ts` (`SanctionsService.run` / `assertClearOrThrow`) | Single retry on transient, audit-log every outcome, fetch & store PDF on hits. |
| Provider port | `backend/modules/compliance/domain/sanctionsProvider.ts` (`SanctionSearchProvider`) | Two methods only: `searchIndividual`, `downloadIndividualSearchPdf`. |
| Provider impl | `backend/modules/compliance/infra/creditsafeSanctionsProvider.ts` (+ `creditsafeClient.ts`) | Sole importer of `@azure/storage-blob`-style provider creds. Field-name mapping owned here. |
| Repository | `backend/modules/compliance/infra/sanctionsRepository.ts` (`createRunAndDecision`, `linkReportDocument`, `findByIdempotencyKey`) | Sole writer of `SanctionScreeningRun` / `ComplianceDecision` / the `policyStateCurrent.snapshot.compliance.sanctions` projection. |
| Pre-quote gate | **Removed (ADR-0067).** No screening runs at quote time — a price preview never calls Creditsafe and never fail-closes. | Quote-time screening ran on placeholder identities before real details were saved and turned a provider outage into a total sales stoppage (Aug 2026). |
| Bind / payment / issue gate | `getSanctionsService().assertClearOrThrow` directly from `BindPolicy`, `BindCoverage`, `IssuePolicy`, `v1PoliciesRouter`, `cardcorpPolicyIssuanceService`, `cardcorpIssuanceHealService`. Each resolves the subject via `sanctionsSubject.ts` first and BLOCKS with `SANCTION_SCREENING_SUBJECT_MISSING` when only a placeholder / no name exists. | Same service, different `actionType`. Fail-closed. |

### Enforcement chokepoints (bind / payment / issue)

Screening runs only where a real identity exists and cover/money is about
to change hands, via `SanctionsService.assertClearOrThrow`: `BindPolicy`
(`POLICY_BIND`), `BindCoverage` (`POLICY_BIND_COVERAGE`), `IssuePolicy`
(`POLICY_ISSUE`), `v1PoliciesRouter` (`PUBLIC_API_BIND_ISSUE`), and
`cardcorpPolicyIssuanceService` (`PAYMENT_ISSUE`). Each resolves the
subject via `sanctionsSubject.ts` first and BLOCKS with
`SANCTION_SCREENING_SUBJECT_MISSING` when only a placeholder / no name
exists — so a placeholder is never sent to the provider.

The two pricing functions (`quoteRateService.ratePolicyAndPersist`,
`motor/quotes/service.rateQuote`) deliberately do NOT screen (ADR-0067):
a price preview must never be blocked by the compliance provider. Adding a
new product adds no quote-time gate; its bind/payment path inherits the
chokepoints above.

### Search parameters (name + DOB, not country)

The Creditsafe individual search is run on `name` + `dateOfBirth` only.
`countryCodes` is deliberately NOT sent: it filters the AML search and
over-narrows results (a subject whose sanctions/PEP records do not carry
the selected country is excluded), which made the report ineffective.
DOB (`YYYY-MM-DD` or `YYYY`, resolved from `proposer.dateOfBirth`) is more
discriminating and reduces false positives without dropping true hits.
When no valid DOB is available the search runs name-only (a supported
Creditsafe mode). Resolver: `resolveIndividualScreeningSubject` returns
`{ subjectName, dateOfBirth? }`.

### Match gating (name + exact DOB + non-credit dataset)

A provider hit is issue-blocking only when the returned row matches the
subject's exact DOB and carries a non-credit AML dataset (`SAN-*`,
`PEP-*`, `AM`, `ENF`, or `POI`). Name-only hits, DOB-mismatched hits,
hits with no returned DOB, and credit-standing-only hits (`INS`, `DD`)
are persisted with outcome `non_blocking_hit` for BO evidence but do
not block online purchase.

### Persisted shape per run

For every screening run (clear AND hit), `SanctionScreeningRun` stores:
`subjectName`, `subjectType`, `countryCodes[]` (retained for schema
stability, now always empty — subject DOB lives in `requestJson`),
`threshold`, `datasets[]`,
`actionType`, `outcome`, `blocking`, `hitCount`, `providerStatus`,
`providerRiskRating`, `providerSearchId`, full `requestJson`, full
`responseJson` (search metadata + resolved hits array), `correlationId`,
`idempotencyKey`. When hits exist, additionally: `firstHitJson`
projection (`SanctionFirstHit`). For blocking hits, the run also carries
`reportDocumentId` FK to a `Document` row of
`type = 'CREDITSAFE_SANCTIONS_REPORT_PDF'` whose binary is uploaded via
`storageService.uploadFile`. PDF fetch failure is logged but does NOT
downgrade the decision — JSON evidence is already authoritative.

### BO surface

`policyStateCurrent.snapshot.compliance.sanctions` carries the
projected first-hit row + `reportFilename`. `issueReadiness.ts` emits
`SANCTIONS_BLOCKED` / `SANCTIONS_EVIDENCE_MISSING` /
`SANCTIONS_PROVIDER_UNAVAILABLE` blockers with `details.firstHit` +
`details.reportDocumentId` so `PremiumNotes.tsx` and
`UnderwritingReadinessCard.tsx` render the row table + "Download full
report (PDF)" link via `/api/documents/{filename}?inline=1`. No
duplicate projection elsewhere.

### Customer surface (tipping-off)

All four wizards route rate failures through
`frontend/src/shared/lib/wizard/quoteFailureMessage.ts`. When
`errorCode === 'SANCTION_SCREENING_BLOCKED'` the customer sees:

> We are unable to provide an online quote for this application. Our
> team will review it and contact you within 1-2 business days.

When `errorCode === 'SANCTION_SCREENING_UNAVAILABLE'`:

> Quote temporarily unavailable. Please try again shortly.

Never any mention of sanctions, PEP, Creditsafe, or the underlying
reason. The bind-time error follows the same translator (the public API
returns the same code shape from `v1PoliciesRouter`).

### Default dataset selection

Production defaults to the full Creditsafe AML stack (SAN-CURRENT,
SAN-FORMER, PEP-CURRENT, PEP-FORMER, PEP-LINKED, AM, ENF, INS, DD,
POI) per Lloyd's binder language; one Creditsafe credit covers every
dataset in a single search. The smoke verifier
(`tools/smoke/sanctions-screening-verify.mjs`) deliberately runs on
`SAN-CURRENT` only to keep the cheap path exercised — its test subject
(Saud Al-Qahtani, SA) hits against the single dataset.

### Idempotency

Bind / payment / issue runs reuse the request-supplied `idempotencyKey`
(typically the correlation id) so retries dedup against the same row. (The
former quote-time idempotency key
`sha256("creditsafe:QUOTE_RATE:" + normalisedName + "|" + dob)` is retired
with the quote gate — ADR-0067.)

## Allowed mirrors / projections

- `policyStateCurrent.snapshot.compliance.sanctions` — denormalised
  current-state projection. Patched ONLY by
  `SanctionsRepository.createRunAndDecision` and
  `SanctionsRepository.linkReportDocument`.
- `Document` rows of `type = 'CREDITSAFE_SANCTIONS_REPORT_PDF'` linked
  via `SanctionScreeningRun.reportDocumentId`.
- Issue-readiness blockers (`SANCTIONS_BLOCKED`,
  `SANCTIONS_EVIDENCE_MISSING`, `SANCTIONS_PROVIDER_UNAVAILABLE`) — UI
  derived state. Computed by `issueReadiness.ts` from the snapshot;
  never persisted as a separate field.
- Outbox event `POLICY.COMPLIANCE.SANCTIONS_DECIDED` — for downstream
  consumers (BDX reconciliation, monitoring). Emitted only inside the
  repository transaction.

## Forbidden

- A second sanctions provider integration outside
  `backend/modules/compliance/infra/`.
- Pricing or binding code that calls Creditsafe directly (must go
  through the service).
- A new screening site that doesn't add a value to `ScreeningActionType`
  + the repository whitelist — silent string action types are banned by
  the repository's `toScreeningActionType` runtime check.
- A customer-facing surface that renders the underlying screening
  reason. The translator
  (`quoteFailureMessage.ts` / `handleQuoteSanctionsBlockOnRoute`) is the
  single seam.
- A BO surface that re-implements the first-hit row instead of
  rendering `frontend/src/modules/policies/compliance/views/SanctionsHitRow.tsx`.
- A PDF cache outside the `Document` table or a parallel report-blob
  path (the `storageService.uploadFile` + `Document` row pattern is
  shared with issued policy packs — same blob backend, same
  `/api/documents/:filename` serving route).
- Hand-editing the `responseJson` to strip hits — the column is the
  audit record.

## Escalation

- **Write a follow-up ADR** to: change provider, change the default
  dataset selection, add a new screening action type that is NOT a
  re-run of an existing concept, weaken fail-closed semantics, or
  introduce a customer-facing message that mentions sanctions.
- **Stop and ask** to: cache screening decisions across policies (the
  current idempotency is per-policy-row by design — cross-policy
  sharing has data-protection implications), expose the persisted
  hit details to the customer for any reason, persist Creditsafe
  credentials anywhere other than env-var-driven config.

## Links

- Canonical-ownership row: `docs/architecture/contracts/canonical-ownership.md`
- Lloyd's regulatory anchor: `.cursor/skills/lloyds-mga-regulatory/SKILL.md`
- Smoke verifier: `tools/smoke/sanctions-screening-verify.mjs`
- Migration: `prisma/migrations/20260609000000_sanctions_run_first_hit_and_report_doc/`
