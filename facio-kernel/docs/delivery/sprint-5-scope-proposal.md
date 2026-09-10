# Sprint 5 proposal: customer transaction paths and rehearsal readiness

Prepared 7 September 2026, Asia/Jerusalem. **Proposal for scope review; not an accepted delivery commitment or implementation receipt.** No dates, customer acceptance criteria or existing backlog states are changed by this document.

“This sprint” is interpreted as the upcoming sprint after the delivered independent-review/provider increment. That delivered increment is described separately below. The proposed implementation/rehearsal window is **September 7–9**, followed by the already-required September 10 demos/integrated VUW run and September 11 full-POC acceptance.

## 1. Outcome and boundaries

An authorized intern can configure a customer sandbox on the existing shared Kernel, retain a source-linked submission, obtain and compare valid quote versions, complete the required independent review and provider gates, bind the selected version, retrieve its document pack, make a supported service transaction, and reconcile its financial/reporting effects. Another authorized person can reproduce the result from the same retained versions and evidence.

The work must support separate Bonzah, UE and VUW packages through shared typed capabilities. A configuration screen, prepared document or simulated response does not establish an executable customer journey. Actual customer/provider acceptance remains a distinct result.

The current scalar-question, single-risk/per-occurrence evaluator and premium-only servicing path cannot express every required customer case. Required risk/coverage/service extensions are first-class sprint work. They must not be approximated by flattening drivers or locations, treating an excess attachment as a deductible, treating an aggregate as a per-occurrence limit, or supplying a manually invented customer premium.

### Proposed deliverables and acceptance

