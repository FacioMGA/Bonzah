# September 2026 delivery plan

**September 7 implementation correction:** Uriel directed reuse of the complete Abbeygate MGA application with PostgreSQL tenancy and Symphony configuration. The active implementation and current evidence are in [the shared MGA delivery record](gen2-multitenant-checkpoint-2026-09-07.md). Earlier scaffold sprint counts below are historical and do not measure completion of this application. Original customer scope and dates remain unchanged.

Planning baseline: Sunday 6 September 2026; customer source intake refreshed the same day. All dates and operating times use Asia/Jerusalem. Bonzah's blueprint specifies September 10 at 9:30 AM Central for 45 minutes: 17:30–18:15 Asia/Jerusalem if Central means America/Chicago. UE's new source guide cites a September 2 invitation for September 10, 18:30–19:15 Jerusalem / 11:30–12:15 EDT. Neither invitation has been independently read here. The source times leave 15 minutes between demos. End of day is the original source document's working assumption for September 8, 11 and 12; it is not an agreed hour.

The first delivery priority is M3 on September 8: a working configuration inspection surface, canonical API and MCP with a truthful completeness inventory. Its contracts support the separate Bonzah/UE demo packages, VUW.ai POC and self-onboarding readiness design. Customer scope collection and onboarding design proceed alongside that implementation.

The complete source scope is recorded in [requirements-matrix.md](requirements-matrix.md). This plan preserves the original dates and acceptance boundaries. It does not treat all long-term Kernel domains or existing-customer migrations as due by September 12.

