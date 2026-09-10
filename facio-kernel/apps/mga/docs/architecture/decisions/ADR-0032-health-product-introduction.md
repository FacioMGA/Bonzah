---
title: ADR-0032 Health (Brit Immigration Medical) product introduction
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-28
binding: true
---

# ADR-0032: Introduction of the Health (Brit Immigration Medical) product

## Status

Accepted. CY-only Phase 1. Ships alongside [ADR-0024](./ADR-0024-travel-customer-residence-as-tax-jurisdiction.md) / [ADR-0025](./ADR-0025-travel-objective-expat-eligibility.md) (Travel expat patterns) — Health reuses both the objective-expat eligibility shape and the Travel BRIT binder family.

## Context

Abbeygate sells Brit Immigration Medical Insurance to expat residents of the Republic of Cyprus as part of their immigration application. It is sold under the same BRIT BAA as Travel (UMR `B176023EEA6153` on the schedule, BRIT binders `B176024/25/26EEA6153`). Until now the product did not exist in the platform; it was sold off-platform and the customer was issued PDFs by hand.

Adding the product through the canonical spine means:
1. Same MGA jurisdiction config story as Motor/Home/Travel — every (countryCode, productCode) pair must be present in `CONFIGS` or fail loud (`spine/v2` Wave 5 posture).
2. Same `IProductAdapter` + `ProductRuntimeDefinition` shape every other product implements — no new spine.
3. Same MBE endorsement registry surface for the BO Programs > Coverage tab and the wizard MBE auto-rate.
4. Same `/api/public/health/session/*` generic public quote router auto-wired off the catalog.
5. Same single source of truth for wizard step validation and BO UW questionnaire — `healthValidationProfile.steps[*]` AND `healthManifest.questionnaire.sections[*]`, with NO Zod in wizard schemas (`guard:no-zod-in-product-wizard-schemas`).

## Decision

1. **Internal product code:** `HEALTH`. Customer-facing display name: "Immigration Medical Insurance". [ADR-0047](./ADR-0047-carrier-branded-product-policy-numbering.md) supersedes the launch placeholder and owns the canonical policy format `BRIT/ABG/<CC>/IM/<SEQ>` starting at `5001025`.
2. **Jurisdiction scope (Phase 1):** Cyprus only. `JurisdictionProductCode` is extended to `'MOTOR' | 'HOME' | 'TRAVEL' | 'HEALTH'`. A single `CY/HEALTH` row is added to `CONFIGS` with tax profile `CY_HEALTH_BRIT_BAA_2026`. CY medical is assumed IPT-exempt until Peter confirms a rate; the resolver returns €0 IPT against this profile and the calculator emits no tax line.
3. **Binder overlay, not new BAA.** The product rides the **existing BRIT travel binder family**. The seed adds a `BinderProductAuthority(productCode='HEALTH', classOfBusiness='A&H', riskCode='A2', territorialScope=['CY'])` row per BRIT binder, plus a `programBinderLink(healthProgram → travelBinder)` link. Same `binderId`, different `productCode` — uses the existing composite unique key. A separate `healthProgram` row exists so the BO Programs page lists HEALTH and the MBE templates API can resolve it.
4. **`customerCountryOfResidence` override stays TRAVEL-only.** ADR-0024's `assertCustomerOverrideOnlyForTravel` continues to throw for HEALTH. The CY-only product never needs the override; risk location is always CY for Phase 1.
5. **Objective-expat eligibility (reuse of ADR-0025 shape).** The wizard collects the same seven objective answers as Travel (`nationality`, `hasOtherNationality` / `otherNationality`, `residenceDuration`, `willRemainResident`, `residencyStatus`, `legallyPermittedToReside`, `informationAccurate`) plus the Lloyd's residency declaration. `isExpat` is server-derived by `healthUwAutomation.evaluateHealthUw`. Decline messages are byte-identical to Travel's canonical strings (one source of truth).
6. **Rate model.** Premium and excess are age-banded per insured only (no tier picker, no addons). Externalised in `backend/products/health/pricing/data/brit-health-2026.json` per [ADR-0018](./ADR-0018-travel-pricing-data-externalization.md). For multi-insured policies premium is the sum of each insured's age-band rate. Net premium = gross × 0.70 (30 % commission). No neighbour-band fallback — missing band → REFER, not silent default.
7. **GHS extension is a conditional cover block, not a paid addon.** Standard Section A outpatient cover (medicine & surgical operations) is included in `HEALTH-BASE-COVER` for every Immigration policy. The MBE endorsement `HEALTH-GHS-EXTENSION` adds doctor visits + medications when `ghs.isBeneficiary === true` via `option_defaults.selectedWhen`. The wizard, BO Coverage tab, and PDF schedule all read MBE-resolved endorsements — one source of truth.
8. **Premium display follows ADR-0031.** `breakdown.lines` is the canonical ordered display array. Wizard Step 4 sidebar, BO Premium tab, and the PDF schedule all read the same array.
9. **Document pack.** Schedule + Certificate + Statement of Fact are dynamic HTML→PDF via the shared `genericDocPackGenerator`. IPID (`BritImmigrationHealthIPID.pdf`) and Policy Wording Section A (`Abbeygate_Immigration_Health_Wording.pdf`) are shipped as static PDFs in `backend/products/health/documents/static/`. All five docs flow through the canonical `enqueueIssuedPolicyPack` / `DOC.GENERATE_ISSUED_POLICY_PACK` spine ([ADR-0013](./ADR-0013-canonical-issuance-spine-outbox.md)).
10. **Worker handler.** A thin `DOC.GENERATE_HEALTH_DOC_PACK` handler dispatches to `adapter.generateDocPack` — BO-triggered regenerations only; the customer issuance path uses the canonical issued-pack worker.
11. **Customer journey order.** Customer contact details (`your-details`) are the public entry step, followed by eligibility, insured persons, period and GESY, quote, declarations and payment. This captures a reachable email and phone before the customer reaches later underwriting/rating stages; `productCatalog` owns the public-entry route and `HealthQuoteWizard` consumes the same step identifier.

