---
title: ADR-0053 Health (Immigration Medical) Greece jurisdiction gate
audience: architect
status: living
owner: platform-eng
reviewed: 2026-07-23
binding: true
---

# ADR-0053: Health for Greece is gated on regulatory sign-off

## Status

Accepted — the gate is live and enforced; `GR/HEALTH` is BLOCKED pending
regulatory confirmation. This ADR is the
[ADR-0032](./ADR-0032-health-product-introduction.md) §"Open follow-ups" #6 record for Greece.
No `GR/HEALTH` code lands until the open questions below are answered.

## Context

During the Greece go-live (bringing `abbeygate-gr` to Cyprus product parity), the
instruction was to "match Cyprus exactly". Cyprus's live set is six products;
Greece already matches for MOTOR, HOME, TRAVEL and — via this go-live — BUSINESS
and OPEN_MARKET. HEALTH is the exception.

The Health product (ADR-0032) is specifically **Brit Immigration Medical
Insurance** sold to expat residents **of the Republic of Cyprus** as part of a
Cyprus immigration application. It rides the BRIT travel BAA (UMR
`B176023EEA6153`), its underwriting appetite is hard-coded to
`allowedResidenceCountries: ['Cyprus']` (`healthUwAutomation.ts`), and its
documents (IPID, Section A wording) are Cyprus-immigration artefacts. Enabling it
for Greece is therefore **not** a config mirror — it would encode a new
regulatory interpretation, which the Lloyd's MGA contract forbids doing without a
source-backed decision.

## Decision

1. **Do not enable `GR/HEALTH` by config mirror.** Adding a `GR/HEALTH` `CONFIGS`
   row, a `GR_HEALTH_*` tax profile, a GR health document preset, widening
   `healthUwAutomation` `allowedResidenceCountries`, or removing
   `availableCountryCodes: ['CY']` from the catalog are all blocked until the
   open questions are resolved.
2. **The conformance matrix stays self-maintaining.** HEALTH × GR remains
   excluded automatically (no `CONFIGS` row) per ADR-0032; the parity guard for
   Greece explicitly excludes HEALTH (see `productConformance.engines.test.ts`).
3. **Greece go-live proceeds for the other five products** without HEALTH.

## Open questions (must be answered before any code)

1. **Lloyd's / BRIT delegated authority.** Does the BRIT BAA authorise the
   Immigration Medical class for a Greece-resident risk, or only Cyprus? Cite the
   binder territorial authority.
2. **Product definition.** Does Greece sell the *Cyprus immigration* cover, or a
   distinct Greece medical product? This drives eligibility copy (GESY vs Greek
   national health), UW appetite, and wording.
3. **GR Health IPT treatment.** Cyprus medical is modelled €0-exempt. Greece IPT
   for medical must be confirmed and, if positive, encoded in the tax profile
   resolver — never inline (`no-defensive-fallbacks`).
4. **Documents.** Greece IPID + policy wording (or explicit reuse of the Cyprus
   Section A artefacts if authorised).

## Consequences

- Greece customers cannot buy Health online until this ADR moves to Accepted with
  the questions answered. This is intentional fail-closed behaviour, not a defect.
- When authorised, the code change is the ADR-0032 §6 checklist (GR/HEALTH config,
  tax profile, document preset, UW appetite, catalog availability) plus tests.

## Links

- Parent: [ADR-0032](./ADR-0032-health-product-introduction.md) (Health introduction, CY-only Phase 1)
- Sibling: [ADR-0049](./ADR-0049-cardcorp-per-tenant-live-cutover.md) (per-tenant live cutover)
- Source: Greece go-live instruction, 2026-07-23; contract `docs/architecture/contracts/jurisdiction-product-config.md`
