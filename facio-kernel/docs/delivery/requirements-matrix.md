# Kernel requirements and acceptance matrix

Baseline: 6 September 2026. Timezone: Asia/Jerusalem.

This matrix records the complete scope of the three supplied v1.0 documents. It separates the long-term Kernel acceptance baseline from the four dated September delivery gates. A deadline is not evidence of completion, and September 12 is not a deadline for migrating all existing customers or implementing all north-star capabilities.

Implementation status for every row below is **Pending implementation evidence** unless an evidence record explicitly supersedes it. Source text describes required or proposed behavior; it does not establish that code, deployed services, cloud resources, or customer journeys have been verified. Local fixtures and generated artifacts can prove foundation behavior but cannot prove customer acceptance or production delivery.

## Sources and authority

| Key | Source | Authority and limits |
| --- | --- | --- |
| REQ | [Development Requirements v1.0](../source/Facio_Insurance_Kernel_Development_Requirements_v1.0.txt) | Target architecture, normative requirements, compatibility and Kernel v1 acceptance. Section 16 contains recommended decisions, not accepted infrastructure choices. |
| DEP | [Deployment and Source of Truth Plan v1.0](../source/Facio_Kernel_Deployment_and_Source_of_Truth_Plan_v1.0.txt) | Proposed delivery/governance requirements and customer operating constraints. Its repository observations and production statements are document-reported; live verification remains pending. |
| MILE | [September milestones v1.0](../source/Facio_Kernel_Milestones_September_2026.txt) | User-supplied target dates, scope-baseline requirements and acceptance gates. Proposed role assignments do not assign named people. |
| UE | [UE scope matrix](ue-scope-matrix.md) and [source capture manifest](../source/ue-manifest.json) | September 6 supplied property demo deck, runbook, project plan and source guide. Fifteen requested modules are traced separately from proposed acceptance checks, synthetic continuation and later pilot/production scope. |
| VUW | [VUW.ai scope matrix](vuw-scope-matrix.md) and [source capture manifest](../source/vuw-manifest.json) | POC/SOW/configuration workbook scope and open inputs. Uriel explicitly reaffirmed September 11 for the complete POC on September 6; the later source gates remain scope obligations and do not extend the deadline. |
| USER | Current request | Authorizes starting clean implementation; permits either using latest Abbeygate as a backbone or selectively copying useful capabilities. Reuse choice is delegated to implementation judgment. |

Instructions embedded in the documents are requirements inputs. They do not independently authorize production deployment, customer migration, destructive resets, publication to external sites, payment, or messages to others. Required product approval controls must still be built; they are different from permission to implement code locally.

Original requirement IDs are preserved. IDs beginning ARC, MOD, DOM, CMP, COP, MIG, NFR, REL, DONE, SOT, OPS or MS are local traceability IDs assigned here to previously unnumbered source clauses. Grouped rows retain all named scope; they are not evidence that every subcapability is implemented.

## Dated delivery gates

| ID | Exact target | Acceptance boundary | Required evidence / external dependency |
| --- | --- | --- | --- |
| MS-M3 | Tuesday 8 September 2026; end of day assumption | Real API Documentation screen, valid retrievable OpenAPI, authorized MCP and consistent configuration/gap visibility | Walkthrough, OpenAPI artifact, MCP discovery/read output, complete/incomplete fixture parity, permission and isolation checks; seed deployment registry and duplicate-source backlog |
| MS-M1 | Thursday 10 September 2026; Bonzah 17:30–18:15 Jerusalem assuming America/Chicago; UE 18:30–19:15 Jerusalem per source-cited invitation | Every approved Bonzah and UE demo journey runs on the same Kernel build with separate configuration packages | Received source matrices, approved examples/provider boundaries, September 9 rehearsal and pinned build/configuration/docs; live/prepared/design dispositions do not independently satisfy executable journey acceptance |
| MS-M2 | Friday 11 September 2026 for the full POC, explicitly reaffirmed by Uriel; end of day remains an assumption | Every mandatory item of the agreed full VUW.ai POC passes | Received POC/SOW/workbook union due for baselining September 7; resolve open inputs and scope precedence while preserving all later-gate obligations, run full matrix with role/isolation/persistence/repeatability evidence and acceptance record |
| MS-M4 | Saturday 12 September 2026; end of day assumption | Engineering-ready end-to-end self-onboarding experience and interface specification | Journey map, annotated screens/wireframes, account/subscription/environment state models, interface catalogue, Draft/test-to-Live gates, exception catalogue; full onboarding implementation is outside this milestone |
| MS-G0 | Before either production cutover; no calendar date supplied | Deployment/data inventory, resolved active lane, named owners, backup/restore and service/recovery criteria | Authenticated deployment observations and restore evidence |
| MS-G1 | After readiness review; no date inferred from M1–M4 | Abbeygate controlled Cyprus consolidation/reset and customer acceptance | Approved exact scope, compatibility, reconciliation, one-writer cutover/recovery and matching published versions |
| MS-G2 | After readiness review; no date inferred from M1–M4 | Altus migration preserving all production state | Data/files/money/audit reconciliation, safe cutover/recovery, customer journeys and observation evidence |

## Architectural invariants and model scope