## Consequences

- **Customer journey:** HEALTH is now a first-class product. `/quote/start` lists it as a tile (the picker iterates `productCatalog` — appending the new entry is the only code change). `/quote/health/new` auto-generates a session and routes to `HealthQuoteWizard`. The wizard composes only existing shared primitives — no new design or input components.
- **BO surface:** PolicyModals "New Submission" product dropdown auto-includes HEALTH (same iteration over `productCatalog`). The downstream binder picker filters by `BinderProductAuthority.productCode = 'HEALTH'` and surfaces the 3 BRIT binders seeded against HEALTH. The BO Underwriting tab renders `healthManifest.questionnaire.sections` automatically — single source of truth with the wizard.
- **Conformance matrix:** the engine conformance test now skips combos where the jurisdiction config row is absent (rather than asserting failure). HEALTH × CY is asserted; HEALTH × {PT, GR, ES} are skipped until those CONFIGS rows are added. This lets the matrix self-maintain as the product expands.
- **Generated artifacts:** the contract generator emits `health/generated/{healthValidationContract,healthProductMaps}.generated.ts` alongside the other products. Source hashes flip whenever `health/profile.ts` / `endorsementTemplates.ts` / claims contract change — `contract:generate:check` fails on drift.

## Forbidden (still)

- Adding a HEALTH `customerCountryOfResidence` override path (ADR-0024 remains TRAVEL-only).
- Inline rate tables in TypeScript (rates live in `data/brit-health-2026.json` only).
- Zod in wizard step schemas (`healthValidationProfile` uses `@facio/validation` declarative refinements like Home/Travel).
- A second HEALTH binder family — the product rides BRIT travel binders. New BAAs require Peter and a follow-up ADR.

## Open follow-ups (tracked here so they don't get lost)

1. **Max age cap / referral threshold.** Phase 1 assumes 80+ refer / 85 cap (parity with Travel). Confirm with Peter.
2. **CY health IPT rate.** Currently modelled as €0 (exempt) in `CY_HEALTH_BRIT_BAA_2026`. If Peter confirms a positive rate, set it in the profile resolver — never inline.
3. **Admin fee.** €0 in Phase 1. If banded, add `data/health-fee-bands.json` mirroring Travel's pattern.
4. **BDX import / export.** No HEALTH BDX mapper authored in Phase 1. `bdxImport/service.ts:inferProductCode` keeps its current 3-product allowlist; HEALTH BDX support is a Phase 2 follow-up.
5. **Section B exclusion.** Phase 1 is Section A only (Inbound Individual Medical). The static wording PDF is the Section A variant. Adding Section B (Group Health) requires a separate `executionMode` block — never a silent expansion.
6. **Other Lloyd's-CY tenants (PT/ES/GR).** When HEALTH is authorised under those BAAs, add `PT/HEALTH`, `ES/HEALTH`, `GR/HEALTH` rows to `CONFIGS` (and `JURISDICTION_HEALTH_DOCUMENT_PRESETS`). The conformance matrix will auto-include them.
