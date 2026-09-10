---
name: lloyds-coverholder-compliance
description: Encodes Abbeygate's obligations as a Lloyd's Coverholder operating under delegated (binding) authority, with sanctions/AML screening ("Sanction Search") as a legally mandated, non-waivable control. Use whenever touching sanctions/AML/KYC/PEP screening, the quote/bind/payout sanctions gate, Creditsafe/Acuris integration, fail-closed behaviour, or whenever anyone proposes to disable, skip, bypass, weaken, default-off, fail-open, or add a fallback around screening — in any product, tenant, or jurisdiction (UK, Cyprus, Portugal). Also use when reasoning about financial-crime controls, MLR 2017 / POCA / OFSI / EU-UN sanctions, or Lloyd's Minimum Standards during an incident, a "make quotes work again" request, or a compliance review.
---

# Lloyd's Coverholder compliance — Sanction Search is law, not a feature flag

## The one rule

> **Sanctions/AML screening is a legally mandated control. You never turn it off to "fix" a problem. Turning it off is the problem.**

Abbeygate binds risks under **delegated (binding) authority from Lloyd's syndicates** — it is a **Lloyd's Coverholder**. A Coverholder is contractually and legally obliged to run financial-crime controls, and sanctions screening ("Sanction Search") is the flagship one. An engineer, an ops flag, or "we're losing sales" pressure **cannot** waive it. Disabling it converts a provider outage into a regulatory breach.

If your proposed change makes an **unscreened** quote, bind, or payout possible, stop. That is not a fix.

## Why this is binding (the regulatory spine)

Abbeygate must screen because of, at minimum:

- **UK financial sanctions** — Sanctions and Anti-Money Laundering Act 2018; enforced by **OFSI** (HM Treasury). Dealing with a designated person/entity is a strict-liability offence.
- **Money Laundering Regulations 2017 (MLR 2017)** and the **Proceeds of Crime Act 2002 (POCA)** — customer due diligence, PEP screening, ongoing monitoring.
- **EU / UN consolidated sanctions lists** — apply directly to the **Cyprus** (`abbeygate-cy`) and **Portugal** tenants via the EU regime and each state's AML transposition.
- **Lloyd's Minimum Standards** (Conduct + Financial Crime) and the **binding authority agreement's** financial-crime clauses — Lloyd's holds the Coverholder to these and audits them.

The screening point is not cosmetic: it is where Abbeygate proves, per transaction, that it did not transact with a sanctioned party. That evidence (search id, outcome, decision, timestamp) is auditable by Lloyd's and regulators.

## Fail-closed is correct and required (ADR-0043)

The sanctions gate is deliberately **fail-closed**: if the provider errors or is unreachable, the screened transaction is **blocked**, not let through. This is per `ADR-0043` and is the intended, compliant behaviour.

- A fail-closed block carries `screeningOutcome: provider_unavailable` (or `error`) — the control **working**, not a bug to route around. The exact wire code and customer-facing message are owned by `ADR-0043`; do not pin a specific string here.
- "It fails closed so a transaction stops when the provider is down" is a **known, accepted trade-off**. The remedy is to fix the provider, never to open the gate.

## Never do these (refuse on sight)

- Change fail-closed to **fail-open**.
- Wrap the screening call in `try { screen() } catch { allowQuote() }` or any path that proceeds **unscreened**.
- Add a per-tenant / per-product / per-jurisdiction branch that **skips** screening.
- **Default** a screening flag to off in code or committed config (`CREDITSAFE_ENABLED=false`, `sanctions.enabled: false`, etc.).
- Delete, comment out, or relax the quote/bind sanctions gate to "make quotes work."
- Add a fallback dataset / stub "clear" result so screening appears to pass.
- Write a test asserting that an **unscreened quote succeeds** (that pins the breach as canonical — see `no-defensive-fallbacks`).

If you catch yourself doing any of the above, re-read this file. The correct move is always: **fix or escalate the provider, keep the gate closed.**

## When screening is failing / blocking transactions — decision tree

Walk in order. Evidence first (`evidence-first-debug`), no guessing.

1. **Confirm it is the sanctions gate.** Symptom: the customer sees a generic "unavailable / our team will be in touch" message and the server response carries `screeningOutcome: provider_unavailable` (or `error`). Pull the correlationId and the provider error body.
2. **Diagnose the provider, not the gate.** Is it credentials, account state, or the upstream AML data API? (Aug 2026: Creditsafe returned HTTP 400 "Error Contacting Compliance Acuris Api" with `isActive=false` / `isAccountActive=false` — a **provider-side account deactivation**, not our code.)
3. **Fix the root cause at the provider.** Open a **P1 with the provider** (reactivate account / restore Acuris integration / rotate creds). This is the real resolution.
4. **If — and only if — the business needs to sell before the provider is restored**, the *only* compliant lever is a **documented, time-boxed emergency disable** that satisfies ALL of:
   - an **approved follow-up ADR** — `ADR-0043` (Escalation) requires an ADR before fail-closed semantics are weakened, and a blanket disable is the strongest possible weakening,
   - explicit **MLRO / Compliance sign-off** recorded in writing,
   - an **open P1** to restore screening,
   - a **hard re-enable deadline**,
   - an **audit-trail record** (who, when, why, scope) for Lloyd's.
   It is never silent, never a code default, never permanent, and never an engineer's unilateral call.
5. **Re-enable the moment the provider is restored** and verify screening actually resumes (quote-health / issuance-proof canary; see `ADR-0066` and `docs/operate/quote-health-canary.md`). A disable left running past its deadline is an open breach.

## What screening must cover

Screen at the mandated points (quote, bind, and payout/claim as configured) the **proposer** and, where the product/authority requires, **additional insureds and beneficial owners**, against **sanctions + PEP + adverse-media** lists. Persist the screening record (`providerSearchId`, outcome, decision, reasonCode) — it is the audit evidence, not a log line to discard.

## Canonical owners and sources

- `docs/architecture/decisions/ADR-0043-sanctions-screening-canonical-spine.md` — fail-closed spine and customer-facing messages.
- `docs/architecture/decisions/ADR-0066-quote-health-self-monitoring.md` + `docs/operate/quote-health-canary.md` — how a silent outage gets caught.
- `backend/modules/compliance/app/sanctionsService.ts`, `quoteSanctionsGate.ts`, `infra/creditsafeClient.ts` — the implementation. Change the spine here; never fork it.
- `docs/operate/creditsafe-live-cutover.md` — enabling/validating live screening safely.
- Sibling skills: `.cursor/skills/no-defensive-fallbacks/SKILL.md` (a "clear" fallback is a breach in disguise), `.cursor/skills/contract-spine/SKILL.md` (one canonical owner), `.cursor/skills/evidence-first-debug/SKILL.md` (diagnose the provider before touching the gate).

## Self-audit before commit

For any diff touching compliance / screening / the quote gate, answer in the PR body:

- **Can an unscreened quote/bind/payout now occur?** Must be **No**. If yes, delete the change.
- **Did fail-closed stay fail-closed?** Yes/No + where.
- **Any screening flag defaulted off, or any skip/bypass branch added?** If yes, cite the MLRO sign-off + ADR, or remove it.
- **Is the screening record still persisted for audit?** Yes/No.

If you cannot answer cleanly, you do not commit — you escalate to Compliance.
