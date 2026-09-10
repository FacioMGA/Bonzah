# Bonzah demo readiness review

Reviewed 6 September 2026 against the 13 files in Learnings 02 and the current local implementation. The supplied blueprint schedules the presentation for 10 September. This review treats that blueprint as the recorded plan, not as independent proof that Brandon personally approved every proposed scene. The original meeting transcript and email thread cited by the blueprint are not separate files in this folder.

## 9 September implementation update

The local kernel now contains the pre-quote coverage-discovery endpoint and a real rental document-pack implementation. The latter declares one certificate type per coverage, renders from retained transaction data through the shared PDF/storage pipeline, and has passed view-model, template-render and backend type checks. A generated specimen was visually inspected as a single-page A4 document. The existing Summit journey calls discovery before vehicle selection and retains a kernel public-session quote without payment or bind. The Bonzah entry hands off to `/quote/rental-car/new`. The hosted tenant is not yet configured, so none of these additions has been proven in a hosted end-to-end journey.

Send-to-customer is now supported by the local runtime: RENTAL is allowed, US tenant/jurisdiction support exists, and the deep link derives the `rental-search` first step. The focused acceptance test passes.

The Codex MCP server is registered and its tools now load successfully. A live ping confirms the Bonzah demo workspace and configuration/programme permissions. The existing definition already contains rental-specific source configuration under the configurable `COMMERCIAL` adapter, so that label alone is not treated as proof that the programme must be recreated. MCP successfully created and read back a draft rating model. The platform would not link or save the automated definition because the model is not published; publishing the model requires an eligible binder product authority, and none exists in this workspace. The MCP surface can create a binder shell but exposes no per-product authority command. No programme or rating publication has occurred. The Feedback repair command reports a connected project, but status still fails with an internal service error.

## Recommended demo structure

Present one connected demonstration with two customer entry points and a shared operational continuation:

1. Bonzah direct customer purchase: familiar pickup, residence and rental dates, then driver/vehicle details, coverage and checkout.
2. Summit Rentals embedded purchase plus a brief API console/Postman view: demonstrate the same rating and eligibility logic through a partner channel.
3. Shared policy workspace: certificates, a two-day rental extension, revised documents, FNOL and reporting using linked identifiers.

The blueprint explicitly prioritises DTC and API, treats co-branding as a configuration variant, and says to preserve API parity, certificates and the date-change scene if time slips. It does not require a separate full marketing-site rebuild, standalone API application, OTA demo or fleet-insurance product. Preserve the current Summit build as the embedded chapter. Build only the Bonzah purchase journey needed to prove DTC continuity.

## What runs today

Frontend: http://localhost:5174/summit-rentals

API: http://localhost:3000/api/v1/bonzah

The frontend uses port 5174 because another Facio checkout occupies 5173. Port 8080 is Adminer, not this API. The API was launched against the existing local development PostgreSQL and Redis with the existing synthetic configuration sandbox tenant and queue workers disabled. This is not a configured production Bonzah tenant. No schema push or migration was run.

The live browser journey completed through SIMULATED_CONFIRMED. For a four-day RAV4 rental with all four coverages, the insurance total was $196, rental charges were $276, and the displayed combined total was $472. The partner API retrieved the browser's exact quote BQ-DEMO-1016 at $196 with rule version bonzah-rental-demo@1.0.0.

Focused HTTP checks passed: WEB/API price parity; repeated create returns the same quote; altered total rejected with 409; pending payment rejected with 400; SLI without RCLI rejected with 422; repeated simulated bind returns the same confirmation. Four-day CDW comparison returned Corolla $64, RAV4 $88 and Tesla $121.44; Porsche declined and ambiguous luxury trim referred.

These checks establish the narrow demo's behaviour. They do not establish actual payment verification, policy issuance, current carrier pricing or legacy compatibility. The current service holds synthetic quotes and confirmations in process memory and resets when restarted.

## Gap checklist