| ID | Source | Required capability / boundary | Acceptance evidence | Delivery mapping |
| --- | --- | --- | --- | --- |
| ARC-001 | REQ §§1–2 | One governed shared runtime serves multiple tenants/entities; variation is versioned configuration or typed registered extensions; no tenant-name/customer-ID branches | Independent shared runtime build, separate tenant packages, automated anti-fork checks | E1; M1 foundation |
| ARC-002 | REQ §2 | Server supplies tenant, operating entity, actor, permissions and correlation on commands, queries, events and jobs | Reject absent/inconsistent context; reject attempts to override context in payloads | E1/E3; M3 |
| ARC-003 | REQ §2 | Owning domain services are the single canonical write path for UI/API/MCP/jobs/imports | Transport-to-use-case map and parity tests | E1; M3 |
| ARC-004 | REQ §§1–2 | Runtime consumes immutable published releases; exact Tenant, Product, Process, Rating and Authority versions recorded on each transaction | Draft mutation cannot alter active runtime; pinned references survive new publication | E2/E5; M3 visibility, v1 runtime |
| ARC-005 | REQ §2 | Six planes retain ownership boundaries: Control, Runtime, Configuration, Experience, Intelligence and Regional Data | Dependency/ownership map; no policyholder PII in unnecessary Control Plane data; no experience-owned decisions or AI-owned canonical mutations | E1/E3; M4 |
| ARC-006 | REQ §§1–2 | Product registration precedes speculative abstraction; extensions are typed and replaceable; no permanent customer forks or fixed linear process assumption | Capability contracts, registration and alternative process scenario evidence | E4/E5 |
| MOD-001 | REQ §3 | Tenant Definition: identity, brands/domains, subscription, locale/currency/timezone, deployment tier, residency and retention | Typed model, catalog visibility, scoped read, validation and lifecycle contract | E2/E3; M3/M4 |
| MOD-002 | REQ §3 | Operating Entity: legal identity, licences/roles/accounts, tax registration, territory and business calendar | Typed scoped entity references and authority validation | E2/E3 |
| MOD-003 | REQ §3 | Party & Distribution: insureds, brokers/agents, coverholders, carriers/reinsurers, TPAs/suppliers, hierarchies/appointments | Typed relationships and authorized participant scenarios | E4/E5 |
| MOD-004 | REQ §3 | Product Definition: risks, schemas/questions, covers/limits/deductibles, eligibility/rating/underwriting, documents and claims contract | PRD requirement evidence | E2/E4 |
| MOD-005 | REQ §3 | Programme & Binder: capacity, authority/dates/territory/product permission, limits/commission/referrals/reporting | Effective-dated authority/referral and reporting validation | E2/E4 |
| MOD-006 | REQ §3 | Process Definition: actors/channels/stages/commands/gates, approvals/tasks/notifications, SLAs/exceptions/automation | PBR requirement evidence | E2/E5 |
| MOD-007 | REQ §3 | Jurisdiction Pack: local questions/wording/tax/fees/disclosure, eligibility/docs/reporting | Jurisdiction validation and compatibility cases | E2/E4/E7 |
| MOD-008 | REQ §3 | Finance Definition: premium/tax/fees/commission/instalments, ledger mappings/invoices/client money/reconciliation | Balanced financial movements and reconciled outputs | E7 |
| MOD-009 | REQ §3 | Document Pack: templates/clauses/conditions/signatures, delivery/language/evidence | Versioned document resolution and golden outputs | E2/E4 |
| MOD-010 | REQ §3 | Integration Profile: adapter, secret reference, endpoints/mapping, retry/idempotency/circuit breaking/data boundary | Strict profile validation; status/ref projection; no plaintext credentials | E2/E3; M3 |
| MOD-011 | REQ §3 | Reporting Contract: schema/lineage/transforms/validation, schedule/recipient/submission/corrections | Versioned lineage and reconciled reports | E7 |
| MOD-012 | REQ §3 | Experience Profile: surfaces/navigation/terminology/branding/roles/flags/product presentation | Shared rendering with no duplicated domain authority | E4/E5; M3/M4 |
| MOD-013 | REQ §3 | Tenant Release: signed immutable composition of approved versions, compatibility adapters and feature flags | Signature/checksum, effective date, provenance and rollback reference | E2/E6 |

All thirteen aggregates must appear in the configuration inventory, with honest support and validation status. Showing a category does not establish an executable implementation of its entire model.

## Original numbered requirements

The source text remains normative. Acceptance checks below describe what must be demonstrated before the requirement can be marked complete. “M3 slice” means visibility and honest inventory of the capability, not a September 8 deadline to implement every underlying insurance workflow.