| Work package | September 7–9 scope | Evidence needed to call the package done | Dependencies / remaining boundary |
| --- | --- | --- | --- |
| **S5-01 Customer contracts and configuration** — K03/K15 | Map every Bonzah P0, UE module and VUW obligation to a command, typed capability, configuration version and expected result. Add the required repeated drivers/locations, stable risk identifiers, source references and relevant conditional requiredness. Represent the required coverage basis, territory, dependencies and authority explicitly. Prepare separate versioned customer packages. | Configure materially different products on one build without customer-name branches. Test repeat-row identity, missing/conflicting input, coverage dependencies, applicable dates and unsupported semantics. Retained versions reproduce their original decisions. | Freeze approved rule/rate/coverage versions and field meanings first. Generic support does not establish licensed authority or complete all long-term questionnaire/jurisdiction features. |
| **S5-02 Authoritative integration and quote selection** — K03/K04 | Map agreed provider/customer submission and quote payloads to canonical versions; retain original evidence; expose quote comparison/revision and exact selection in Studio. Deliver authenticated status/callback behavior and approved payment/screening test boundaries. | Valid/invalid/duplicate submissions; quote/referral/decline; stale or unselected quote rejection; timeout, ambiguity and replay/order cases. Only a registered authorized decision adapter may supply the supported decision. | Current synthetic quote evidence is not a pricing/payment/screening engine. Each required integration needs its actual contract, access and accepted test boundary; one connected adapter does not close all K04/customer requirements. |
| **S5-03 Issue and retain document packs** — K05 | Versioned policy/coverage certificates, service reissues and the required VUW statement/RI outputs according to the resolved template decision. Pin legal parties, numbering, cover terms, dates, template and transaction versions. Provide authorized retrieval and durable generation status. | Field-by-field expected output and visual inspection; original documents unchanged after service; another tenant denied; failed generation retry creates neither duplicate binding nor a false “issued” state. | Approved templates, numbering and legal-role rules are required. Source attachment is not document generation. General signing, communications delivery and every document variant remain broader platform work. |
| **S5-04 Service transactions and intake** — K03/K08 | Bonzah four-to-six-day extension with rerating, delta and affected certificates. UE reviewable location/source discrepancies, location/value endorsement, separate cancellation/refund and renewal branches, and FNOL intake/handoff. VUW both MTA and endorsement, preserving original allocation and financial history. | Old/new risk and term versions reconstructable; stale review cannot authorize a changed transaction; approved delta/return examples reconcile; duplicate service does not repeat effects. Renewal is a distinct linked term. FNOL retains policy version, preparer, evidence, acknowledgement and duplicate handling; secure links expire. | Customer service, return-premium, commission and authority rules must be explicit. FNOL does not include claim adjudication/settlement. General process automation and all product/jurisdiction servicing algorithms are outside this increment. |
| **S5-05 Finance transaction foundation** — K06 | Balanced versioned journal entries, receivables/invoice projection, partial/unmatched receipts and separate commission lifecycle. Link postings to new business and service transactions. Preserve VUW external premium custody and separate commission receivable. UE demonstration slice by September 9. | Debits equal credits per transaction/currency; outstanding equals charges less applied receipts/credits; earned, receivable/payable, paid and reversed commission are distinct. Duplicate inputs do not repost. Manual exceptions retain actor/reason and original evidence. | Approved bases, tax/fee ownership, due events and reversals are prerequisites. Full VUW settlement/reconciliation remains due September 10. Live banking, collection, refunds and a general accounting suite are not delivered by a synthetic journal. |
| **S5-06 Reconciled reporting** — K07 | Scoped policy/premium/commission/receivable views with drilldown, clear as-of/transaction/effective dates and currency, and matching exports. Prepare customer-specific mappings and the BDX 5.2 contract. Bonzah/UE demonstration outputs by September 9. | UI/export/control totals agree and drill to immutable source transactions, including service corrections and capacity splits. Bonzah two-schema aggregate proof uses its separately approved evidence and exposes no PII. | Full approved VUW BDX 5.2 output and reconciliation remain due September 10. Synthetic row counts do not prove Bonzah’s stated source counts. Generic exports do not count as accepted Lloyd’s reporting. |
| **S5-07 M3 and independent intern handover** — K12/K18 | Reconcile the capability inventory with verified contracts/runtime, including stale provider-support labels, and complete the actual configuration/UI/API/MCP evidence pack by September 8. Observe two authorized interns using separate differently configured tenants, actual Google/ChatGPT flows, and a real second administrator’s underwriting decision. | Same revisions and hashes across supported surfaces; denied cross-access; permission revocation observed; supported writes work and unsupported commands are clear. Record actual people’s results separately from local fixture actors. | The six configured users are not six verified users. Actual participant availability and a named support/acceptance owner are required. M3 is configuration visibility, not full insurance-platform completion. |
| **S5-08 Repeatable rehearsal and delivery** — K09/K10/K13 | Provide an authorized repeat-run mechanism for synthetic cases, preserving configuration and historical evidence. Prefer a fresh controlled rehearsal workspace/run; any reset must have an approved exact boundary. Retain identifier-consistent fallback artifacts. Pin the candidate build/configuration/documents and rehearse September 9. | Bonzah repeat/reset meets its under-five-minute requirement within the accepted boundary. Record all 14 P0 outcomes and all 15 UE module outcomes, actual versus prepared/design/unresolved status, defects and owners. Verify deployed assets, representative data and recovery for new storage. | A new namespace is not silently declared equivalent to an approved reset. No production/customer data deletion is included. Prepared fallback material does not replace mandatory executable acceptance. |

### Insurance configuration quality requirements

- **Risk and questions:** stable typed identifiers; explicit units and cardinality; repeated item identity; only implemented conditional visibility/requiredness; missing values and conflicting source facts remain distinguishable; reviewed values retain provenance and the decision that resolved the conflict.
- **Coverage:** distinguish inclusion, dependency, exclusion, limit, deductible, aggregate, per-person or excess basis where required by the mapped product; use explicit currency and effective period. Support only semantics that the evaluator or registered authority actually executes.
- **Decisions:** validation, eligibility, referral, pricing, underwriting authority, human review, screening/payment and bind/issue readiness remain separate. A positive result in one cannot clear another implicitly.
- **Versioning:** retain original risk, selected quote, rate/authority version, approval, release, service transaction, document and posting references. Subsequent configuration changes do not reinterpret historical transactions.
- **Operator experience:** explain the business reason and the corrective action before exposing technical hashes. Preserve entered work across stale/network errors, use keyboard-accessible controls, show dates/currencies clearly and verify mobile layouts.
- **Conformance:** each customer package needs expected positive, referral, decline and failure cases. Approved customer examples and visibly synthetic continuation have separate evidence records. No “configured” option may save successfully while having no executable effect.