| Priority | Area | Current evidence | Work remaining |
| --- | --- | --- | --- |
| P0 | Bonzah DTC | Bonzah start page hands off to the kernel's canonical `/quote/rental-car/new` journey with trip, residence and driver-age context | Deploy the kernel changes and prove the hosted route against the Bonzah workspace. |
| P0 | Product terms | Four coverage cards and SLI dependency work | Align limits, deductibles, wording and exclusions with the agreed demo schedule. Current CDW, SLI and PAI/PEI terms diverge from the supplied specification. |
| P0 | Risk and customer continuity | Quote stores driver age/licence-valid flag and rental/vehicle data | Persist renter identity, DOB, licence details and named additional drivers with the transaction. Current checkout details are local UI state and are not sent in the bind request. Derive age consistently from DOB. |
| P0 | Eligibility | Age, licence, duration and selected vehicle branches exist | Add governed pickup-state availability and the intended vehicle/use rules. Current arbitrary two-letter states fall through to default rates; customer-entered location still rates as Colorado. International residence is unsupported. |
| P0 | Policy and audit | Summit creates a public rental session and shows both its public token and workspace policy ID; it stops before payment/bind | Deploy, configure an active binder, and prove the retained record in Back Office. |
| P0 | Payment gate | HTTP schema only accepts SIMULATED_VERIFIED | Demonstrate pending/failed/verified attempt states and server-owned verification with transaction linkage. Current browser sends the verified simulation flag itself. |
| P0 | Certificates | Local generator and single-page specimen pass focused checks | Configure immutable programme document sources, bind a hosted policy, and verify/download each selected coverage certificate from the policy record. Resolve the static-required-types limitation before supporting arbitrary coverage subsets. |
| P0 | Date extension | No rental endorsement route or flow | Extend four days to six before expiry; calculate delta; record payment/receivable; create new transaction and certificates while preserving originals. |
| P0 | FNOL | Rental claims contract has empty incident/field lists | Implement prefilled, short-lived link; accident/rental/driver/preparer sections; evidence checklist; save/resume and outbound event. |
| P0 | API lifecycle | Quote create/retrieve and simulated bind; Postman collection | Add policy retrieval, endorsement and FNOL-link routes; document links and event/webhook timeline. Existing Insillion compatibility is not established. |
| P0 | Import/reporting | Workbook aggregate facts are available; no Bonzah importer demonstrated | Detect both schemas, validate/map rows, retain lineage, show aggregate reconciliation and exceptions using synthetic examples, and connect purchase/endorsement reporting. |
| P0 | Reset, rehearsal and disclosure | Synthetic labels and focused local verification are present | Complete hosted configuration/deployment, capture live evidence, and rehearse both entry points plus Back Office. |
| P1 | Money visibility | No partner receivable scene | Show payer, amount owed, exposure, next draw and reconciliation as a clearly simulated concept. Separate carrier premium, markup and partner remuneration. |
| P1 | Cross-sell and analytics | Manual coverage selection/dependency | Add contextual CDW-to-RCLI explanation and channel-attributed funnel events. CDW is currently mandatory in the UI, which limits demonstrating other combinations. |
| P1 | Governed configuration | Rental rates in a TypeScript configuration constant | Show a controlled draft/test/validate/publish flow and audit if time allows. A version string alone does not prove no-code configuration. |

P0/P1 labels follow the supplied blueprint where possible. The payment scene appears in the main run-of-show and acceptance tests even though its partner ledger mock is P1 in the backlog; confirm the rehearsal cut rather than silently omitting it.

## Coverage discrepancies requiring resolution

These are comparisons with supplied materials, not statements of currently approved insurance coverage.

| Item | Current demo | Supplied specification and samples |
| --- | --- | --- |
| CDW | $35,000 limit; $500 deductible; broad short exclusion text | $35,000 limit; $1,000 deductible; vehicle-against-vehicle scope and material exclusions described in source materials |
| SLI | $1,000,000 limit | Specification/sample use $500,000 aggregate, $100,000 per-person bodily injury and $10,000 property damage; flyer also describes state variation |
| PAI/PEI | $10,000 / $1,000 limits | Specification/sample describe $55,000 accident aggregate, $1,000 emergency medical, and $525 effects subject to $25 deductible |
| RCLI | State minimum plus rental-agreement-primary-cover wording | Supplied wording concerns primary/state-minimum protection; clarify approved customer wording and state-specific schedule |

