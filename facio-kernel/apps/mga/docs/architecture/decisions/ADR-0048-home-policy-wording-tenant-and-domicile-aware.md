---
title: ADR-0048 Home policy wording is tenant- and domicile-aware
audience: architect
status: living
owner: platform-eng
reviewed: 2026-07-02
binding: true
---

# ADR-0048: Home policy wording is selected by tenant territory × client domicile

## Status

Accepted. Closes the client report: "Portugal home insurance is still
sending the Cyprus policy wording."

## Context

The Lloyd's Home policy wording that must be attached to an issued policy
(and referenced on the schedule) depends on **two** dimensions:

1. the operating tenant's **territory** (Cyprus, Portugal, …), and
2. the named client's **domicile** — a UK-domiciled proposer is written on
   a different Lloyd's wording than a locally-domiciled proposer. For every
   territory there are two wordings: one for UK-domiciled clients and one
   for clients domiciled anywhere else.

The Home doc pack modelled neither dimension. Unlike Motor
(`generateMotorDocPack.ts` resolves `resolveJurisdictionProductConfig` and
reads `documentConfig.wordingReference`), Home ran through the generic
`generateProductDocPack` → `selectProductDocsFromContract`, which filters
entries only by `docPack`. The wording was a single hardcoded static entry
in `HOME_DOCUMENT_PACK_CONTRACT` pointing at the Cyprus (non-UK) PDF, and
the schedule's `{{policyWording}}` was the hardcoded string
`'BZ/ABG/11.2023/CY v1'` in `viewModel.ts`. Every tenant and every domicile
therefore received the Cyprus non-UK wording — a Portugal policyholder got
Cyprus wording (wrong governing law, wrong Service-of-Suit, wrong
complaints route). This violates the `jurisdiction-product-config` contract
("hardcoded wording in templates or view models" and "hidden country
fallback to Cyprus" are both forbidden).

## Decision

Introduce a single canonical owner for the Home wording selection:
`backend/products/home/documents/policyWording.ts`.

1. **`HOME_POLICY_WORDINGS`** — a data matrix keyed by tenant `countryCode`,
   each row holding the `UK` and `NON_UK` wording (customer-facing filename,
   product-owned static PDF path, schedule reference verbatim from the PDF
   cover, and a unique asset version). No `if (country === …)` branches.
2. **`resolveHomeWordingDomicile(quoteData)`** — the wording follows the
   **primary insured** (`proposer.domicileCountry`) only: `UK` when the
   primary proposer is domiciled in the United Kingdom, otherwise `NON_UK`.
   The domicile of joint policyholders does not change the wording.
3. **`resolveHomePolicyWording(countryCode, domicile)`** — returns the entry
   or throws `HomePolicyWordingNotConfiguredError` for an unconfigured
   territory. There is no default row and no fallback to Cyprus.
4. Both consumers use the same resolver: `generateHomeDocPack`'s `selectDocs`
   overrides the `HOME_POLICY_WORDING_PDF` asset, and `viewModel.ts` sets
   `policyWording` to the matching `reference`, so the attached PDF and the
   printed reference can never diverge.
5. The `HOME_DOCUMENT_PACK_CONTRACT` entry for `HOME_POLICY_WORDING_PDF`
   remains as the schema anchor (declares the doc type as
   required-for-issued + email-attachment); its path/filename/version are
   always overridden at selection time.

Initial matrix: **Cyprus** (UK: `BZ/ABG/11.2023/CYUK v1`, non-UK:
`BZ/ABG/11.2023/CY v1`), **Portugal** (UK: `BZ/ABG/11.2023/ESPT UK v1`,
non-UK: `BZ/ABG/11.2023/PT v2`) and **Greece** (`CH/ABG/11.2020/CY/V1` — a
single wording for every domicile). The three
online territories (CY, PT, GR) are open;
Spain has no online purchase route and is intentionally left unconfigured
(fails loud).

The **IPID** is likewise territory-aware (`resolveHomeIpid`, keyed by
territory only — IPID does not vary by domicile): Cyprus uses the combined
Cyprus/Greece IPID, Portugal uses the approved Spain/Portugal IPID
`BeazleyHome_IPID_SpainAndPortugal.pdf`, and Greece uses its own
`LloydsHome_IPID_GR.pdf`.

## Consequences

- **Portugal** issued packs now attach the correct Portugal wording (UK or
  non-UK by domicile) and print the matching reference; the reported defect
  is fixed. **Cyprus** now correctly distinguishes UK-domiciled clients
  (previously every CY client received the non-UK wording). **Greece** is
  open with its single wording and its own IPID.
- **Spain Home** has no wording/IPID configured. Home issuance for ES now
  **fails loud** (`HOME_POLICY_WORDING_NOT_CONFIGURED`) instead of silently
  emitting the Cyprus wording. This is intentional (Spain has no online
  purchase route today, and shipping the wrong territory's Lloyd's wording is
  a compliance defect). Opening ES is a follow-up once its wording is
  supplied: add the PDF(s), a matrix row, and the four registrations below.
- Four static PDFs are registered for boot-time (`startupValidation.ts`),
  CI (`verify-runtime-artifacts.mjs`), image (`Dockerfile.api` /
  `Dockerfile.worker`) and git (`.gitignore` allow-list) so a missing asset
  fails before any policy is issued.
- **No data migration.** Already-issued policies keep their snapshotted
  documents; this changes only newly-generated packs.

## Refused alternatives

- **`?? cyprusWording` fallback** for unconfigured territories — the exact
  bug, banned by `no-defensive-fallbacks`.
- **`if (countryCode === 'PT')` in the doc pipeline** — banned by
  `contract-spine`; replaced by the data matrix.
- **Storing the wording PDF assets inside shared `documentConfig`** — the
  jurisdiction config is a shared module and must not carry product-owned
  asset paths. `documentConfig` continues to own the territory dimension;
  the Home product owns the `(territory, domicile) → asset` matrix, keeping
  the shared/product boundary intact.
- **Keying wording off property/risk location rather than tenant + client
  domicile** — the wording is determined by the operating territory and the
  policyholder's domicile, not the insured address.

## Out of scope (flagged follow-up)

The Home schedule view model still hardcodes Cyprus legal-contact fields
(`legalContacts.serviceOfSuit`, `coverholderUmr` default `B176025EEA6551`)
regardless of tenant. Those are separate from the attached wording PDF and
are not addressed here; they should be made jurisdiction-resolved in a
follow-up.

## Sources

- `backend/products/home/documents/policyWording.ts` — canonical resolver + matrix.
- `backend/products/home/documents/generateHomeDocPack.ts` — selection override.
- `backend/products/home/documents/viewModel.ts` — schedule reference.
- `docs/architecture/contracts/jurisdiction-product-config.md` — wording must not be hardcoded / fall back to Cyprus.
- ADR-0019 — binder authority discipline; ADR-0024 — precedent for a per-quote dimension (Travel customer residence).