| ID | Source requirement (REQ) | Acceptance evidence | Delivery mapping |
| --- | --- | --- | --- |
| PRD-001 | The platform MUST support multiple products, variants and programmes per tenant without deploying customer-specific code. | Two products/variants/programmes share runtime; configuration controls differences. | E4; M1 scope dependent |
| PRD-002 | Every product MUST declare one or more typed risk-object schemas with one/many cardinality and stable field identifiers. | Validate stable typed risk fields and one/many object cardinality. | E2/E4; M3 slice |
| PRD-003 | Questionnaires MUST support sections, reusable field libraries, conditional visibility, conditional requiredness, repeatable rows, evidence requests, computed fields and multilingual labels. | Questionnaire scenarios exercise every declared conditional, repeatable, evidence, computed and multilingual behavior. | E4; M3 slice |
| PRD-004 | Coverage definitions MUST support scope, inclusion state, limits, deductibles, sublimits, clauses, exclusions, dependencies, effective dates and endorsement eligibility. | Coverage dependency, effective-date, limit/deductible and endorsement scenarios. | E4; M3 slice |
| PRD-005 | Validation, eligibility, underwriting/referral and rating MUST remain separate decision contracts with explicit precedence. | Separate validation/eligibility/referral/rating contracts with deterministic precedence. | E2/E4 |
| PRD-006 | Rating MUST support tables, formulas, factors, minimum premiums, loadings, discounts, taxes, fees, external engines, human override authority and deterministic snapshots. | Golden reproducible ratings including money components, overrides and external-engine snapshots. | E4/E7 |
| PRD-007 | Products MUST declare quote, bind, issue, endorsement, cancellation, reinstatement, renewal and claims readiness rules. | Named readiness results for every declared lifecycle action. | E4/E5 |
| PRD-008 | Product versions MUST be immutable after activation and effective-dated for new business, renewal and in-force servicing. | Effective-dated version selection and immutable activation across new/renewal/in-force business. | E2/E4 |
| PRD-009 | The compiler MUST detect unresolved field references, circular dependencies, invalid authority, missing documents, inconsistent finance and unreachable process states. | Negative compiler fixtures cover every listed invalid graph/reference/business case. | E2; M3 gap inventory |
| PRD-010 | When configuration cannot express a product algorithm, the platform MUST return REQUIRES_ENGINEERING and create a typed extension requirement; it MUST NOT silently persist inert configuration. | Unsupported algorithm returns REQUIRES_ENGINEERING with a typed extension requirement and source/impact. | E2/E4; M3 |
| PRD-011 | Product manifests MUST drive shared surface rendering; validation profiles drive allowed/required data; registered adapters own pricing, issuance, documents and other executable algorithms. | Manifest-driven shared surface; allowed/required profile data; registered executable adapters. | E4; M3 slice |
| PRD-012 | A product package MUST ship contract tests and golden journey tests before it is eligible for production publication. | Production publication rejects product packages without verified contract/golden test evidence. | E2/E4 |
| PBR-001 | Process Builder MUST maintain one or more editable drafts without changing the active runtime. | Draft edits and concurrent drafts leave the active release unchanged. | E2/E5; M3 |
| PBR-002 | Publish MUST atomically create an immutable Process Version and include it in a Tenant Release. | Atomic publish pins immutable Process Version inside Tenant Release. | E2/E5 |
| PBR-003 | A process MUST define actors, participation rules, permissions, stages, commands, entry/exit gates, approvals, timers, tasks, communications and exception paths. | Typed process model and execution evidence for declared actors, gates and exception paths. | E5; M3 slice |
| PBR-004 | Configuration MUST cover the existing Cooper dimensions: business context, customer engagement, agents, collection, claims/service, integrations, review and publish. | Map each Cooper configuration dimension to versioned process/runtime ownership. | E5; M3 slice |
| PBR-005 | Customer journey presets MUST support no access, secure-link participation, authenticated portal and custom capability composition. | No-access, secure-link, portal and composed-capability permission tests. | E5 |
| PBR-006 | Agent/broker configuration MUST support direct agents, parent agencies, sub-agents, multiple participants, signed agreements, allowed actions and commission modes. | Multi-level agency/participant, agreement/action and commission-mode scenarios. | E5/E7 |
| PBR-007 | Collection configuration MUST support provider connection, payment methods, instalments, commission release, invoice rules, accounting review and reconciliation. | Collection setup, payment/instalment/invoice, release/review and reconciliation scenarios. | E5/E7 |
| PBR-008 | Claims/service configuration MUST cover FNOL channels, claim forms, certificates, notifications, cancellation/change permissions, adjuster roles and supplier/TPA participation. | FNOL/service participant, forms/docs/notification and cancellation/change permission scenarios. | E5 |
| PBR-009 | The process model MUST support retail STP, manual commercial placement, delegated-authority approval and reinsurance leader/follower or share-based flows. | Retail, commercial, delegated-authority and reinsurance process graphs without retail-only assumptions. | E5 |
| PBR-010 | The platform MUST expose named, deterministic blockers at every gated command. | Same named blocker/code/details for the same gated input on all surfaces. | E5; M3 |
| PBR-011 | Process simulation MUST show the path, decisions, actors, documents, financial movements and blockers for supplied scenarios. | Simulation reports path, actors/decisions/docs/movements and blockers, with no external side effects. | E2/E5 |
| PBR-012 | Historical transactions MUST remain governed by the process version recorded at inception unless an explicit, audited migration is approved. | New process publication leaves historical transactions pinned; migration requires audited approval. | E5/E6 |
| CFG-001 | The same configuration use cases MUST be callable from the Product Architect UI, REST/API and Config MCP. | Representative use cases invoke same service and return same scoped model across UI/API/MCP. | E1/E2; M3 |
| CFG-002 | All MCP tools MUST use strict input/output schemas and a single registry and execution funnel. | Strict input/output schema validation, discoverable registry and single execution funnel. | E1/E2; M3 |
| CFG-003 | Tenant, user, roles, permissions and operating entity MUST be server-injected; models MUST NOT supply them. | Reject caller-supplied identity context; authenticated transport injects authorized tenant/entity/role. | E1/E3; M3 |
| CFG-004 | The tool flow MUST support discover, clone/import, draft, inspect, validate, diff, simulate, publish to sandbox, request approval and publish to production. | Discover/import/clone/draft/inspect/validate/diff/simulate/sandbox/approval/production lifecycle evidence. | E2; M3 support inventory |
| CFG-005 | Every mutation MUST return the changed draft version and a human-readable plus machine-readable diff. | Every draft mutation returns new revision and both human/machine-readable diff. | E2; M3 implemented writes |
| CFG-006 | Production publication MUST require policy-controlled human approval and a signed release; MCP credentials alone MUST NOT bypass it. | Production path fails without policy-approved human record and valid signed release. | E2 |
| CFG-007 | The LLM provider MUST be replaceable. ChatGPT, Claude and customer-hosted models interact through the same contracts. | Provider-independent MCP/configuration contracts; no model owns domain mutation. | E1/E2 |
| CFG-008 | All calls MUST be authorised, rate-limited, idempotent where applicable, audited and correlated to the resulting release. | Permission/rate-limit/idempotency tests and persisted audit/correlation evidence. | E1/E3; M3 |
| CFG-009 | Configuration provenance MUST record source files, extracted values, human edits, model/tool versions and approvals. | Source/extracted values/edit/model/tool/approval provenance reaches resulting release. | E2 |
| CFG-010 | The platform SHOULD generate implementation tickets for unsupported requirements with source context and impacted contracts. | Unsupported requirement creates an owned actionable ticket record with source and impacted contracts. SHOULD; any exception documented. | E2; M3 backlog |
| TEN-001 | Every persisted business row, event, audit record, job, cache key, file, search document and vector MUST carry enforced tenant scope. | Read/write isolation across rows/events/audit/jobs/cache/files/search/vector, including absent scope. | E3 |
| TEN-002 | A tenant MAY contain multiple operating entities, brands, jurisdictions, domains, currencies, programmes and products. | Represent multiple entities/brands/jurisdictions/domains/currencies/programmes/products. MAY; declared support tested. | E3/E4 |
| TEN-003 | Control-plane metadata MUST be separated from regional business data and contain no unnecessary policyholder PII. | Control/regional data separation and minimal policyholder PII projection. | E3; M4 |
| TEN-004 | Tenant context MUST propagate through API, workers, scheduled jobs, webhooks, imports, document generation and intelligence pipelines. | Context survives every API/worker/job/webhook/import/document/intelligence boundary. | E1/E3 |
| TEN-005 | Database access MUST fail closed when tenant context is absent or inconsistent. | Persistence rejects missing/inconsistent tenant context rather than defaulting tenant. | E3; M3 |
| TEN-006 | Per-tenant encryption keys, retention, backup, DR, logging and subprocessor policy MUST be configurable. | Per-tenant key/retention/backup/DR/logging/subprocessor policies govern runtime and stores. | E3 |
| TEN-007 | A release MUST be promotable across development, sandbox, UAT and production without manual configuration drift. | Immutable artifact promotion across dev/sandbox/UAT/prod with hash parity. | E2/E3 |
| TEN-008 | A deployment manifest MUST select region, topology, data stores, secrets, domains, scaling tier, release channel and DR target. | Validate topology/region/stores/secrets/domains/scaling/channel/DR deployment manifest. | E3; M3 registry seed |
| TEN-009 | Cross-tenant support access MUST be time-bound, purpose-bound, approved and fully audited. | Cross-tenant support grant expires, enforces purpose and approval, and is fully audited. | E3 |
| TEN-010 | Automated isolation tests MUST attempt cross-tenant reads/writes on every data and execution surface. | Adversarial cross-tenant tests cover each implemented data/execution surface; unimplemented surfaces remain gaps. | E3; M3 |
| AC-001 | A single Kernel build runs at least Abbeygate and one structurally different tenant without tenant-specific branching in shared runtime code. | One identical build, Abbeygate plus structurally different tenant, anti-fork evidence. | Kernel v1; not replaced by M1 |
| AC-002 | Abbeygate Motor, Home and Travel golden quote-to-issue journeys pass using published Tenant Releases. | Abbeygate Motor/Home/Travel published-release quote-to-issue golden acceptance. | Kernel v1 |
| AC-003 | One Attsure PI journey preserves broker, Australian tax, commission and document outcomes through compatibility configuration. | Attsure PI broker/tax/commission/document outcome parity. | Kernel v1 |
| AC-004 | One Altus SDR batch-to-certificate-and-invoice journey runs through canonical commands or approved extension interfaces. | Altus SDR batch-to-certificate-and-invoice via canonical command or approved extension. | Kernel v1 |
| AC-005 | PolarisRe EAR/CAR can be expressed without adding retail-only assumptions to canonical policy or risk models. | PolarisRe EAR/CAR model fits without retail-only policy/risk assumptions. | Kernel v1 |
| AC-006 | A new sandbox tenant can be provisioned, configured via Config MCP, simulated and published without cloning a repository. | New sandbox tenant provision/configure via MCP/simulate/publish without repo clone. | Kernel v1 |
| AC-007 | An attempted cross-tenant read, write, event, job, cache or document access fails and produces security evidence. | Cross-tenant read/write/event/job/cache/document denials each produce security evidence. | Kernel v1; M3 subset |
| AC-008 | A production transaction can be replayed to the same decision and finance result from stored inputs and version references. | Replay a production transaction from retained inputs/versions to identical decision/finance result. | Kernel v1; production evidence required |
| AC-009 | Rollback activates the previous Tenant Release while preserving transactions already governed by the superseded release. | Activate prior release while transactions retain superseded release references and data. | Kernel v1 |
| AC-010 | No active runtime reads editable configuration drafts. | Instrumented runtime paths consume published releases only; draft edits have no live effect. | Kernel v1; foundation tests |

