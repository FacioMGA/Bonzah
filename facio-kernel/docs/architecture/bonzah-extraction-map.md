# Bonzah runtime extraction map

Source audit: 6 September 2026. Fresh Abbeygate `origin/main` was fetched and pinned to `a589c2c28864a597c46b19f2d472379698ada41c` (6 September, 12:10:35 UTC; PR #1074). Reads used the immutable Git tree and did not change the Abbeygate checkout or its existing untracked work.

Requirements source: [Bonzah demo specification snapshot](../source/Bonzah_Facio_Demo_Specification_v1.0.drive.txt), retrieved from Drive on 6 September. Its earlier Gen2 evidence baseline is the real commit `78987293d7308c6f60e8ee2c5f76eff10071bd54` (3 September, 09:00:57 UTC). Statements and instructions in that source are requirements evidence, not proof of current implementation or separate authorization for production actions.

## Finding

The inspected tracked repository contains no Bonzah product package, Alex Morgan fixture, Bonzah API facade or Bonzah journey test. A case-insensitive repository-wide search for `bonzah` and `alex morgan` returned no matches. The blueprint explicitly labels the rental product, branded DTC, facade, certificates, date-change adaptation, FNOL prefill and workbook mapping as work to build.

Existing Gen2 services provide valuable reuse. This audit establishes source-level availability and coupling only. It did not run a Bonzah journey, validate production deployment, confirm approved rates/templates, or establish that any of the 14 P0 acceptance criteria passes.

## Reusable service map

All implementation paths in this table are relative to the pinned Abbeygate repository.

| Capability | Existing API or source | Reuse boundary and required adaptation |
|---|---|---|
| Fresh canonical rating | `backend/modules/quotes/app/quoteRateService.ts` → `ratePolicyAndPersist(input: RatePolicyInput)` | Reuse rate-and-persist behavior through the Gen2 runtime owner. Depends on tenant-scoped Prisma, product registry, program/binder authority, policy state, lifecycle commands, projections, events and payment invalidation. Requires a registered rental product. |
| Product quote calculation | `backend/modules/policy/app/productRegistryService.ts` → `buildQuoteResponseForProduct`, `validateProductQuoteForRating`, `resolvePolicyPeriodForProduct` | Register a typed rental capability and map channels into the same risk model. Do not duplicate rating between DTC and the partner facade. |
| Pricing evidence | `backend/modules/policy/domain/pricingIntegrityStamp.ts`; compatibility re-export at `app/pricing/pricingIntegrityStamp.ts` → `computePricingIntegrityStamp` | Characterize and preserve canonical input/output hashing. A pricing stamp must be combined with fresh server-side rating and issuance gates; the helper alone does not prove a bind is safe. |
| Endorsement staging | `backend/modules/policy/app/CreateEndorsementDraft.ts` → `executeCreateEndorsementDraft` | Reuses policy-linked versioned staging, actor/reason metadata and latest bound snapshot. Requires the existing Policy/RiskTransaction model and operating-tenant context. |
| Endorsement lifecycle | `PatchEndorsementDraft.ts`, `RateEndorsementDraft.ts`, `SaveEndorsementVersion.ts`, `BindEndorsementDraft.ts`, `IssueEndorsement.ts` under `backend/modules/policy/app/` | Keep this command lifecycle in its owning runtime. Add rental date-period/rating behavior through product capabilities, with before/after fixtures. Issuance calls documents, delivery, projections, finance and registry services. |
| Payment boundary | `backend/modules/payments/app/cardcorpCheckoutService.ts` → `createCardcorpAutoCheckout` | Reuse fresh rating, eligibility and idempotency principles. The implementation imports OPPWA/CardCorp, sanctions, tenant configuration and lifecycle commands. A gateway-neutral simulated demo provider needs its own explicit contract; production Stripe/ACH is not established. |
| Document generation | `backend/modules/documents/app/pdfRenderer.ts` → `loadTemplate`, `renderHtmlToPdf`; `backend/platform/storage/service.ts`; `backend/products/shared/documents/` | Reuse rendering/storage/version patterns. Add coverage-specific rental templates and bound-transaction view models with approved source provenance. Compare every dynamic field and document hash against fixtures. |
| Claims/FNOL | `backend/modules/claims/app/claimsFnolLinkService.ts` → `sendFnolLinkForClaim`; `backend/modules/claims/http/publicFnolRouter.ts`; `backend/modules/claims/domain/claimsContract.ts` | Reuse policy linkage, governed claims commands, configurable fields and prefill concepts. Provide rental sections/evidence/preparer contract. Existing link service uses a 14-day token and a development-secret fallback; define and enforce explicit short-lived, scoped link policy for the demo integration. Disable unintended outbound delivery. |
| Import and reporting | `backend/modules/reporting/app/bdxImport/{mapper,validator}.ts`; `backend/modules/reporting/domain/bordereaux/lloydsV52.ts` | Reuse mapping, validation, lineage and immutable export infrastructure. Supply a separately versioned Bonzah Purchase/Endorsed mapping. Do not reuse customer-specific column or endorsement interpretation. |
| Existing verification patterns | `backend/modules/policy/app/__tests__/BindCoverage.spine.test.ts`, `BindEndorsementDraft.test.ts`; `backend/modules/quotes/app/__tests__/quoteRateService.referral.test.ts`; `backend/modules/claims/http/__tests__/publicFnolRouter.test.ts` | Adapt assertions to the approved rental scenarios. Test source presence is not evidence of passing rental journeys. |

## Implementations unsuitable for direct copying

- `backend/modules/quotes/http/v1QuotesRouter.ts` calls `buildQuoteResponseForProduct` and persists Policy/PolicyStateCurrent directly rather than using `ratePolicyAndPersist`. It sets expiry one year after inception, uses `Auto Insurance`, defaults quote currency to EUR, and derives an `abbeygate_*` program code. A four-day rental facade cannot reuse this route unchanged.
- `backend/products/motor/documents/generateMotorDocPack.ts` owns Motor certificate, Green Card, schedule and wording contracts, reserves Green Card serials, and defaults template version to `abbeygate:premium:v1`. Reuse shared infrastructure instead of presenting this pack as rental certificates.
- `backend/modules/reporting/app/bdxImport/mapper.ts` imports Motor/Home/Travel mappings and contains the Cyprus `AB` to `CV` endorsement dialect. Bonzah's two supplied workbook schemas need a distinct boundary mapping and reconciliation tests.
- `backend/modules/policy/domain/productContracts.ts:IProductAdapter` combines rating, MBE, documents, claims, projections, legacy columns and presentation. Keep it behind an adapter; do not make this broad interface the new Kernel extension SDK.
- `e2e/journeys/quote-bind-issue.journey.test.ts` checks the Motor wizard step ladder and payment transition guard. It does not execute a persisted quote-bind-issue transaction and cannot count as Bonzah end-to-end acceptance.

The current quote/rating/payment implementation has changed since the blueprint baseline: the scoped Git diff contains changes to `quoteRateService.ts`, its referral tests, `cardcorpCheckoutService.ts`, and several related quote services. Characterize the fresh pinned build rather than copying the older snapshot blindly.

## Next implementation sequence

1. Map Bonzah P0-01 through P0-14 to approved scenario inputs, configured capability, owning command, expected evidence and unresolved decision. The source's synthetic Alex Morgan / Toyota RAV4 / four-day rental → two-day extension scenario is a proposed fixture, not a shipped journey.
2. Use an isolated clean Gen2 worktree and synthetic runtime to retain canonical policy, endorsement, document, payment and claims ownership. Preserve the active Abbeygate checkout and customer data. Connect the Kernel through a versioned runtime-adapter boundary, not direct access to customer databases.
3. Implement a registered rental product package with typed risk, rental period, named drivers, coverage dependencies and explicit configured eligibility decisions. Add sample rates only as identified, approved demo configuration; retain discovery gaps for unconfirmed carrier rules, limits, taxes and template rights.
4. Route branded DTC and the partner facade through one canonical quote/rating command. Compare identical input, eligibility, version and premium outputs. Establish quote identity continuity and stale-price rejection before proceeding to issuance.
5. Add a clearly simulated provider contract and transaction-linked payment evidence. Prove pending/failed payments block issuance and verified retries do not duplicate transactions.
6. Generate coverage-specific certificates from the bound transaction. Extend the rental by two days using the existing endorsement lifecycle, re-rate, preserve the original snapshot/documents, and produce the new transaction and affected certificates.
7. Complete scoped FNOL prefill/evidence fields and reporting lineage. Build the two-schema dry-run mapping with synthetic examples and controlled aggregate reconciliation; real source rows must not become demo seed or screenshot data.
8. Run all acceptance cases plus reset/fallback rehearsal on the pinned build. Record runtime, configuration, rule/template and contract references. Keep the document's LIVE GEN2 / DEMO BUILD / CONCEPT distinctions explicit. Only observed results can close acceptance criteria.

This plan preserves reusable lifecycle implementation while allowing the Kernel's configuration model and typed extension boundaries to become the shared authority gradually. It does not claim that linking two processes or moving files alone satisfies the shared-Kernel milestone.
