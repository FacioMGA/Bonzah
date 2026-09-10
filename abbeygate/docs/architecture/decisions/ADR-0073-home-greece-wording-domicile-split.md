---
title: ADR-0073 Home Greece policy wording is domicile-split
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-14
binding: true
---

# ADR-0073: Home Greece policy wording is domicile-split

## Status

Accepted. Supersedes the Greece portion of [ADR-0048](./ADR-0048-home-policy-wording-tenant-and-domicile-aware.md).

## Context

ADR-0048 made the Home policy wording tenant + domicile-aware but recorded
Greece as a **single** wording for every domicile — the stale
`CH/ABG/11.2020/CY/V1` asset (`policy_home_gr.pdf`), a 2020, Cyprus-referenced
document. That was correct when written but is now wrong: Abbeygate's live
Greece site (`abbeygate.gr` policy-documents portal — the reference Peter
confirmed) publishes **two** current Lloyd's/Beazley 2023 Greece wordings, one
per domicile, exactly like Cyprus and Portugal. Greece Home policyholders were
therefore being issued a three-year-old Cyprus-referenced wording.

## Decision

Greece joins the domicile-aware matrix in
`backend/products/home/documents/policyWording.ts` with two distinct wordings,
references verbatim from each PDF cover:

- **GR / UK** → `BZ/ABG/11.2023/GRUK v1` (`Abbeygate_Home_Greece_UK_Domiciled.pdf`)
- **GR / NON_UK** → `BZ/ABG/11.2023/GR v1` (`Abbeygate_Home_Greece_Domiciled.pdf`)

The single `policy_home_gr.pdf` / `CH/ABG/11.2020/CY/V1` asset is removed. The
Greece **IPID** (`LloydsHome_IPID_GR.pdf`) is unchanged — the IPID does not vary
by domicile (ADR-0048). Both new assets are git-committed via `.gitignore`
allowlist and asserted at boot (`startupValidation.ts`) and image build
(`Dockerfile.api` / `Dockerfile.worker`), so a missing asset fails loudly rather
than emitting the wrong wording (no-defensive-fallbacks, ADR-0048 posture).

## Consequences

- Greece issued packs attach the correct 2023 wording for the primary insured's
  domicile and print the matching reference; the schedule reference and the
  attached PDF cannot diverge (same resolver as CY/PT, ADR-0048).
- The stale 2020 Cyprus-referenced Greece wording can no longer be issued.
- The current site PDFs are shipped as the assets; Peter's forthcoming
  text-size-corrected finals carry the **same** `GR v1` / `GRUK v1` references,
  so applying them is a byte-swap of the two PDFs with no code change.
- Regression: `policyWording.test.ts` now asserts the two distinct Greece
  wordings instead of a single shared one.