## 2. Existing capabilities and the increment we expect

The current application build is `b5f38d4fa1850f28458babe70b6e0714481a2f3d`; the documentation reconciliation is merged separately at `300381a299fc4e814c1f7087d3a567eedd9cb615`. Public health was refreshed during this scope review and matched the registry. Existing workflow/recovery receipts retain their September 6 observation dates; this review did not rerun customer acceptance or mutate hosted business records.

| Capability | Developed and evidenced now | Expected addition if this sprint passes |
| --- | --- | --- |
| Shared platform and tenants | HTTPS Platform/Studio, scoped memberships/provisioning, persistent sandbox, immutable activation, verified Google administrator workflow and bounded backup recovery | Independent intern/ChatGPT handover and repeatable customer rehearsal |
| Configuration and discovery | All 13 categories inventoried; five typed definition sections; shared UI/API/MCP ownership, revision/diff/gap inspection | Customer-required risk/coverage semantics, actual M3 review and same-version cross-surface handover |
| Product decisions | Scalar typed input, single-risk/per-occurrence cover terms, bounded deterministic rating, separate eligibility/referral/authority/bind findings | Required customer risk structures and rule/provider contracts, with customer golden cases |
| Quotes and review | Versioned manual/configured quotes; exact selected bind; immutable history; independent approval/decline/revoke/expiry controls | Configured-quote revision/comparison UI, actual second-person hosted review and integration-backed quote history |
| Provider execution | Durable queue/claims/receipts/audit, raw-byte authentication support, replay/order guards; hosted synthetic quote-evidence adapter | Actual authorized customer mappings, callbacks and accepted decision/payment/screening test paths |
| Policy servicing and claims intake | Explicit manual premium adjustments with lifecycle history; no risk/term change engine or full FNOL/renewal workflow | Required dated risk/term changes, separate renewal term, source-linked FNOL and coherent service branches |
| Documents | Source references and requirements attachments; no generated policy/service document capability | Versioned generated outputs from exact transactions, controlled retrieval and retry |
| Finance/reporting | Exact allocations and separately calculated commission; no balanced ledger, receivable settlement or reporting engine | Balanced demonstration postings, receivable/commission states, reconciled views and exports |

The delivered review/provider increment passed **123 automated tests and seven browser suites**, and has live synthetic workflow plus two final-image copied-snapshot recovery receipts. Those results prove the recorded bounded implementation. A real second reviewer, independent interns, customer insurer/payment/screening connections, customer golden journeys and production readiness remain unaccepted.

## 3. Platform completeness: proposed measurement

There is no approved effort-sized completeness baseline today. The following is a **proposed capability-weighted planning estimate**, not an audited percentage, elapsed-time estimate, customer acceptance result or production-readiness rating.

**Denominator:** the long-term Kernel/platform scope in the supplied requirements and deployment plan, including Studio, shared insurance domains, commercial onboarding, operational hardening and customer adoption. It does not count development of the separate ACTUIT product or every future Facio product; that portfolio is not scoped sufficiently for a defensible completion percentage.

Weights represent relative breadth/complexity and are proposed for review. Party/distribution, programmes/binders and authority belong within the product/runtime areas; claims, FNOL, renewal and process execution belong within lifecycle. These major requirements are not omitted from the denominator. Scores are engineering coverage of each full area, with partial credit for executable bounded slices. Approximate anchors: 0 = absent, 25 = limited executable slice, 50 = substantial implemented subset, 75 = broad integrated coverage with material gaps, 100 = complete defined scope and required evidence. Interpolation is judgmental. Sandbox evidence cannot confer production acceptance. Every scored area must eventually be decomposed into owned, estimated acceptance items; thereafter changes to scope/weights should be explicit.