## Runtime domains

| ID | Source | Required complete domain scope | Acceptance evidence / delivery mapping |
| --- | --- | --- | --- |
| DOM-001 | REQ §6 | Party/relationship roles, broker hierarchy, licences/appointments/legal entities/contacts/consent and account 360 | Canonical party contract and authorized history; E1/E4/E8 |
| DOM-002 | REQ §6 | Submission/quote API/email/portal intake, duplicates/enrichment/questionnaire/options/referral/approval and collaboration | Golden intake-to-quote scenarios; E4/E5; customer scope selects M1/M2 subset |
| DOM-003 | REQ §6 | Underwriting queues/signals/appetite/authority/referral/evidence/notes/conditions/subjectivities, manual decision and four-eyes control | Role/authority decisions and immutable evidence; E4/E5 |
| DOM-004 | REQ §6 | Policy bind/issue/certificates/version/endorsement/cancel/reinstate/renew/expire and immutable risk transactions | Lifecycle golden, replay and rollback evidence; E4/E6/E8 |
| DOM-005 | REQ §6 | Claims FNOL/parties/incidents/coverage/developments/reserves/suppliers/payments/recovery/settlement/close/reopen | Claims contract and balanced claims-money lifecycle; E4/E5/E7 |
| DOM-006 | REQ §6 | Balanced subledger/premium/tax/fees/commission/instalments/invoices/refunds/claims money/reconciliation/exports | Invariants and reconciled financial outputs; E7 |
| DOM-007 | REQ §6 | Documents templates/clauses/data models/generation/signing/version/delivery/incoming classification/evidence lineage | Versioned PDF/email golden and delivery evidence; E4/E6 |
| DOM-008 | REQ §6 | Email/SMS/WhatsApp/portal/print, template/consent/recipient/delivery/threading/inbound capture | Consent/recipient enforcement and retry-safe delivery; E5 |
| DOM-009 | REQ §6 | Risk/premium/claims/cash BDX, CRS/Lloyd's/local schemas/lineage/validation/reconciliation/schedule/correction | Golden reconciled reports with field lineage; E7 |
| DOM-010 | REQ §6 | Tasks/queues/SLA/ownership/escalation/bulk/schedule/exception/audit | Authorized retry-safe work execution and escalation evidence; E5 |
| DOM-011 | REQ §6 | KYC/AML/sanctions/complaints/disclosures/audit access/retention/legal hold and fail-closed gates | Denial/failure scenarios and legal-hold evidence; E3/E5 |
| DOM-012 | REQ §6 | Portfolio KPI/exposure/accumulation/profitability/behavior/anomaly and governed AI recommendation | Tenant-safe projections and reviewed canonical command boundary; later domain delivery |

