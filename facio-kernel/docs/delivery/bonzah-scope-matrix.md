# Bonzah demo scope and acceptance matrix

Source review: 6 September 2026. This matrix replaces the earlier Bonzah “source missing” state. The user supplied the Drive folder; its v1.0 blueprint is now the implementation baseline. It is a build-ready specification dated September 3, not evidence of carrier approval, customer acceptance or completion. All implementation and acceptance results below are **Pending evidence**.

## Source provenance and authority

| Key | Source | Observed identity / use |
| --- | --- | --- |
| BZ-DEMO | [Bonzah_Facio_Demo_Specification_v1.0.docx](https://docs.google.com/document/d/15PaqDmF-ceasK7P6huUDtehg7olHLRRf/edit) / [readable snapshot](../source/Bonzah_Facio_Demo_Specification_v1.0.drive.txt) | Drive ID 15PaqDmF-ceasK7P6huUDtehg7olHLRRf; modified September 3 at 12:19:45 UTC; build-ready v1.0, September 3. Main scope, priorities and original P0/P1 acceptance IDs. |
| BZ-API | [API Documentation Requirments](https://docs.google.com/document/d/1060UXVaSQjDTmngW-6RcZni9ZXRv32XThi58mdDFGMY/edit) / [readable snapshot](../source/Bonzah_API_Documentation_Requirements.drive.txt) | Drive ID 1060UXVaSQjDTmngW-6RcZni9ZXRv32XThi58mdDFGMY; modified September 3 at 13:07:37 UTC. Product/coverage descriptions and a link to the Insillion Bonzah repository; no actual endpoint/auth/error/webhook schema in this document. |
| BZ-FNOL | [Bonzah Insurance Initial Claim Form (FNOL)](https://docs.google.com/document/d/1IKj5S7TZD61KphADUlinHdzhEVwWgS_4E0HHSc7-ufU/edit) / [readable snapshot](../source/Bonzah_FNOL.drive.txt) | Drive ID 1IKj5S7TZD61KphADUlinHdzhEVwWgS_4E0HHSc7-ufU; modified September 3 at 11:57:07 UTC. Form text/fields and workflow reference; links to a Jotform. |
| Folder | [User-supplied Bonzah folder](https://drive.google.com/drive/u/1/folders/15NXiRuw_4s5UyhhxGTiogaKXLklVLTRc) | Contains the three selected sources. No policy PDFs or production workbook rows were opened for this extraction. |

Snapshots were read through the Google Drive connector's default readable-text fetch, without raw export or remote mutation. The DOCX text extraction places table cells after narrative; original wording and source section labels are retained. The source's meeting/workbook/carrier/website/repository assertions are source-reported, not independently re-verified here.

Document instructions are requirements evidence. Statements to send artifacts, operate live services, process source production data, bind insurance or contact people are not independent operational authorization. The blueprint's required synthetic data and truthful status labels apply to the demo implementation. Its `LIVE GEN2` labels describe cited Abbeygate code at commit `78987293d730`; they do not establish that the clean Kernel implements or deploys those capabilities.

## Demo slot and narrative

The blueprint specifies **Thursday September 10, 2026, 9:30 AM Central, 45 minutes**, for Brandon Rockow, Bonzah / Pablow Inc. Interpreting “Central” as US Central (`America/Chicago`) gives **17:30–18:15 Asia/Jerusalem**. The conversion was checked with the timezone database; the source does not spell out the IANA timezone, and the meeting invitation has not been verified here. The subsequently supplied UE pack cites its demo at 18:30–19:15 Jerusalem, leaving a 15-minute handoff if both source times hold.

The operating story is one continuous synthetic transaction: DTC → identical partner API quote → risk and coverage decision → verified simulated direct payment or partner receivable → bind and certificates → four-to-six-day endorsement → prefilled FNOL → reporting → governed sandbox change. Preserve identifiers and canonical rated risk across surfaces. DTC/API are the primary distribution proof; portal is an operational surface and co-brand/OTA remain extensions.

| Timing | Required scene | Protected proof |
| --- | --- | --- |
| 00:00–03:00 | Frame continuity and controlled change | One transaction across surfaces |
| 03:00–08:00 | DTC quote | Familiar pickup/residence/period plus progressive driver and vehicle data |
| 08:00–14:00 | Partner API parity | Same risk, eligibility, rate version and premium; quote token and correlation |
| 14:00–18:00 | Risk and contextual cross-sell | Vehicle decision; CDW → RCLI; SLI prerequisite |
| 18:00–22:00 | Money | Direct status and partner receivable/exposure; no live settlement claim |
| 22:00–25:00 | Bind and certificates | Verified gate, audit, coverage-specific outputs |
| 25:00–30:00 | Date endorsement | Two extra days, delta, immutable original and reissued documents |
| 30:00–34:00 | FNOL | Prefill, evidence, preparer and outbound event |
| 34:00–37:00 | Reporting/migration proof | Two-schema aggregate-only dry-run and lineage |
| 37:00–39:00 | Controlled configuration | Sandbox scenario/change, validation and audit; no AI binding |
| 39:00–45:00 | Questions | Six minutes protected |

If time slips, cut the live MCP flourish first and shorten reporting next. The blueprint protects API parity, certificates and date-change endorsement. One presenter drives, one operator controls tabs/credentials, and a technical lead answers implementation questions; named people remain unassigned. Main flow uses pre-opened deep links, not source-code navigation.

## Golden fixture and product rules

| Field | Exact synthetic scenario from BZ-DEMO §4 |
| --- | --- |
| Insured | Alex Morgan, age 32, valid licence |
| Rental | Denver, Colorado, four days, return to same location |
| Residence | California, United States; distinct from pickup state |
| Vehicle | 2025 Toyota RAV4, compact SUV, declared value USD 31,500 |
| Additional driver | Jordan Lee, named on rental agreement |
| Partner | Summit Rental Systems, API sandbox; partner collects combined rental and coverage consideration |
| Coverages | CDW → recommended RCLI → SLI only with RCLI; optional PAI/PEI |
| Service | Extend return by two days before original expiry |
| Representative API date | September 18, 2026 effective date; the example request has rentalDays = 4 |

All names, partner/transaction identifiers, dates and prices used by fixtures are synthetic. Do not copy workbook/customer IDs or production prices into seeds. Keep technical premium, commercial markup and partner remuneration separate; the meeting's 22–25% range is contextual evidence, not a universal rate.

| Trace ID | Coverage / eligibility rule from BZ-DEMO §5 | Acceptance / source caveat |
| --- | --- | --- |
| BZ-PRD-01 | CDW up to USD 35,000, USD 1,000 deductible, max 30 days, 24-hour increments, extension before expiry | Purpose-built rental manifest/adapter; latest wording/exclusions/LDW treatment require confirmation |
| BZ-PRD-02 | RCLI primary/state minimum by pickup state, purchase before inception, named drivers only | Current eight-state rate/limit table and carrier approval remain inputs |
| BZ-PRD-03 | SLI up to USD 500,000 aggregate, excess, continuous cover, selectable only with RCLI | Enforce dependency in UI/API/bind; current attachment/wording still to confirm |
| BZ-PRD-04 | PAI/PEI configured benefits USD 55,000 accident aggregate, USD 1,000 medical, USD 525 effects with USD 25 deductible | BZ-API says USD 500 effects and splits USD 50,000 renter / USD 5,000 passenger life benefit. Do not silently merge versions; current carrier-approved schedule unresolved |
| BZ-PRD-05 | Age ≥21 and valid licence; decline otherwise | Versioned requiredness, explanation and evidence request |
| BZ-PRD-06 | Rental duration 1–30 days; endorsement rechecks maximum and pre-expiry rule | Boundary tests at 0/1/30/31 days and expiry; no hidden bypass |
| BZ-PRD-07 | Pickup jurisdiction allow/decline/refer | Current carrier-approved state availability required before demo sign-off; meeting-era list cannot establish current eligibility |
| BZ-PRD-08 | Vehicle make/model/trim/class/value allow/decline/refer; curated fallback | Allowed RAV4, configured prohibited make/model, ambiguous high-value trim refers with evidence; current exclusion rules required before sign-off |
| BZ-PRD-09 | Named drivers stored once and reused in certificates/FNOL | No re-keying or conflicting participant records |
| BZ-PRD-10 | Canonical rated snapshot and integrity token; fresh rate before checkout/issue | Return base premium, coverage breakdown, fees/markup, tax placeholders, total, rule version/effective date, warnings/referrals |
| BZ-PRD-11 | Eligible contextual CDW-only liability recommendation; RCLI prerequisite opens SLI | Customer-safe explanation and internal rule reference; no generic upsell or ineligible recommendation |
| BZ-PRD-12 | Surplus tax marked calculation/ownership pending confirmation | No claim that tax calculation, filing or responsibility is already resolved |

BZ-API additionally supplies coverage copy: name/acronym, concise description, values and exclusions; CDW's accident scope and excluded misuse/theft/vandalism/single-car events; RCLI's state-minimum third-party scope; commercial/hire/delivery exclusions; SLI USD 100,000 per person / USD 500,000 total and USD 10,000 excess property figures; optional PAI and combined CDW+RCLI / RCLI+SLI products. These are source-specific content requirements, not an independently confirmed current insurance contract. Exact limits and wording must follow the approved version selected for the demo.

## Original acceptance matrix

IDs and pass conditions below are copied from BZ-DEMO §13. Status for every row is pending implementation and acceptance evidence. Test names in the final column describe intended evidence, not existing tests.

| Source ID | Area | Exact source pass condition | Intended evidence |
| --- | --- | --- | --- |
| P0-01 | DTC/API parity | Identical canonical risk and coverage selection return identical eligibility, rule version and premium. | Compare DTC/HTTP adapter outputs from one canonical service and identical risk/coverage payload. |
| P0-02 | Allowed vehicle | Toyota RAV4 scenario quotes and binds when all other rules pass. | Synthetic eligible RAV4 quote→verified money→bind golden. |
| P0-03 | Vehicle control | Configured prohibited make/model declines; ambiguous trim refers with a reason. | Configured prohibited make/model decline and ambiguous trim referral with named reason. |
| P0-04 | Coverage dependency | SLI cannot be selected or bound without RCLI in UI or API. | UI selection, API validation and bind guard all reject SLI without RCLI. |
| P0-05 | Pricing integrity | Modified/stale client premium cannot bind; checkout/issue uses a fresh canonical rate. | Tamper/stale quote replay fails; current canonical snapshot governs checkout/issue. |
| P0-06 | Payment gate | PENDING/FAILED blocks issue; VERIFIED permits issue; retry is idempotent. | Pending/failed denials, verified success, and duplicate retry assertions. |
| P0-07 | Documents | Selected coverage certificates match fixture data, policy numbers, dates, drivers, limits and transaction version. | Field-by-field certificate fixture comparison and template/transaction metadata. |
| P0-08 | Date change | Two-day extension creates a new endorsement transaction, delta premium and reissued affected certificates. | Four→six day extension with new transaction, expected delta and affected documents. |
| P0-09 | History | Original bound transaction and document versions remain retrievable and unchanged. | Before/after hashes and retrieval of original snapshot and document versions. |
| P0-10 | FNOL | Link is short-lived and prefilled; required evidence and preparer fields are present. | Scoped token expiry, prefill, evidence/preparer and save/resume cases. |
| P0-11 | Import | Dry-run detects 2,571 purchase and 460 endorsement rows, maps both schemas, reports exceptions and exposes no PII. | Controlled source aggregate reconciliation with two mapping schemas; no workbook rows inspected here. |
| P0-12 | Audit | Correlation, actor, rule/template versions and timestamps connect quote through endorsement. | Query persisted correlated audit chain with exact rule/template/release versions. |
| P0-13 | Privacy | No real names, contacts, addresses, policy numbers or payment processor IDs appear in UI, logs or backups. | Synthetic fixture provenance and UI/log/fallback inspection; no source production identifiers. |
| P0-14 | Reset/fallback | Environment resets in <5 minutes; every live call has a pre-recorded or static fallback with the same identifiers. | Timed reset and identifier-consistent PDF/API/report fallback rehearsal. |
| P1-01 | Analytics | Core funnel and coverage events appear with channel attribution across the staged domains. | Recorded event sequence and attribution across staged domains; provider/access boundaries explicit. |
| P1-02 | MCP governance | A config change is previewed, confirmed, validated and sandbox-published with an audit record; no AI bind occurs. | MCP preview/confirm/validate/sandbox publish audit and bind-tool absence/denial. |

### Stop-ship conditions

- Any real customer, partner, policy, payment or contact data appears.
- DTC and API disagree for identical canonical risk without an explained channel term.
- Issue succeeds before verified payment/receivable state or uses a manipulated browser total.
- Certificate dynamic fields differ from the transaction shown.
- Endorsement overwrites the original bound snapshot or fails to create new affected documents.
- Presentation requires claiming mocked settlement or unverified compatibility is live.

P0 readiness also requires a one-command synthetic reset under five minutes, fallback PDF/API/report assets with the same synthetic identifiers, and a DTC golden quote in two minutes or less. P1 strengthens the story; P2 remains discovery work. P0 acceptance has not been reduced because the shared foundation is narrower.

## HTTP/API and channel contract

BZ-DEMO §6 proposes the following Bonzah compatibility façade. These are requested routes, not a claim they already exist. Boundary adapters map to shared canonical product/rating/lifecycle services; the runtime must not branch on the customer name. `X-Partner-Id` from the example is not trusted identity: authenticated server context must authorize the partner/channel/tenant and reject mismatches.

| Trace ID | Proposed operation | Required outcome |
| --- | --- | --- |
| BZ-API-01 | `POST /v1/bonzah/quotes` | Create/rate partner quote; quote ID/token, status, premium, covers, warnings, expiry |
| BZ-API-02 | `POST /v1/bonzah/quotes/{id}/bind` | Confirm insured/drivers/verified payment and issue idempotently |
| BZ-API-03 | `GET /v1/bonzah/policies/{id}` | Current policy with immutable transaction and document links |
| BZ-API-04 | `POST /v1/bonzah/policies/{id}/endorsements` | Date/name-change draft, delta and status; central demo acceptance is date change |
| BZ-API-05 | `POST /v1/bonzah/policies/{id}/fnol-link` | Short-lived scoped prefilled claim link |
| BZ-API-06 | Partner sandbox authentication | Separate sandbox/production credentials and authorized partner/tenant/channel claims |
| BZ-API-07 | Idempotent create/bind | Same key cannot duplicate policy/payment; include failure/retry evidence |
| BZ-API-08 | Correlated timeline | Request → rating → money → issue → webhook; response correlation ID |
| BZ-API-09 | Required events | `quote.updated`, `policy.issued`, `endorsement.issued`, `payment.failed`, `document.available` |
| BZ-API-10 | PII/secret control | No PII in logs/analytics; sanitized console, scoped expiring links, secrets hidden |
| BZ-API-11 | Final compatibility | Current Insillion fields/enums/errors/webhooks must be inspected before drop-in compatibility can be claimed |
| BZ-API-12 | API Documentation source | Product descriptions plus a link to `https://github.com/insillion/bonzah`; repository/API contract not inspected by this extraction |

The representative payload includes programId, channel, effectiveDate; pickup/residence countries/states, rentalDays, driver age/licence, vehicle year/make/model/class/value, and selected coverages. Canonical risk and selection must be identical for DTC/API parity. Matching results by using separate pricing implementations would fail the architecture requirement.

## Money, documents and endorsement

| Trace ID | Required behavior | Acceptance boundary |
| --- | --- | --- |
| BZ-FIN-01 | Gateway-neutral simulated processor; PENDING/FAILED block, PAID/VERIFIED allow only with clear underwriting and valid quote | Verified demo event plus immutable transaction-linked ledger evidence; no live Stripe/ACH claim |
| BZ-FIN-02 | Refund requested/refunded retain policy and update transaction/finance status | Provider result and actor audited; production refund integration remains discovery |
| BZ-FIN-03 | Partner receivable, exposure and next draw | Exposure only from issued/not-remitted transactions, not failed/void; every three days is a configurable proposal; next draw visibly SIMULATED |
| BZ-DOC-01 | Separate certificate per purchased coverage; four supported/demo templates | Dynamic insured/drivers/number/dates/limits/deductible/vehicle/rental fields from bound transaction |
| BZ-DOC-02 | Versioned fixed carrier/producer/wording, licensed or Bonzah-supplied form | Exact ACORD-based material requires template rights/approval before sign-off; do not assume freely reproducible |
| BZ-DOC-03 | Immutable document metadata and safe delivery | Template version, transaction ID, hash, time/actor; download/resend audited; scoped expiring links |
| BZ-END-01 | Change rental dates from bound policy; extend by two days before expiry and recheck max period | Canonical before/after/delta/integrity result |
| BZ-END-02 | Verify direct payment/partner receivable delta before issue | No issuance from unverified state; idempotent retry |
| BZ-END-03 | New endorsement transaction with reason/actor/time and regenerated affected documents | Original bound snapshot/documents immutable/retrievable; distinct reporting event/row |

## FNOL field and action coverage

The form is a content reference, not a generic two-field notice. Implement conditional sections, evidence status, save/resume and a single submission flow. Required flags below are source text observations; final operational validation follows the approved configuration. Do not infer that every exported bullet is a required field.

| Trace ID | Source / fields | Required demo behavior |
| --- | --- | --- |
| BZ-FNOL-01 | Blueprint: policy number, insured, coverage, rental period, contact, language | Short-lived scoped link prefills policy/rental/transaction; bilingual-ready flow |
| BZ-FNOL-02 | Form: renter full name components, mobile, email and confirmation, home address/country | Preserve field shape and email confirmation; no production data fixtures |
| BZ-FNOL-03 | Form: form-start timestamp and accident/loss timestamp, date/time/AM-PM, location, narrative | Source marks timestamps/narrative required; normalize timezone and retain source interpretation |
| BZ-FNOL-04 | Form: witnesses and contacts; other vehicles/drivers/occupants, injury and damage context | Structured or adequate narrative capture; include requested evidence and parties |
| BZ-FNOL-05 | Photos of scene/rental/damage; certificates; repair estimates (three requested); police report | Evidence checklist and secure references; source marks photos required and says police report required for submission |
| BZ-FNOL-06 | Personal auto policy for renter/driver and credit-card agreement where applicable; other information/files | Conditional/optional evidence, not unconditional blocking of unrelated claims |
| BZ-FNOL-07 | Agency name/agreement or reservation/contact; rental contract; vehicle year/make/model/plate state+number | Reuse known policy/rental data; signed contract appears in blueprint checklist |
| BZ-FNOL-08 | Additional driver when different from primary renter: name/address/country/phone/email | Conditional section and participant linkage |
| BZ-FNOL-09 | Preparer when different from renter/driver: name, role, company where applicable, address/phone/email | Declared preparer role retained; source marks declarations and signature required |
| BZ-FNOL-10 | Save for Later, Review Answers, declaration/signature and one submission | Resume without duplicate FNOL submission; visible validation/recovery |
| BZ-FNOL-11 | Outbound event | FNOL/claim ID, policy/transaction IDs, event time, secure evidence references and delivery status |
| BZ-FNOL-12 | Initiator rule conflict | Form permits any accident party; blueprint cites renter-only public-site language. Unresolved before production content; demo must show preparer role explicitly |
| BZ-FNOL-13 | Form says up to 30 days after accident/incident; emergency 911 copy and claims email | Source content, not independently verified legal/coverage advice. Carrier/claims owner must confirm enforcement and final wording |

## Data, reporting, analytics and configuration

| Trace ID | Requested scope | Required proof / limitation |
| --- | --- | --- |
| BZ-DATA-01 | Purchase and Endorsed tabs mapped to one canonical policy-transaction model | Quote/policy/external IDs, explicit coverage/price mapping, period/transaction time, distribution entities, payment/receivable events, endorsement reason; protected source/tab/row lineage |
| BZ-DATA-02 | Dry-run fingerprint, two schemas, row counts, mapping version; mapped/warning/error/duplicate totals | Synthetic display rows only; no names/contact/address/policy/processor IDs from workbook |
| BZ-DATA-03 | Source-reported 2,571 purchase + 460 endorsement counts | P0-11 requires actual controlled aggregate reconciliation. These counts have not been independently verified here; fabricated synthetic totals cannot be presented as source reconciliation |
| BZ-DATA-04 | Premium totals by transaction and coverage; explicit approval before commit; importer/source/mapping/result hashes | Reversible batch and exception export. This extraction did not read workbook or execute import |
| BZ-DATA-05 | Unknown distribution values quarantined; original dates retained; provider ID alone is not settlement proof | No implicit entity duplication or unverified settled status |
| BZ-RPT-01 | Operational transaction ledger | Purchase/endorsement, coverage/premium/partner/payment/effective/processed dates |
| BZ-RPT-02 | Partner receivable report | Issued/paid/overdue/refunded by partner/cycle; concept until collection/settlement adapter agreed |
| BZ-RPT-03 | Coverage/channel dashboard and immutable monthly export | Quote-to-bind/attachment/premium/change mix; export validation/version/hash/approval |
| BZ-RPT-04 | Carrier/TPA feed | Separately scoped payload, delivery acknowledgement and failure handling |
| BZ-AN-01 | quote_started; eligibility_decided; coverage_viewed/selected; checkout_started/completed; policy_issued/endorsement_issued | Channel/source/session/partner and appropriate rule/coverage/payment-mode/transaction fields; no raw PII/payment data; cross-domain continuity is P1 |
| BZ-CFG-01 | Draft change/scenario, preview/confirm, validate, sandbox publish, audit actor | P1 MCP demonstration; operators may prepare/rate/save/communicate, binding stays outside AI tools |

## Open decisions and sign-off caveats

| ID | Outstanding input | Source timing / impact |
| --- | --- | --- |
| BZ-OPEN-01 | Current state availability and vehicle exclusions | Before demo sign-off; representative rules cannot be presented as current carrier approval |
| BZ-OPEN-02 | Certificate templates/form rights and carrier/legal approval | Before demo sign-off; exact coverage documents cannot be claimed approved from prose alone |
| BZ-OPEN-03 | Approved product/rate/limit tables and selected benefit schedule | Representative rules for demo; current approved rates/authority before production build; reconcile PAI source discrepancy |
| BZ-OPEN-04 | Current Insillion docs/Postman, representative errors/webhooks and integration | Before technical validation; final drop-in compatibility unverified. Linked repository is a discovery lead |
| BZ-OPEN-05 | Stripe account/payment ownership, ACH/autodraw/refund and custody/timing | Discovery/P2; simulated settlement remains labeled |
| BZ-OPEN-06 | Surplus tax calculation/collection/filing/reporting responsibility | Discovery; no claims of resolved tax handling |
| BZ-OPEN-07 | Claims initiator rule and carrier/TPA schema/credentials/acknowledgement | Initiator before production content; carrier integration discovery |
| BZ-OPEN-08 | Growth GTM/domain access and funnel definitions | Optional for demo/P1 analytics |
| BZ-OPEN-09 | Controlled workbook reconciliation, legacy access beyond workbook | P0 aggregate import proof still requires controlled evidence; direct legacy extraction remains discovery |
| BZ-OPEN-10 | Named demo DRI, scene owners, exact invitation timezone and template/simulation boundary acceptance | Assign before rehearsal; source specifies Central but invitation not checked |

The blueprint's T−72-hour gate is September 7 at 17:30 Jerusalem under the US Central assumption: freeze scenario/rules, seed, documents/responses/aggregates and scene owners. T−24 is September 9 at 17:30: full 39-minute rehearsal on presentation hardware. This complements the milestone plan's September 9 integrated candidate build/configuration freeze. T−2 is September 10 at 15:30 for reset/smoke/fallbacks; T−15 is 17:15 for screen share/start tab/roles/recording decision. These are source-derived checkpoints, not scheduled calendar events.

The UE folder was initially empty and was populated later on September 6. The newly received [UE property demo pack](ue-scope-matrix.md) and [VUW.ai POC/SOW/workbook](vuw-scope-matrix.md) now have separate source matrices. Source acquisition is closed; open inputs and implementation/acceptance remain tracked separately; Uriel reaffirmed September 11 for the complete VUW POC. Neither workstream reduces Bonzah's P0 scope.