| Full-platform area | Weight | Current estimated area score | Target area score after this bounded sprint | Major scope still remaining afterward |
| --- | ---: | ---: | ---: | --- |
| Shared runtime, tenancy, identity and sandbox operations | 15% | 65% | 70% | Full independent identity/operational evidence, broader tenant/role and residency controls |
| Configuration, Studio, compiler, API/MCP | 15% | 50% | 60% | Full 13-aggregate authoring, broad simulation, reusable libraries and governed production publication |
| Product, risk, rating, underwriting and authority | 20% | 30% | 40% | Broader algorithms, jurisdictions, programmes/binders, products and customer conformance |
| Policy lifecycle, FNOL and process execution | 10% | 10% | 30% | General process execution, broader service/renewal rules, full claims lifecycle and task automation |
| Documents, evidence and communications | 10% | 0% | 25% | Signing, delivery/consent, channels, clause/wording breadth and all document variants |
| Finance, reconciliation and reporting | 15% | 10% | 30% | Broader tax/fee/instalment/refund/FX rules, provider/accounting integrations and accepted reporting breadth |
| Commercial onboarding, subscriptions and product access | 5% | 0% | 0% | Purchase/subscription/billing/entitlement lifecycle; M4 is a specification deliverable |
| Production hardening, regional topology and customer migration | 10% | 5% | 5% | Production storage/topology, signed release governance, SLO/load/DR evidence, legacy parity/cutovers |
| **Weighted planning total** | **100%** | **26.25%** | **38.0%** | **The whole long-term scope remains the denominator** |

Formula: `sum(area weight × area score) / 100`. For communication use **approximately 25–30% now and 35–40% after this sprint**, with roughly **±5–10 percentage points of estimation uncertainty** until the backlog is decomposed and sized. The decimals are arithmetic outputs, not precision in the underlying judgments. The target is conditional on the scoped increment actually passing; partial delivery must score lower.

M3 may reach **100% of its own accepted configuration-visibility scope** while the entire platform is only around 35–40% complete. Customer journey acceptance and production launch remain explicit gates; neither follows from this weighted engineering score. Do not use the 13 visible categories, two closed issues out of 18, test counts, or generated-code line counts as a completion denominator. No generic percentage overrides a failed mandatory customer case.

## 4. Execution sequence and deadline implications

| Date | Target and evidence gate |
| --- | --- |
| September 7 | Freeze customer input/contract decisions, source/example boundaries and accepted delivery/review ownership. Begin parallel product/integration, document/lifecycle and finance/reporting work. Bonzah’s source T−72 freeze is 17:30 Jerusalem assuming US Central; actual invitation verification remains separate. |
| September 8 | Complete M3 configuration/UI/API/MCP acceptance and integrate the first complete customer transaction paths. Record real intern/reviewer evidence when participants are available. |
| September 9 | Freeze and rehearse the Bonzah/UE candidate, complete their demonstration finance/reporting slices and retain defects/fallbacks/repeat-run evidence. This is the sprint exit checkpoint. |
| September 10 | Bonzah/UE demos; full VUW integrated run, complete settlement/BDX checks and repair mandatory defects. |
| September 11 | Full VUW acceptance target remains unchanged: all 22 workbook UAT scenarios, eight separate SOW criteria and 23 input decisions retained, with their source classification and actual evidence. The agreed POC-conclusion deletion remains a controlled closure obligation at its agreed time, not an automatic destructive action on September 11. |
| September 12 | M4 engineering-ready onboarding specification acceptance; full commercial onboarding implementation is separate. |

These are the minimum dependency targets serving the existing dates, **not a credible unconditional three-day commitment with unconfirmed capacity and inputs**. Parallel accountable delivery lanes and same-day September 7 customer decisions are necessary. A miss does not authorize narrowing mandatory scope, counting prepared screens as runtime completion or moving the full VUW deadline. Record the forecast and impact explicitly.

### Required inputs and decision ownership

The source packs have already been received. The unresolved work is selecting authoritative facts and accepted test boundaries:

- **Bonzah:** approved state/vehicle/rate tables and coverage benefits, including conflicting PAI/PEI values; certificate/wording/numbering rules; actual integration payloads/errors/webhooks; accepted simulated payment/partner-receivable flow; controlled aggregate-import evidence; actual demo owners.
- **UE:** property/rating/authority contracts and approved reference premiums; location crosswalk and discrepancy resolution; enrichment contracts; document packs; commission/billing/return-premium/renewal examples; FNOL destination/acknowledgement; named underwriting/finance/acceptance owners. Keep an unresolved real submission in review; use a separately labelled synthetic continuation when authorized.
- **VUW:** exact API/schema/risk-code/CDR and callback contract; expected quote/referral/decline cases, panel/authority/screening order; external-custody and commission/return/settlement rules; BDX 5.2 and broker-statement/RI templates; MTA versus endorsement definitions; sample/reset/closure and scope precedence. Preserve two Lloyd’s syndicates plus the Caribbean reinsurer and the cargo-auditor demonstration; later production rollout is separate.
- **Facio operations:** an accepted owner for each delivery lane, an independent reviewer, intern availability and a support/recovery owner. Existing email allowlists and source-named contacts do not establish acceptance or availability.

## User-authorized addition: Rust core backend

Uriel explicitly required Rust core-backend implementation while authorizing Sprint 5 execution. Exact premium allocation and commission calculation now form the first implementation boundary: a dependency-free Rust module loaded in-process through WebAssembly. The existing exact-money contract, rounding and financial hashes remain stable; the retained TypeScript implementation is a conformance oracle. Build/startup must validate the artifact, ABI and compiler evidence. Parity, full-call overhead and measured CPU are separate from actual hosting-cost savings. See [the Rust implementation and evidence](../../rust/README.md). Further core migrations require their own measured business boundary; this does not authorize copying a customer data model or claiming a wholesale backend rewrite.

## 5. Explicitly outside this sprint

Production customer migration or destructive resets; wholesale Abbeygate rewrites (the explicitly authorized Rust calculation boundary above is included); general multi-region/HA rollout; signed production Tenant Releases; subscription purchase/billing implementation; ACTUIT product implementation; a general no-code workflow or BI suite; live money collection/settlement/refunds; full claims adjudication; and full cargo/Caribbean production deployment.

Exclusion from this sprint does not remove a source obligation from its actual milestone. In particular, full VUW still includes its required mixed-capacity, cargo-auditor, documents, settlement/reconciliation and reporting demonstrations by September 11. M4 proceeds as the separately scoped specification lane.

## 6. Definition of done

1. Every delivered capability has a canonical contract/use case, server-derived authority, enforced tenant scope, concurrency/idempotency controls and retained business evidence.
2. The relevant customer package and exact expected cases demonstrate the behavior, including negative/failure paths; approved and synthetic evidence are identified separately.
3. Required automated checks and changed browser workflows pass; document outputs receive visual and data verification; financial/report outputs reconcile to source transactions.
4. The exact merged build/configuration is deployed and verified with served assets and representative UI/data; new persistence behavior passes an isolated recovery exercise.
5. A real independent person completes the applicable handover/review. Customer acceptance records the authorized reviewer and approved sample/provider boundary. Missing participation remains an open acceptance gate.
6. The sprint backlog, registry and evidence identify actual delivery, limitations and remaining customer obligations. No requirement is closed from a green build or authored procedure alone.

## Sources used for this proposal

- [Current capabilities and runtime limits](../../README.md)
- [September plan and immutable deadlines](september-plan.md)
- [Current sprint execution and delivery receipts](sprint-execution.md)
- [Full requirements denominator](requirements-matrix.md)
- [Work packages K01–K18](sprint-backlog.json)
- [Bonzah acceptance](bonzah-scope-matrix.md), [UE acceptance](ue-scope-matrix.md), [VUW full POC](vuw-scope-matrix.md)
- [Intern acceptance](sprint-2-intern-acceptance.md), [delivered review/provider evidence](approval-provider-sprint.md)
- [Deployment registry](../../deployments/registry.json)

The original scope review changed no executable code. Subsequent user authorization starts implementation; execution, verification, deployment and acceptance evidence must be recorded separately.