## Tenant compatibility and Cooper absorption

| ID | Source | Required compatibility / absorbed capability | Evidence needed |
| --- | --- | --- | --- |
| CMP-001 | REQ §9 | Abbeygate Motor/Home/Travel/Immigration Medical–Health/Business/Open Market; CY/PT/GR; public quote/BO/claims/CardCorp/sanctions/docs/Lloyd's BDX | Current-source inventory, approved golden cases and same-or-better shared-runtime outcomes; v1 AC-002 narrows its first acceptance slice |
| CMP-002 | REQ §9 | Attsure AU PI, broker/direct/occupation rating, GST/stamp duty/levies, claims/AU reports/Xero/Curium/Martello/Ebix-Sunrise | Preserve real customer auth/integration/finance differences through compatibility contracts |
| CMP-003 | REQ §9 | Altus SDR portfolios/properties/units/batches/certificates/invoices/claims/reconciliation/imported production data | Batch-to-certificate/invoice golden plus complete production data preservation |
| CMP-004 | REQ §9; MILE M2; received VUW POC/SOW/workbook | Full VUW.ai POC, including multi-capacity policy, rating/quote/bind, servicing, finance/reconciliation, BDX and required interfaces | [VUW matrix](vuw-scope-matrix.md) records received scope, 22 proposed UAT cases and additional source obligations; open inputs and scope precedence require reconciliation; September 11 full-scope timing is reaffirmed, all execution/acceptance remains pending |
| CMP-005 | REQ §9 | Deefa named onboarding target | Verified product/distribution discovery required; no invented customer behavior |
| CMP-006 | REQ §9 | PolarisRe EAR/CAR, delegated authority, docs/endorsements/payments/CRS | Non-retail risk/placement representation and golden evidence |
| CMP-007 | REQ §9; MILE M1; supplied BZ-DEMO v1.0 | Bonzah separate demo tenant with source-defined DTC/API, money, certificates, endorsement, FNOL/reporting path | [Bonzah scope matrix](bonzah-scope-matrix.md) records received source and 14 P0 checks; current eligibility/template approval still pending; generic fixtures are not Bonzah acceptance |
| CMP-008 | REQ §9; MILE M1; received UE property demo pack | UE's 15-module generic property MGA demo; full property product, residency, authority and integrations remain discovery-dependent | [UE matrix](ue-scope-matrix.md) traces received deck/runbook/project plan/source guide; approve missing inputs and rehearse every module with explicit result/boundary; January 1 production scope/year unconfirmed |
| CMP-009 | REQ §9 | Migration means shared-Kernel golden parity, not moving files into a monorepo | Customer-visible and financial outcomes, customer acceptance and observation evidence |
| COP-001 | REQ §10 | Product/coverage/clause/questionnaire catalogs → Product Definition/reusable libraries | Mapped source capability and golden behavior |
| COP-002 | REQ §10 | Process Builder draft/published runtime → Process Definition/Tenant Release | Atomic publication and draft-isolation evidence |
| COP-003 | REQ §10 | Customer engagement presets/capabilities → Experience + process actor/channel policy | Preset and granular permission behavior |
| COP-004 | REQ §10 | Agent contracts/hierarchy/permissions/commission → Party & Distribution/Finance | Multi-level participant and commission outcomes |
| COP-005 | REQ §10 | Billing provider/methods/commission release/accounting review → Collection/Finance/Integration | Provider failure, review and reconciliation cases |
| COP-006 | REQ §10 | Claims forms/certificates/notifications/cancellation → Claims/Document/lifecycle policy | Authorized configured service journeys |
| COP-007 | REQ §10 | Reference data → versioned tenant/product datasets and typed fields | Immutable dataset references and reference validation |
| COP-008 | REQ §10 | COI/certificate workflows → reusable request/issue lifecycle and evidence | Request-to-issued-document golden |
| COP-009 | REQ §10 | Accounting/commissions/reconciliation screens → subledger projections/workspaces | Reconciled screen projections; no second finance owner |

