---
title: ADR-0056 BDX declared premium authority and import identity fidelity
audience: architect
status: living
owner: platform-eng
reviewed: 2026-07-30
binding: true
---

# ADR-0056: BDX declared premium authority, import identity fidelity, and ratification of the 2026-07-30 premium remediation

## Status

Accepted.

## Context

The 2026-07-30 production reconciliation (client-flagged policies vs. every
bordereau held under `artifacts/`; evidence in
`artifacts/reporting/bdx-production-reconciliation-2026-07-30/` and
`artifacts/reporting/bdx-premium-remediation-2026-07-30/`) proved three
systemic defects in the BDX import pipeline:

1. **Premium substitution.** The importer re-rated every historical row
   through the current product calculators and persisted the calculator's
   answer, discarding the premium the coverholder actually declared, collected
   and reported to Lloyd's. Zero of 8,255 matched policies carried their
   bordereau premium; the book was over-stated by a net €787,214.49.
2. **Policyholder collapse.** The Home and Travel mappers stamped one shared
   placeholder proposer email (`bdx-import@import.local`) on every row, and
   `materializeCustomerAccountForPolicy` in `autoAttach` mode dedupes holders
   by email — so ~8,900 imported policies were re-linked to the first holder
   carrying the placeholder (7,494 on one name, 1,388 on another).
3. **Transaction rows as policies.** `assignPolicyImportDispositions` marked
   the earliest held row of every policy group `IMPORT_POLICY` regardless of
   its transaction type, and the replay engine created a base policy whenever
   none existed. PAM/ADJ/CAN/NTU adjustment lines whose NB/RNL term row was
   not in the held files became standalone production policies (121 confirmed,
   including cancellations sitting as active policies).

The premium correction was executed on 2026-07-30 as a data migration
(`align_bdx_declared_premiums_2026-07-30`): 8,106 policies updated in place
with a `bdxPremiumAlignment` audit block, integrity stamps recomputed,
projections rebuilt, full pre-change backup archived. The binding runbook
`docs/operate/bdx-recovery-rules.md` prescribes correction endorsements for
issued-policy corrections in production, so that execution requires explicit
ratification.

## Decision

1. **Ratify the 2026-07-30 remediation as a bounded, one-time exception** to
   the correction-endorsement rule. It qualified because: every write carried
   a full audit block (calculator premium, declared premium, typed
   loading/discount delta, source file/sheet/row provenance); the complete
   pre-change pricing state of all affected policies was archived and the run
   is reversible; pricing-integrity stamps were recomputed so no policy can
   silently drift past issue-readiness; the approved calculators were not
   modified; and running 8,106 correction endorsements would have generated
   customer-facing documents and emails for a book-level data repair. This
   ratification does not create precedent: future issued-policy corrections
   follow the runbook unless a new ADR ratifies another bounded exception.

2. **The bordereau's declared premium is authoritative for BDX-imported
   policies.** The product calculator still rates every row (validation and
   breakdown provenance), but the persisted premium MUST equal the declared
   premium, with any calculator gap applied as an explicit loading/discount
   breakdown line (`adjustment.bdxDeclaredAlignment`) and recorded in a
   `bdxPremiumAlignment` audit block. Canonical owner:
   `backend/modules/policy/app/bdxImport/declaredPremiumAlignment.ts`, applied
   in both `importPassingRow` and `importRenewalTermRow` before the pricing
   stamp is computed. The structure is byte-compatible with what the
   remediation wrote, so the whole book carries one alignment shape. Rows with
   no positive declared premium are never aligned (no free policies); a
   quoteResponse without `primaryOption` fails loudly. Alignment is visible
   end-to-end: `discount` joins the travel breakdown-line kind union, the BO
   premium tab renders `loading`/`discount` lines, schedules keep negative
   lines, and the line-less home schedule renders
   `breakdown.bdxDeclaredAlignment` as a dedicated "Premium Adjustment" row.

3. **Placeholder identity never participates in customer dedupe.** All three
   product mappers stamp a per-certificate synthetic email via the single
   helper `importPlaceholderEmail()` (`productMappers/shared.ts`), and
   `materializeCustomerAccountForPolicy` excludes any `@import.local` address
   from holder matching (NIF matching is unaffected). Both halves are
   independent defenses; each alone would have prevented the collapse.

4. **A transaction line never opens a policy term.** Only NB, NB/COC and RNL
   rows (`TERM_CREATING_BDX_ENTRIES` / `isTermCreatingBdxEntry()` in
   `reporting/app/bdxImport/types.ts`) may be disposed `IMPORT_POLICY` or
   create a base policy in the replay engine. A PAM/ADJ/FIVA-PAM/CAN/NTU row
   with no imported base fails closed with
   `blocked_transaction_row_without_base` and an operator-actionable reason —
   the import surfaces the missing term row instead of fabricating a policy.

## Consequences

- Newly imported policies match their bordereau to the cent by construction;
  premium reconciliation becomes a no-op check instead of a forensic exercise.
- Orphan transaction rows now fail their group loudly (base row missing →
  blocked). This is intentional: the previous behavior silently created
  phantom policies. Operators resolve by supplying the term row's file.
- The 121 existing transaction-row policies and the 7,209 misattributed
  holder names remain open remediation items (tracked in the 2026-07-30
  remediation report); this ADR fixes recurrence, not the backlog.
- Regression pins: `declaredPremiumAlignment.test.ts`,
  `customerAccountMaterialization.test.ts`, `bdxReplayEngine.test.ts`
  (transaction-line block), `bdxImport.service.test.ts` (disposition),
  `mapperRegression.test.ts` (per-certificate emails), `PremiumTab.test.ts`
  and travel/home `viewModel.test.ts` (alignment lines stay visible).

## Alternatives considered and rejected

- **Correction endorsements for the 8,106-policy repair.** Rejected for the
  bounded exception: endorsement issuance generates documents/emails per
  policy and re-rates through `RateEndorsementDraft`, which cannot express
  "persist the declared premium" without modifying approved calculators.
- **A generic `uw.adjustment` input on every calculator.** Rejected: it would
  change approved, client-signed rating logic and invite ad-hoc manual
  pricing outside underwriting authority.
- **Skipping orphan transaction rows instead of blocking.** Rejected: a
  silently skipped financial line under-states the book; fail-closed with a
  named reason is the `no-defensive-fallbacks` posture.
- **Keeping one shared import email and only patching the matcher.** Rejected:
  identity should be honest at the source; the per-certificate email also
  keeps re-imports of the same certificate idempotent on the same holder.

## Links

- Incident evidence: `artifacts/reporting/bdx-production-reconciliation-2026-07-30/report.md`.
- Remediation evidence + backup: `artifacts/reporting/bdx-premium-remediation-2026-07-30/report.md`.
- Runbook whose exception this ratifies: `docs/operate/bdx-recovery-rules.md`.
- Code owners: `backend/modules/policy/app/bdxImport/declaredPremiumAlignment.ts`,
  `backend/modules/policy/app/customerAccountMaterialization.ts`,
  `backend/modules/policy/app/bdxReplayEngine.ts`,
  `backend/modules/reporting/app/bdxImport/{types.ts,service.ts,productMappers/shared.ts}`.
- Predecessor ADRs: [ADR-0051](./ADR-0051-historical-bdx-import-assertions.md)
  (historical import assertions), ADR-0051 (pre-go-live test-data reset).
