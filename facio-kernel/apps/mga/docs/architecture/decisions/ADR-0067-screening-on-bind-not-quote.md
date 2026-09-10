---
title: ADR-0067 Sanctions screening runs on bind, not quote
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-10
binding: true
---

# ADR-0067: Sanctions screening runs on bind, not quote

## Status

Accepted. Amends [ADR-0043](./ADR-0043-sanctions-screening-canonical-spine.md).
Removes the quote-time sanctions gate. The rest of the ADR-0043 spine
(provider, service, repository, audit persistence, BO surface,
tipping-off rules, fail-closed semantics at bind) stays binding.

## Context

ADR-0043 gated screening at BOTH quote time and bind/issue, reasoning that
quoting a sanctioned individual is itself a regulated step. In production
that quote-time gate did more harm than good:

1. **It stopped all sales during a provider outage.** The gate is
   fail-closed: when Creditsafe could not screen, every quote returned a
   503 "Quote temporarily unavailable". In Aug 2026 the Creditsafe/Acuris
   account was deactivated provider-side; online quoting was down for days
   before anyone noticed, because a 503 turn-away is not a crash.
2. **It screened placeholders, not people.** Travel/Health show an
   anonymous price indication first and collect the customer's real name,
   email and phone later. The quote gate ran against the session
   placeholder identity ("Quote in progress"), burning Creditsafe credits
   on non-people and polluting the audit record — while still not having
   screened the real customer.

The business reviewed the quotation journeys and decided screening should
run once we hold the customer's real, saved identity and before cover or
money changes hands — i.e. at bind / payment / issue — which those gates
already do, fail-closed. "Run it on bind" was explicitly confirmed
(Abbeygate, Aug 2026).

This is still MLR 2017 reg 28(11) CDD "as soon as practicable after
establishing a business relationship": the relationship is established when
the customer commits to buy (bind), not when an anonymous price preview is
shown. No cover is bound and no payment is taken before a fail-closed
screen passes.

## Decision

1. **No screening at quote time.** The pre-quote gate
   (`quoteSanctionsGate.ts`, `assertSanctionsClearForQuote`) and its two
   call sites (`quoteRateService.ratePolicyAndPersist`,
   `motor/quotes/service.rateQuote`) are removed. A price preview never
   calls Creditsafe and can never be blocked or fail-closed by it.
2. **Screening stays mandatory and fail-closed at bind / payment / issue.**
   `BindPolicy`, `BindCoverage`, `IssuePolicy`, `v1PoliciesRouter`,
   `cardcorpPolicyIssuanceService` are unchanged: they screen via
   `SanctionsService.assertClearOrThrow` and block on any non-clear or
   provider-unavailable outcome. Payment, binding and issuance remain
   blocked until screening succeeds.
3. **Screen before opening the public payment page (`PAYMENT_CHECKOUT`).**
   Removing the quote gate would otherwise let a Travel/Health customer reach
   CardCorp checkout unscreened (screening only caught up at post-payment
   issuance). `cardcorpCheckoutService.createCardcorpAutoCheckout` now screens
   the real, saved subject before it creates the OPPWA checkout and refuses to
   open payment on a block or provider outage — this is the "block payment
   until screening succeeds" rule. Issuance (`PAYMENT_ISSUE`) still screens as
   a backstop.
4. **Never send a placeholder identity to the provider.**
   `resolveIndividualScreeningSubject` returns no subject for system
   placeholders ("Quote in progress", "New Submission",
   "Auto Quote (In Progress)"). A payment/bind/issue path with only a
   placeholder therefore blocks with `SANCTION_SCREENING_SUBJECT_MISSING` —
   screening runs only once a real name is saved.

## Consequences

- A Creditsafe outage can no longer stop quoting or lead capture; it blocks
  only the final bind/payment until the provider is restored. Leads entered
  during an outage remain recoverable.
- Every bound/paid/issued policy is still screened against the same
  provider, datasets and threshold, with the same audit persistence — the
  legal control is intact.
- `ScreeningActionType.QUOTE_RATE` remains a valid value (no active caller)
  so the concept can be re-introduced as a NON-blocking audit screen later
  without another enum change; re-adding a *blocking* quote gate needs a new
  ADR.

## Forbidden

- Re-introducing any quote-time screening that can block or fail-close a
  price preview.
- A bind/payment/issue path that screens a placeholder identity instead of
  blocking on the missing real subject.
- Weakening the bind/payment/issue gates to fail-open (see ADR-0043
  Escalation + `.cursor/skills/lloyds-coverholder-compliance/SKILL.md`).

## Links

- Amends: [ADR-0043](./ADR-0043-sanctions-screening-canonical-spine.md)
- Canonical-ownership row: `docs/architecture/contracts/canonical-ownership.md`
- Skill: `.cursor/skills/lloyds-coverholder-compliance/SKILL.md`