## Migration, non-functional and release gates

| ID | Source | Required scope | Completion evidence |
| --- | --- | --- | --- |
| MIG-001 | REQ §11 phase 0 | Per-repo capability/route/model/integration/golden inventory; stop new tenant literals and duplicate owners | Inventories with source commit references and anti-fork enforcement |
| MIG-002 | REQ §11 phase 1 | Common context/commands/events/product/process/finance/document/tenancy contracts | Contracts build independently and are exercised by callers |
| MIG-003 | REQ §11 phase 2 | Existing database/API mapping, façades and URL compatibility | Public/integration contract parity; no unplanned consumer rewrite |
| MIG-004 | REQ §11 phases 3–4 | Shared-runtime adoption per bounded context; constants become versioned tenant/product/process/jurisdiction/integration config | Registered adapters, canonical ownership and golden behavior |
| MIG-005 | REQ §11 phase 5 | Tenant/entity backfill; reconcile counts/money/docs/audit; time-bound dual-read/run | Checkpoints, deltas, reconciliation and explicit expiry |
| MIG-006 | REQ §11 phases 6–7 | Journey-specific quote/issue/service/claims/finance/reporting cutover; retire duplicates only after observation | Golden parity, rollback rehearsal, production evidence and approved observation period |
| MIG-007 | REQ §11 | Legacy ID aliases/number schemes; provenance-validating mappers; typed extensions; expiring flags/channels | Mapping tests, provenance and consumer inventory |
| MIG-008 | REQ §11 | Shadow rating/validation/docs/reporting; PDF/email/calculation/BDX/lifecycle golden masters | Representative comparisons with approved tolerances |
| MIG-009 | REQ §11 | Roll back Tenant Release without destructive data reversal | New writes preserved; historical version references unchanged |
| NFR-001 | REQ §12 | Least privilege, RBAC plus attributes/authority, MFA/SSO, managed secrets, encryption and approved support access | Security tests and operational identity/key evidence |
| NFR-002 | REQ §12 | Idempotency, transactional outbox, durable queues, retry/DLQ, no-loss workers, circuit breakers/degraded mode | Duplicate/restart/failure/replay scenarios; delivery cannot be claimed from in-memory dispatch |
| NFR-003 | REQ §12 | Immutable command/decision/release audit: actor/authority/input/output/version/time/correlation | Tamper and replay checks with persisted evidence |
| NFR-004 | REQ §12 | Per-journey SLO, asynchronous docs/reports, tenant capacity/throttling and noisy-neighbor protection | Agreed workload and performance/isolation measurements |
| NFR-005 | REQ §12 | Topology SLO/RPO/RTO, regional backup/restore, dependency health/runbooks | Agreed objectives and restore/recovery exercise |
| NFR-006 | REQ §12 | Purpose/retention, minimal PII, deletion/legal hold/residency and minimal AI payloads | Data-flow, retention and deletion/hold enforcement evidence |
| NFR-007 | REQ §12 | Tenant-safe logs/metrics/traces/audit, release/config dimensions, journey alerts and ownership | Observability queries and alert routing without tenant leakage |
| NFR-008 | REQ §12 | WCAG-oriented surfaces, locale/timezone/currency/language/document variants | Keyboard/accessibility and locale cases; M3/M4 surfaces included |
| NFR-009 | REQ §12 | Contract/property/isolation/migration/security/golden/replay/performance/DR testing | Applicable tests linked to requirements, not a blanket test-count claim |
| NFR-010 | REQ §12 | Health/readiness/deploy/rollback/replay/reconciliation/support/status tooling | Runtime version and representative journey/data evidence |
| REL-001 | REQ §13 | Schema: typed references resolve; no illegal fields/cross-version references | Negative and positive compiler cases |
| REL-002 | REQ §13 | Business: authority/dates/territory/finance/docs/process consistency | Named deterministic validation blockers |
| REL-003 | REQ §13 | Security: permissions/secrets/provider scope/residency/tenant boundaries | Denials and boundary checks |
| REL-004 | REQ §13 | Simulate happy/referral/decline/integration/payment failure, endorsement/cancel/renew/claims | Reproducible scenario evidence for supported capabilities |
| REL-005 | REQ §13 | Legacy golden/finance/reporting regression within approved tolerance | Tenant-specific comparisons and signed acceptance |
| REL-006 | REQ §13 | Named human approval of diff/exceptions/residual risk | Verifiable policy-controlled approval record |
| REL-007 | REQ §13 | Atomic immutable release/checksum/signature/effective date/rollback pointer | Persistence/concurrency/signature tests and provenance |
| REL-008 | REQ §13 | Post-release telemetry/reconciliation/error budget/tenant smoke | Observed runtime/build/configuration and live outcome evidence |
| DONE-001 | REQ appendix B | Every migrated capability has canonical owner/public contract, enforced tenant/entity/authority, common UI/API/MCP/job/import paths | Ownership map and transport tests |
| DONE-002 | REQ appendix B | Explicit config/extension boundary; tested draft/publish/version/rollback; golden/reconciliation; no customer literal/parallel truth | Source review, golden and release tests |
| DONE-003 | REQ appendix B | Production-ready telemetry/audit/runbook/failure modes | Operational evidence and acceptance, not source presence |