The source pack itself needs reconciliation: the API overview summarises personal effects at $500, while the certificate describes $525 subject to $25 deductible; the flyer mentions both. Vehicle rules and PAI applicability also need an agreed authority. Do not resolve those inconsistencies by inventing a new schedule. The blueprint requests current eligibility confirmation and certificate-template permission before demo sign-off.

## Why the operational continuation matters

The workbook has 2,571 purchase rows across 50 columns and 460 endorsement rows across 52 columns. Purchases include 1,977 B2C rows (76.9%), 296 API rows (11.5%) and 283 Portal rows (11.0%), plus small co-brand channels. These figures support leading with the direct customer journey and then showing embedded distribution.

Of 460 endorsements, 435 are date changes (94.6%), six are name changes and 19 are cancellations. Portal accounts for 296 endorsements (64.3%). This is strong evidence for a visible servicing workspace and rental extension. It is not a per-policy endorsement probability, because these are transaction-row counts.

Purchases use Stripe in 2,220 rows and Deposit in 351; endorsements use Stripe in 272 and Deposit in 188. The demo should explain both direct collection and partner-account semantics. It need not move real money.

## Source review inventory

| Source in Learnings 02 | Contribution to this review |
| --- | --- |
| Bonzah_Facio_Demo_Specification_v1.0.docx | Primary scope: run-of-show, P0/P1/P2 backlog, acceptance criteria, channel strategy and outstanding decisions. It is a Facio demo blueprint, not a vendor API contract. |
| API Documentation Requirments.docx | Product/channel overview, coverage descriptions and bundles; references the Insillion repository. Does not contain sufficient endpoint/auth/error/webhook schemas to certify compatibility. |
| July Insillion.xlsx | Both complete sheets inspected for structure and aggregate counts. No production rows should be used as demo fixtures. |
| Policy-cdw-P000000143499.pdf | Certificate layout, $35,000/$1,000 example, period/driver and extension conditions. |
| Policy-rcli-P000000143499.pdf | State-specific certificate fields and named-driver/period conditions. |
| Policy-sli-P000000143499.pdf | Sample limits, RCLI dependency and continuous-cover conditions. |
| Policy-pai-P000000143499.pdf | Benefit components and effects deductible; customer-facing certificate structure. |
| bonzah-cdw-flyer.pdf | Collision scope, exclusions, vehicle restrictions and claim evidence requirements. |
| bonzah-rcli-flyer.pdf | Primary liability context, jurisdiction limits, driver and rental-period conditions. |
| bonzah-sli-flyer.pdf | Excess attachment, state variation and RCLI prerequisite. |
| bonzah-pai-pei-flyer.pdf | Benefit breakdown, effects limitations and inconsistencies to resolve. |
| Bonzah Insurance Initial Claim Form (FNOL).docx | Actual form sections, evidence, additional driver/preparer information and save-for-later behaviour. |
| MNDA Bonzah.pdf | Confidential evaluation context. It adds no product-demo screen requirement. Keep presentation assets synthetic and source material private. |

## Suggested build order and scope boundary

First align product terms, canonical customer/driver data and the demo scenario. Then complete the policy-to-certificate-to-date-extension chain. Add the focused Bonzah DTC entry and show API parity against the same service. Complete FNOL and the aggregate import/reporting scene, then rehearse and capture fallbacks. Add the receivable, analytics and MCP flourishes as capacity allows.

A full corporate website replica, separate co-brand/OTA/fleet demos, live Stripe/ACH/autodraw, carrier/TPA connectivity, direct legacy database migration and guaranteed Insillion drop-in compatibility are not prerequisites for the controlled demo described in the blueprint. Production scope requires the actual API contract, approved rating/eligibility schedules, template rights, payment ownership and integration contracts.

The main customer promise is continuity: one risk, one rating authority, connected quote/policy/transaction identities and reusable data across purchase, documents and servicing. Summit is a useful first chapter, but the current implementation does not yet satisfy the full blueprint.