Execution now uses the private [FacioMGA/facio-kernel repository](https://github.com/FacioMGA/facio-kernel), [sprint plan](sprint-execution.md) and [linked backlog](sprint-backlog.json). Uriel's September 6 instruction explicitly authorizes repository creation and sprint implementation. The older `FacioMGA/Kernel` application is preserved separately. Remote CI has verified the initial configuration foundation; insurance sprint evidence is recorded separately in [sprint-1-evidence.md](sprint-1-evidence.md).

## Current delivery state

| Workstream | Planning state | Evidence boundary | Next gate |
| --- | --- | --- | --- |
| Clean Kernel foundation | Implemented and locally verified; see foundation-evidence.md | Source presence is not test, deployed-runtime or customer acceptance evidence | Record actual commands/results/build and scoped behavior |
| S1 shared insurance record | Implemented; local verification passed; integration tracked in [PR #18](https://github.com/FacioMGA/facio-kernel/pull/18) | 44 automated tests and 22 compound browser checks passed. Synthetic versioned quote/bind/manual service, exact allocations, immutable history and pending outbox; no customer or production acceptance | K03 product/authority decisions and K04 provider ingress; resolve K15 inputs |
| M3 configuration visibility | In progress; acceptance pending | Must pass real screen/API/MCP parity and tenant/role isolation | September 8 |
| Customer source requirements view | Implemented and locally verified for UE/VUW intake scopes | Screen, HTTP and MCP expose captured requirements, outcomes, categories and open inputs; 25 automated tests and 12 browser checks passed. Insurance execution and acceptance remain pending | Use mapped source scope to build and exercise customer capabilities |
| M1 Bonzah + UE | Both source packs received and scope mapped; implementation/acceptance pending | Bonzah P0 path and UE property MGA journey have separate [Bonzah](bonzah-scope-matrix.md) and [UE](ue-scope-matrix.md) acceptance matrices; source descriptions do not prove this Kernel executes them | Scope freeze September 7; both-tenant rehearsal September 9; resolve remaining customer inputs |
| M2 VUW.ai full POC | POC/SOW and configuration workbook received; execution and source conflicts remain open | [VUW scope matrix](vuw-scope-matrix.md) preserves full POC obligations, workbook UAT and open inputs; newer staged customer dates do not silently replace the Kernel deadline | Baseline full scope September 7; integrated run target September 10; September 11 full-POC deadline explicitly reaffirmed by Uriel |
| M4 self-onboarding design | [Design draft 0.1 prepared](self-onboarding-specification-draft.md); not accepted or implemented | Journey, screen/actions, states, proposed interfaces, Live gates and exceptions documented for engineering refinement; provider/owner decisions and reviews remain open | Cross-functional review September 11; final September 12 |
| Existing-customer migration | Inventory/readiness planning; no cutover accepted | Live deployment, data, recovery and exact cutover scope not verified here | G0 then G1/G2, dates after readiness review |

This status table must be updated from implementation and acceptance evidence. An assigned role below is a proposed accountable function, not a named or accepted staffing assignment.

## Decisions and authorization

| ID | Status | Decision / instruction | Basis / unresolved action |
| --- | --- | --- | --- |
| DEC-001 | Accepted user instruction | Start building clean code against supplied requirements, goals and dates | Current user request |
| DEC-002 | Delegated implementation judgment | Use latest Abbeygate as backbone or selectively reuse useful capabilities | User explicitly delegates the choice; record source commit and reuse rationale |
| DEC-003 | Required baseline | Shared runtime owns insurance decisions; tenant differences use configuration or typed registered extensions | REQ §§1–2; no customer-name branches or permanent forks |
| DEC-004 | Chosen for local foundation; source audit complete | Build an independent Kernel foundation and selectively adopt verified Abbeygate contracts/patterns | Preserve existing repositories and document provenance. The reuse audit must distinguish source-pattern reuse from migrated executable capability |
| DEC-005 | Proposed in REQ §16 | Packages plus versioned tenant/product configurations, with existing apps consuming releases | Final repo/publication ownership and package distribution remain architecture decisions |
| DEC-006 | Proposed in REQ §16 | Regional pooled compute with dedicated DB for regulated/enterprise tiers | Tenant-specific topology, region and accepted shared-SaaS isolation default remain unresolved |
| DEC-007 | Proposed in REQ §16 | Typed relational canonical model plus signed release documents | Any local file/in-memory implementation is development storage only until durability/concurrency/security requirements are proven |
| DEC-008 | Proposed in REQ §16 | Insurance-aware commands/state and declarative gates; balanced insurance subledger; shared registered UI panels | Record ADRs as these contracts become concrete; no general workflow engine or finance provider selected by this plan |
| DEC-009 | Required product control | Production publication requires policy-controlled named human approval and signed release | Implement and test the control; possession of MCP credentials cannot bypass it |
| DEC-010 | Proposed staffing | Platform Engineering leads M1/M3, Product + Engineering M2, Product/UX plus Platform/Billing reviewers M4; Uriel product acceptance owner | Confirm named accountable people, reviewer availability and capacity on September 7 |
| DEC-011 | Unresolved | Canonical contract package/registry location, live deployment lanes, developer-site sources and ownership | Local scaffolding does not select the future production source automatically |
| DEC-012 | Unresolved | CRM/billing/subscription/entitlement current and future owners, stable identity mapping and providers | Preserve one owning commercial service; avoid editable copies in every tenant store |
| DEC-013 | Unresolved operational scope | Abbeygate Cyprus tenant/entity identity and precise reset; Altus active lane/data inventory; cutover windows and recovery targets | Document text is not authorization to execute a reset or migration |
| DEC-014 | All three customer source baselines received; remaining acceptance inputs unresolved | Bonzah blueprint/API/FNOL; UE property demo deck/runbook/project plan/source guide; VUW.ai POC/SOW/configuration workbook read September 6 | Follow the three customer scope matrices; source acquisition is closed, while specific open inputs, executable coverage and sign-off remain explicit; DEC-015 resolves the VUW date precedence |
| DEC-015 | Accepted user instruction, September 6 | Keep September 11 for the **full VUW.ai POC** | Overrides later September 18/25 source timing without removing any scope; acceptance requires all mandatory items and evidence |

The documents recommend future operational actions and production controls. Uriel's current request authorizes the private implementation repository, sprint tracking and code integration. It does not convert document prose into approval for public publication, destructive resets or production customer cutover. No recurring daily monitor is created by the document's proposed reconciliation schedule.

## M3 — working configuration visibility, September 8

The minimum acceptance slice is a real, authenticated inspector over the same canonical service used by HTTP and MCP. It must show configured values and their provenance/version state, not only schema descriptions. All thirteen canonical configuration categories are inventoried; incomplete implementation is visible as a gap.

| Work package | Required behavior | Tests / evidence | Proposed accountable role |
| --- | --- | --- | --- |
| M3-A Context and canonical contract | Strict typed models; server-injected tenant/entity/actor/role/permission/correlation; one command/query owner | Reject unauthenticated context and payload context override; same output on authorized paths | Kernel / API lead |
| M3-B Configuration inventory | Tenant, entity, distribution, product, programme/binder, process, jurisdiction, finance, documents, integrations, reporting, experience and release categories | Catalog contains every category with accurate field/operation support and required/conditional schema metadata | Configuration lead |
| M3-C Draft/publication distinction | Current draft revisions separately from immutable published/effective versions; active runtime reads published versions | Draft edit leaves release unchanged; response identifies selected version/state; unsupported publication is not advertised as working | Kernel lead |
| M3-D Completeness compiler | Detect supported missing/incomplete/invalid/inconsistent/unsupported cases; unresolved graph/capability problems are named | Golden complete/incomplete configurations; invalid references/cycles where supported; unsupported algorithm produces typed REQUIRES_ENGINEERING item | Configuration lead |
| M3-E API Documentation screen | Authenticated tenant/role-scoped category navigation, values/version status, gaps/remediation; loading/empty/denied/error states; keyboard use | Browser walkthrough for complete/incomplete fixtures, denied role and tenant separation; secret projections verified | Experience lead |
| M3-F HTTP/OpenAPI | Implement documented routes; valid retrievable OpenAPI with schemas/fields/conditional constraints/enums/auth/errors/operations | Declared OpenAPI validator plus representative real requests, permission denial and error schema checks | API lead |
| M3-G MCP | Discover tools and inspect same model/gaps; strict inputs/outputs; writes call canonical draft services under publication permissions | Real discovery/read invocation, unknown/invalid input rejection, permission parity and canonical write audit | MCP lead |
| M3-H Cross-surface parity | One complete foundation fixture and one deliberately incomplete fixture use the same service contract; no secrets leak | Compare screen response model, HTTP results and MCP results, stable requirement/gap identifiers and exact version references | Test / API lead |
| M3-I Release/source inventory | Seed deployment registry and duplicate-source backlog; pin contract/catalog hashes and source revisions | Missing deployment facts stay unknown; public projection omits secrets/internal-only data; deliberate contract mismatch detected | Platform / Developer Experience |
| M3-J Acceptance record | Screen walkthrough, OpenAPI artifact, MCP output, gap report and isolation evidence linked to build/configuration | Every failed mandatory condition remains open; acceptance owner reviews actual runnable result | Product acceptance owner |

### Completeness and gap semantics

Support state and tenant-configuration health are separate dimensions. A schema may be implemented while a particular tenant lacks a required value. A valid value may reference an algorithm that has no executable extension. A category may be inventoried while implementation status is unknown. Collapsing these into one “complete” flag is misleading.

| Dimension | Values / minimum representation |
| --- | --- |
| Platform support | Complete, partial, missing, deprecated; explicit unknown when not assessed; unsupported is an explicit capability finding, not a synonym for unknown |
| Tenant health finding | Missing, incomplete, invalid, inconsistent, unsupported; unknown findings remain visible when source validation is pending |
| Surface coverage | UI, HTTP/API and MCP availability separately; validation and simulation support separately |
| Identity | Stable finding ID; tenant/product/process; configuration category and field or capability; applicable requirement ID |
| Explanation | Current state, expected state, affected journey, severity, deterministic blocker code and actionable remediation |
| Delivery ownership | Owner or explicitly unassigned, affected customers, workaround, target milestone, source/provenance |
| Integration projection | Connection status and opaque secret/provider reference; never secret value, access token or private credential payload |

M3 does not require falsely labeling the north-star feature set complete. Its inventory must distinguish executable foundation contracts, partial domain support and discovery-dependent customer acceptance.

### M3 acceptance checklist

- [ ] Actual application starts and exposes authenticated UI, HTTP and MCP interfaces.
- [ ] All thirteen categories can be discovered and their support states inspected.
- [ ] Values, draft revision and published/effective version information are visible within scope.
- [ ] Retrievable OpenAPI passes validation and only advertises implemented operations as available.
- [ ] MCP discovery and real invocation return the same authorized configuration and gaps as HTTP.
- [ ] Complete/incomplete foundation fixtures produce expected consistent gaps on all surfaces.
- [ ] Missing context, insufficient role and cross-tenant access are denied and auditable.
- [ ] Draft writes return revision and human/machine diffs; unsupported mutations are honest.
- [ ] No plaintext secrets or other tenant's configuration appear in responses or artifacts.
- [ ] Registry/source backlog records unknowns and contract drift is detectable.
- [ ] Evidence names exact build/configuration, limitations and acceptance result.

Local test and browser evidence is recorded in [foundation-evidence.md](foundation-evidence.md). The checklist remains a milestone acceptance checklist; local technical verification does not mark stakeholder acceptance.

## M1 — Bonzah and UE before September 10 demo

The September 7 scope baseline must identify source document/version, approved requirement, tenant, configuration or reusable capability, owner, scenario, expected output and acceptance evidence. Bonzah's supplied [v1.0 scope matrix](bonzah-scope-matrix.md) records 14 P0 checks and two P1 checks: DTC/API parity, verified-money bind, coverage certificates, a four-to-six-day date endorsement preserving history, scoped FNOL and two-schema aggregate reporting. Its source time is 9:30 AM Central, interpreted as 17:30 Jerusalem pending invitation verification.

The newly received [UE matrix](ue-scope-matrix.md) covers the requested 15-module property MGA walkthrough: broker/submission intake, underwriting/enrichment/rating, selected quote/bind/policy history, servicing/FNOL, billing/commission and reconciled reporting. Source intake uses the supplied institutional package; quote prices, policy events and money continuation are explicitly synthetic until approved references exist. Every module must have an observed rehearsal result or a labeled prepared/design/unresolved disposition. Such a disposition preserves demo honesty; it does not automatically satisfy the original Kernel executable-journey gate. Rating/API, property product/authority, document, finance and provider inputs remain open. UE's source-cited time is 18:30–19:15 Jerusalem on September 10. Its January 1 launch reference has no confirmed year or accepted production boundary.

| Date / sequence | Required action | Gate |
| --- | --- | --- |
| September 7 | Freeze both source-backed scenario matrices, source-versus-synthetic cases, field mappings and scene owners; confirm sign-off inputs | Bonzah T−72 at 17:30 Jerusalem under US Central assumption; UE's 15 module dispositions and missing rules must be explicit |
| September 7–8 | Configure separate tenant/product/process/document/integration packages on the same Kernel build; triage M3 gaps against each journey | Requirements map to executable configuration or explicit typed extension work |
| September 8–9 | Run full scenarios, outputs and required referral/approval/failure paths; change material behavior using configuration alone | No tenant-name branches, embedded customer rates/rules, duplicate lifecycle logic or customer database bypass |
| Wednesday September 9 | Full rehearsal and candidate configuration/build freeze; record reset procedure and issue list | No unresolved issue blocks an approved journey; docs match candidate manifest |
| Thursday September 10, before demo | Final smoke and exact build/release confirmation | Both approved journeys pass on one build with separate packages |

If a provider is simulated, label the boundary, preserve the real integration contract and obtain acceptance of that demo boundary. Synthetic reference packages prove reusable mechanics; customer acceptance requires the mapped Bonzah and UE paths and explicit limits. Both packs distinguish demonstration preparation from verified runtime behavior. Their descriptions and legacy claims do not transfer automatically to this clean Kernel. A frozen demo package is not a production rollout.

## M2 — complete VUW.ai POC, September 11

The POC implementation specification, SOW v1.1 and September 6 configuration/open-input workbook have now been located and captured. The [full scope matrix](vuw-scope-matrix.md) preserves the workbook's 22 proposed UAT scenarios alongside SOW-only obligations and open decisions. Source acquisition is resolved; source review does not establish signed scope, completed UAT or integration access. Sources consistently spell the project VUW.ai; the user's latest message called it VUE.ai, treated here as the supplied project without changing its recorded identity.

Uriel explicitly reaffirmed on September 6: **Keep September 11 for the full POC.** This resolves date precedence over the customer source schedule of Gate 3 on September 11, Gate 4 on September 18 and Gate 5 on September 25. Preserve the complete scope, including later-gate obligations, within the September 11 target. The decision changes delivery timing, not evidence of feasibility, completed integration or acceptance. Do not narrow M2 to Gate 3.

Required matrix columns are: source requirement → configured capability → scenario → expected output → result → evidence → defect. Each row also records mandatory/optional classification from the approved source, role, environment, build/configuration and any accepted provider-test boundary.

| Date / sequence | Required action | Gate |
| --- | --- | --- |
| September 7 | Baseline the received POC/SOW/workbook requirement union; reconcile document precedence and open inputs, assign all gate obligations to the reaffirmed September 11 target and identify acceptance reviewers | No unverified scope silently invented, superseded or removed |
| September 7–9 | Create isolated tenant; configure required product/process/authority/document/report/integration contracts; implement reusable gaps | Every mandatory source item has an owned executable test |
| Wednesday September 9 | Run POC scenarios and fix blocking gaps | Persistence, authorized roles, isolation and reproducibility covered |
| Thursday September 10 | Complete integrated full POC run | Real interfaces and outputs exercised; environment/provider limits explicit |
| Friday September 11 | Fix mandatory defects, rerun impacted scenarios and collect acceptance | Every mandatory item passes; complete matrix/walkthrough/version references/acceptance record |

Any failed mandatory item leaves M2 incomplete. A complete foundation, a three-domain walkthrough or successful demo does not close this milestone.

## M4 — self-onboarding specification, September 12

M4 is a parallel design deliverable ready for engineering breakdown. The specification must cover website entry through live operation and subsequent account servicing; implementing all services is not required by this date. Provider choices remain explicit decisions until selected.

The [self-onboarding specification draft](self-onboarding-specification-draft.md) provides the initial journey map, annotated screen structure, action catalogue, state models, proposed interfaces, activation gates and exception paths. It records unresolved decisions and is neither accepted nor implemented.

| Area | Required experience / interface scope | Required outputs |
| --- | --- | --- |
| Entry and identity | Entry points, sign-up/login, verification, organization, invitations, role selection, return/resume | Annotated screens and identity/organization states; safe resume/error/recovery |
| Plans, subscription and billing | Plan comparison/selection, entitlements, optional trial, payment setup, invoices/tax, renewal/upgrade/downgrade/cancel/failed payment | Subscription state model, commercial owner, money/event contracts and recovery |
| Configuration | Business/product/process intake using forms or LLM/MCP; source upload, validation/gap guidance/progress/saved drafts | Typed intake/data-source provenance, canonical commands, draft-state navigation |
| Environment and domain | Residency, provisioning/status/default URL, customer ownership verification, DNS/TLS/errors/retry | Environment/domain state model, data residency contracts and reconciliation |
| Draft/test to Live | Isolated test data, simulation/readiness, approval/authority, subscription/payment gates, publish/activation/rollback | Gate matrix identifying actor, required evidence, blocker code and recovery per transition |
| Customer account panel | Profile/organization/users, subscription/billing/invoices/payment, environment/domain, support/service requests/status/notifications | Screen/action inventory, role matrix and account-servicing exception paths |

Every screen and material action must specify actor, preconditions, fields, validation, canonical command/API, resulting state, permissions, loading/empty/error/recovery, mobile behavior and accessibility. Every external interface must specify system of record, payload schema, authentication, webhook/event, idempotency, retry and reconciliation.

Required interface catalogue entries: identity; Control Plane; Kernel configuration and MCP; payment provider; subscription/entitlements; infrastructure provisioning; domain/DNS/TLS; CRM; support; notifications. CRM account/subscription IDs map explicitly to runtime tenant/environment/entity IDs. Commercial facts retain one writer and customer PII stays in the regional data plane where appropriate.

| Design checkpoint | Date | Acceptance material |
| --- | --- | --- |
| Outline journey and interfaces | Monday September 7 | Source-linked map and decisions/dependencies |
| Review screens and interface ownership | Wednesday September 9 | Annotated drafts, actors/states/actions and owner gaps |
| Review billing/domain/live failure paths | Thursday September 10 | Exception catalogue and readiness/recovery gate matrix |
| Cross-functional review | Friday September 11 | Product, UX, Engineering plus Platform/Billing review and remaining defects |
| Final specification acceptance | Saturday September 12 | Linked journey map, annotated screens, account/subscription/environment models, API/event catalogue, Live gates and exception catalogue |

## Daily execution checkpoints

| Date | Required checkpoint from source | Forecast-sensitive dependencies |
| --- | --- | --- |
| Sunday September 6 | Publish baseline; identify sources, owners, access and capacity conflicts | Independent clean implementation can proceed; implementation evidence still pending |
| Monday September 7 | Freeze demo/POC matrices; inventory gaps; choose shared build/profiles; outline onboarding journey/interfaces | All three customer packs received; execute against the reaffirmed full VUW September 11 target and resolve open inputs, UE product/provider/finance decisions, invitation verification, named owners/capacity and Bonzah sign-off inputs |
| Tuesday September 8 | Accept M3; triage report against Bonzah/UE/VUW.ai and resolve launch blockers first | Working cross-surface configuration plus honest source/deployment unknowns |
| Wednesday September 9 | Rehearse/freeze both demos; run POC scenarios; review onboarding screens/interface ownership | Candidate build/configuration, sample data and provider boundary acceptance |
| Thursday September 10 | Final demo smoke; integrated VUW.ai run; billing/domain/Live failures reviewed | Exact demo time and mandatory customer scenario results |
| Friday September 11 | Accept full POC; fix mandatory defects; finish M4 review | Complete POC matrix and available reviewers |
| Saturday September 12 | Deliver and accept final M4 specification | No uncovered material screen/action/interface/exception |

No effort estimate or staffing capacity has been inferred from these aggressive dates. Review milestone state, coverage, blocker, owner, next action and forecast every day. Escalate a forecast miss when known with the missing acceptance condition and recovery options; preserve scope and dates unless Uriel approves a change.

## Dependency and blocker register

| ID | Dependency / missing fact | Impact | Owner / required next action | Need-by |
| --- | --- | --- | --- | --- |
| DEP-001 | Bonzah source received: build-ready v1.0 plus API coverage prose and FNOL | Scope acquisition closed; implementation and acceptance remain open | Follow [Bonzah scope matrix](bonzah-scope-matrix.md), baseline P0 tests and synthetic package; source approval caveats tracked as DEP-013 | September 7 scope freeze |
| DEP-002 | UE deck, runbook, project plan and source guide received September 6; source-acquisition gap closed | Executable 15-module coverage, approved property/rating/authority/finance/documents, provider boundaries and customer acceptance still need evidence | Demo/Product owner unassigned; use [UE matrix](ue-scope-matrix.md) and assign rehearsal dispositions plus specific open inputs | September 7 baseline; September 9 rehearsal |
| DEP-003 | VUW.ai POC/SOW/configuration workbook received; source-acquisition gap closed | Open inputs, scope precedence and unrun UAT still block acceptance; Uriel resolved timing in favor of the complete POC by September 11, including later-gate obligations | POC owner unassigned; reconcile [VUW matrix](vuw-scope-matrix.md), complete inputs and assign executable scenarios for the entire scope | September 7 baseline |
| DEP-004 | Named delivery owners, capacity and acceptance reviewers | Timeline feasibility and handoffs unknown | Product/Engineering leadership to allocate people and review windows | September 7 |
| DEP-005 | Bonzah source specifies September 10, 9:30 AM Central, 45 minutes; UE source cites 18:30–19:15 Jerusalem / 11:30–12:15 EDT | Source schedule leaves 15 minutes between Bonzah and UE; direct invitation verification and handoff/rehearsal staffing remain open | Demo owner to verify invitations, presenter roles, environments and reset/handoff plan | Before September 9 rehearsal |
| DEP-006 | Approved provider-test boundaries and required access | Customer scenario output may depend on unavailable integration | Respective owner to verify credentials via managed references and agree simulation limits | Before scenario execution |
| DEP-007 | Live deployment resources/regions/owners and Altus active lane | Registry remains unverified; migration unsafe | Platform Operations inventory by authenticated observation | M3 seed; G0 completion |
| DEP-008 | Canonical production contract/registry and developer-site generators/hosting | Public documentation convergence not verified | API/Developer Experience owner to trace consumers and select governed sources | M3 seed; before publication |
| DEP-009 | CRM/billing/entitlement current owner, providers and identity mapping | M4 interface decisions and activation gates unresolved | CRM/Billing/Control Plane owners to agree contract ownership | M4 review September 11 |
| DEP-010 | Abbeygate Cyprus tenant/entity identity and exact reset scope | No controlled reset can be executed | Customer/Operations owner to supply scoped plan, parallel-operation truth and restore evidence | G0/G1 readiness |
| DEP-011 | Altus full data baseline, recovery targets and tested backup | Cannot establish data-preserving migration readiness | Migration/Operations owner to inventory all records/money/files/audit and rehearse | G0/G2 readiness |
| DEP-012 | Deefa and remaining prospect verified product/distribution scope | Final prospect compatibility not established | Product owner to complete discovery; no invented customer requirements | Before respective acceptance |
| DEP-013 | Bonzah current state/vehicle rules and certificate form/licensing approval; conflicting PAI source figures | Required before Bonzah demo sign-off; production integrations and full compatibility remain separate discovery | Bonzah/carrier/legal owner to confirm selected version; no presumed current-rate or template approval | Before September 10 demo sign-off |

These dependencies do not block independent foundation implementation, source inventory, generic compiler tests or M4 structural design. They block only claims and actions that require the missing customer or operational facts.

## Evidence and release discipline

Maintain one evidence record per accepted slice. It must include requirement IDs, source version, exact build/commit, tenant/configuration versions, environment, test/walkthrough commands and outputs, result, limitations and acceptance owner. For a deployed release, also record image/runtime identity, OpenAPI/MCP/catalog/docs hashes, served contract versions, registry reconciliation and representative live data/journeys.

Initial local work is ready for review when actual tests pass, the runnable inspector is demonstrated, deliberate incomplete and unauthorized cases behave correctly, and the matrix truthfully identifies what remains unimplemented or discovery-dependent. This is distinct from full M1/M2 customer acceptance, Kernel v1 acceptance, public documentation publication or customer migration completion.

Planned production releases must fail parity checks for deliberately mismatched hashes. Urgent fixes retain the existing incident lane and receive tracked contract/document reconciliation; documentation failures must not force a rollback that destroys customer writes. No migration date is derived from the demo or POC calendar.