## Deployment, commercial ownership and continuous documentation

| ID | Source | Required scope | Acceptance / unresolved dependency |
| --- | --- | --- | --- |
| OPS-001 | DEP §§1,7 | Registry per customer × environment × region; document-reported Abbeygate/Altus production; all other status unknown until observed | Every target tenant recorded; unknown must not appear as not deployed |
| OPS-002 | DEP §1 | Stable customer/commercial account/tenant/entity IDs; env/lifecycle/region; cloud/app/namespace/domains; repo/pipeline/SHA/image; schema/config; stores/queues/backups/keys; integrations/API/MCP/hash; owner/support/RPO/RTO/verification/evidence | Typed registry with references only for secrets and explicit unknown fields; seed at M3 |
| OPS-003 | DEP §1 | Residency includes primary/replica/backup/log/telemetry/integration flows | Verified data-flow inventory; Cyprus account identity alone does not prove Cyprus residency |
| OPS-004 | DEP §2 | Inventory actual website, CRM, developer/docs/MCP and Abbeygate website hosts, generators and releases | Authenticated observations; repository URLs and docs are insufficient |
| OPS-005 | DEP §2 | Preserve CRM database and uploads, integration routes, lead/developer/account mapping | Database+file restore; retries do not duplicate leads/subscriptions; no unrelated account merge |
| OPS-006 | DEP §2 | Explicit CRM account/subscription → tenant/environment/entity mapping; one commercial owner; versioned entitlement API/events | Correlated retry/reconciliation tests; no editable subscription copies in tenant stores |
| SOT-001 | DEP §3 | Canonical domain source: owning Kernel commands, schemas and descriptors | UI/API/MCP/imports/jobs delegate to same paths |
| SOT-002 | DEP §3 | Tenant behavior source: versioned configuration packages, immutable Tenant Release | Draft isolation and release references |
| SOT-003 | DEP §3 | Deployment intent: versioned IaC/manifests; observed state: CI/CD plus authenticated runtime registry | Drift recorded as exception, never silently overwritten |
| SOT-004 | DEP §3 | Public contracts: canonical schemas plus explicit HTTP/MCP descriptors | Generated OpenAPI/discovery/catalog/docs; common definitions do not imply identical transport behavior |
| SOT-005 | DEP §3 | Commercial truth: designated CRM/billing service; public docs: versioned artifacts plus approved explanatory source | One writer per fact; documented current owner before future reassignment |
| SOT-006 | DEP §3 | Release manifest pins Kernel commit/image/schema/migration, release/adapters, OpenAPI/MCP/catalog hashes, docs source/build, capabilities, target/env/region, publication/time/evidence | Manifest hashes verified against served artifacts; public projection excludes infrastructure/secrets/other tenants |
| SOT-007 | DEP §3 | Owner/maintainer per record/contract/artifact; reviewed source changes; generated files never hand-edited; explicit compatibility lineage | Ownership records and reproducible generation |
| SOT-008 | DEP §4 | Reconcile Abbeygate platform registry/re-export; Attsure auth/idempotency/host differences; PolarisRe wrapper chain and unrelated host metadata | Trace consumers before retirement; retain functional re-exports and supported contracts |
| SOT-009 | DEP §4 | Verify availability/rate-limit claims; map MCP to schemas/owner/permissions/tenant/release; inventory remaining docs/SDK generators | Behavior-backed capability metadata and unknown backlog |
| SOT-010 | DEP §4 | Classify source/generated/shim/supported older/historical/unused; trace imports/routes/jobs/SDKs/bookmarks/agent discovery before removal | Consumer/deprecation register, replacement links and active discovery reconciliation |
| SOT-011 | DEP §4; MILE M3 | Per-type/field support complete/partial/missing/deprecated; unknown distinct from unsupported; UI/API/MCP/validation/simulation coverage | Scoped gap register with owner/affected tenants/workaround/target; missing/incomplete/invalid/inconsistent/unsupported rows include field or capability, applicable requirement, expected state, journey/severity/remediation |
| SOT-012 | DEP §5 | Source validation: descriptors/schema/breaking changes/auth/permissions/isolation/capabilities and declared OpenAPI version | Release validation pipeline and deliberate failing examples |
| SOT-013 | DEP §5 | Generate OpenAPI/MCP/catalog/gaps/reference/examples/applicable SDKs from same versioned inputs | Reproducible artifacts and source hashes |
| SOT-014 | DEP §5 | Exercise HTTP/MCP parity, required fields/errors/denials/config visibility with server-authorized context | Complete and incomplete tenant acceptance tests, M3 |
| SOT-015 | DEP §5 | Pin hashes; deploy governed lane; keep accurate prior docs until matching runtime verified; publish tenant/env/version with cache/index/version navigation | Deployment + served contract/docs evidence; no external publication established by local generation |
| SOT-016 | DEP §5 | After deploy compare runtime/contracts/registry/public docs; daily reconciliation is proposed; open owned drift issue | Deliberate hash mismatch prevents ordinary release labeled current; no automatic schedule created by this document |
| SOT-017 | DEP §§3,5 | Urgent incident fixes keep active authorized lane; reconcile contracts/docs/manifest in tracked incident; docs outage must not force data-risking rollback | Incident runbook and truthful version availability |
| OPS-007 | DEP §6 Abbeygate | Define Cyprus account/entity and precise reset boundary; inventory all state/CRM/integrations; preserve serviced territory rules | Explicit approved scope, restore-tested scoped export, golden compatibility and parallel-operation truth |
| OPS-008 | DEP §6 Abbeygate | Cutover isolates workers/inbound, final sync and approved reset, reconciles remaining records; verifies domains/payments/webhooks/numbering/access | One writer; safe deduplicated replay; rollback preserves post-cutover writes; no unrelated data reset |
| OPS-009 | DEP §6 Altus | Resolve active Helm/App Service lane/stores; baseline IDs/counts/money per currency+account/files/permissions/audit | Exact production inventory and complete reconciliation baseline |
| OPS-010 | DEP §6 Altus | Expand compatibly, restore-test, rehearse isolated with external effects off, backfill/checkpoint/delta/shadow with one writer | No duplicate charge/notification; final delta and all counts/control totals match; no lost write/orphan/missing file |
| OPS-011 | DEP §6 Altus | Monitor customer journeys, prefer safe forward repair, preserve new writes on rollback, retire stores only after consumer/retention gates | Recovery rehearsal, retention and legacy retirement evidence |
| OPS-012 | DEP §§6–7 | Maintain customer service, incident/support ownership and urgent-fix path while migrating | Shared fixes reconciled to Kernel/adapters; complete migration evidence pack and readiness review |

## Epic coverage and decisions

| Epic | Required exit from REQ §15 | Related coverage |
| --- | --- | --- |
| E1 Kernel boundary | Shared runtime compiles independently of tenant packages | ARC; MIG-001/002; CFG transport ownership |
| E2 Configuration compiler | Draft-to-sandbox covers product + process | MOD; PRD/PBR/CFG; REL |
| E3 Tenancy & residency | Two tenants share one topology safely; one runs in a separate region/topology | TEN; NFR; OPS registry/residency |
| E4 Product framework | Abbeygate products register without shared-code literals | PRD; CMP/COP; DOM |
| E5 Process framework | Published Process Version governs runtime gates | PBR; COP; DOM; ARC-004 |
| E6 Migration framework | Existing tenant journey cut over without rewrite | MIG; OPS; DONE |
| E7 Finance & reporting | Financial and BDX outputs reconcile to legacy truth | DOM-006/009; MOD-008/011; CMP |
| E8 Customer migrations | Golden journeys/observation passed and forks progressively retired | CMP; MIG; OPS; AC |

Accepted instructions versus implementation proposals and unresolved decisions are tracked in [September plan](september-plan.md#decisions-and-authorization). No default topology, billing provider, hosting owner, named delivery owner or production cutover window has been accepted merely by being recommended in a source document.

## Evidence record contract

An evidence entry must identify requirement IDs, exact scope, source requirement version, implementation file/test, command and result, build/commit and configuration versions, tenant/environment, timestamp and known limits. Customer acceptance adds reviewer and approved sample/provider boundaries. Deployment acceptance adds runtime identity, served hashes, representative live UI/data, registry reconciliation and recovery evidence.

Until those records exist, do not promote this matrix from planning status. In particular: a generic “complete” fixture is only complete for implemented foundation contracts; it does not satisfy customer scope or all north-star product requirements. A test count, green build, documentation artifact, local screen or HTTP 200 does not establish migration completion.
