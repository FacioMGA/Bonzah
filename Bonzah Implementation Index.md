# Bonzah implementation index

Prepared 8 September 2026 and re-verified 9 September 2026. This is the evidence index Uriel asked for on 6 September: what exists, where it lives, and — stated plainly — which parts are working, which are mocked, and which are assumptions still needing validation.

Nothing in this document is a statement of approved insurance coverage, carrier-accepted rates, or production readiness. Every rate, limit and factor described below is synthetic demonstration material unless explicitly marked otherwise.

## 1. Preserved reference points

| What | Where | State |
| --- | --- | --- |
| Frozen demo build | `abbeygate`, branch `codex/bonzah-demo-reference`, tag `bonzah-demo-reference-2026-09` | Preserved. Commit `88e33ce2` added the Insillion provider boundary and committed 33 previously-uncommitted files. |
| Kernel intake | `facio-kernel`, branch `codex/bonzah-kernel-intake` | Commits `4f364ba`, `8a96b25`, `f3792f1`, `481cecc` and `9ebc24e` cover product registration, configuration corrections, pre-quote discovery, rental invites and certificate generation. |
| Structured requirements intake | `facio-kernel`, `tenant-packages/source-requirements/bonzah.json` | 14 mandatory P0 requirements plus 8 unresolved capability gaps, each with expected outcome, source reference, dependencies and an explicit source boundary. |

Neither branch is published to the hosted runtime yet. Local commits and verification are evidence of implementation, not evidence that `platform.facio.io` is serving the new rental runtime.

## 2. Source material

Held in `Learnings 02` and the shared Drive folder.

| Source | What it establishes | What it does not |
| --- | --- | --- |
| `Bonzah_Facio_Demo_Specification_v1.0.docx` | Run-of-show, P0/P1/P2 backlog, acceptance criteria, channel strategy | It is a Facio demo blueprint, not a vendor API contract or a customer approval |
| `API Documentation Requirments.docx` | Product and channel overview, coverage descriptions, bundles | Insufficient endpoint, auth, error and webhook schemas to certify compatibility |
| `July Insillion.xlsx` | 2,571 purchase rows, 460 endorsement rows; channel and payment mix | No production row may be used as a demo fixture |
| `Policy-{cdw,rcli,sli,pai}-P000000143499.pdf` | Certificate layout and the authoritative limit schedule | Sample certificates, not template rights |
| `bonzah-{cdw,rcli,sli,pai-pei}-flyer.pdf` | Coverage scope, exclusions, state variation | Marketing wording, not policy wording |
| `Bonzah Insurance Initial Claim Form (FNOL).docx` | Actual form sections, evidence list, save-for-later behaviour | Not an implemented flow |
| `MNDA Bonzah.pdf` | Confidential evaluation context | No product requirement |

## 3. What genuinely works today

**In the abbeygate demo branch.** The existing Summit partner journey now asks the kernel for coverage eligibility before vehicle selection, uses kernel-returned prices, creates and retains a public rental quote, and stops without payment or binding. The public Bonzah landing page hands off to the kernel's canonical rental entry route. A same-origin serverless proxy forwards only public rental requests with the Bonzah tenant slug; neither frontend contains an admin key, local rate table or eligibility rules. The older local simulated implementation remains preserved in commit `88e33ce2` for reference, not as the target demo behaviour.

**In the kernel.** The rental product is registered as a first-class product: manifest, contract, profile, compiled rating engine, compiled eligibility engine, golden fixtures, claims contract, product adapter, validation profile, quote wizard and public surface bootstrap. Its questionnaire has three sections — rental details, vehicle, protection. Its canonical public entry path is `/quote/rental-car/new`; `/quote/rental/new` redirects to it while preserving query parameters. Public APIs derive generically from the `rental` session slug.

The intake configuration now passes its own validation with no invalid, incomplete or inconsistent gaps (`tests/bonzah-configuration.test.ts`, 3 tests passing).

The kernel now also has a pre-quote coverage-discovery route backed by the same rental calculator used for quoting. Focused calculator, discovery and HTTP tests pass. This closes the code-side discovery gap; it has not yet been exercised against the hosted Bonzah workspace.

Certificate generation is implemented locally in the rental wording engine. Four declared document types map to one coverage-aware Handlebars template, a dedicated worker handler renders them through the shared PDF/storage pipeline, and the view model reads the retained quote transaction rather than demo-page state. Focused view-model tests and the headless-browser render smoke test pass; the inspected specimen is a legible single-page A4 PDF. The API/worker container builds now copy the rental template. This is not yet proof of a hosted policy document pack because the Bonzah programme's immutable document-source mapping has not been configured and an end-to-end bind has not run.

## 4. What is mocked or simulated

Payment is simulated everywhere. In the frozen build the browser sends its own verified flag, which the readiness review correctly records as a P0 defect — verification is not server-owned. Bind produces a `SIMULATED_CONFIRMED` confirmation identifier, which is not an issued policy.

Quotes in the frozen build are held in process memory and reset when the service restarts. The service runs against a local development database with queue workers disabled and no schema migration; it is not a configured production tenant.

All rating factors are static versioned configuration tables (`demoConfig.ts`, dataset version `bonzah-us-state-season-2026.1`). Nothing calls the internet at quote time. Base rates exist for three states only — CA, CO, NY — with everything else falling back or referring.

## 5. What still does not work end to end

Hosted certificates. The generator exists and renders locally, but no certificate has yet been generated from a bound policy in the hosted Bonzah workspace. The programme must select the four new document sources before the issued pack can use them. The current generic programme schema declares a static set of required issued document types; generating only the certificates for an arbitrary coverage subset therefore needs either a demo programme fixed to the all-four-coverage path or a reviewed conditional-document contract.

Hosted pre-quote discovery. The endpoint and Summit proxy integration exist and their focused tests pass, but the hosted runtime is not yet serving the new rental code, so the public route cannot yet be proven against the live workspace.

Rental wizard invites. RENTAL is present in the operator allowlist, the URL derives the `rental-search` first step, and canonical US/RENTAL tenant and jurisdiction support is now implemented. Focused invite, tenant-time, configuration, discovery and route-alias tests pass locally.

Hosted programme configuration. The Bonzah MCP connection is live and read/write permissions are confirmed. The existing programme exposes the platform's configurable `COMMERCIAL` adapter, but already retains rental-specific questions, coverages and eligibility in definition version 2. On 9 September MCP created and read back a new draft rating-model record; it remains unpublished and is not linked to the definition. Attempts to save the completed sandbox definition correctly failed without changing version 2: an automated definition requires a published rating model, while rating publication requires an eligible binder product authority and the workspace has none. The supplied RCLI certificate was also verified as a 25,000 per-person / 50,000 aggregate / 25,000 property-damage example, with the flyer making actual statutory jurisdiction limits controlling. No product-type recreation is assumed solely from the editor label, and no programme or rating publication has been performed.

The date-change endorsement, FNOL, and the import/reporting reconciliation. The 94.6% of real servicing volume that endorsements represent has no implementation.

## 6. Assumptions still needing validation

**Pricing philosophy.** The engine prices environment and vehicle, and treats the renter as an eligibility gate rather than a priced risk. Driving history, prior claims and credit are deliberately excluded. This is a design decision, not a confirmed Bonzah or carrier practice, and it needs Bonzah to confirm whether their carrier already prices this way or whether this is a new approach requiring rate filing.

**Factor derivation.** Road-risk uses a fatal-crash severity proxy, which may understate risk in states with high minor-collision rates. Theft exposure falls back to a class average when the exact model is absent, disclosed on the quote. None of the factor values are actuarially validated or carrier-approved.

**Coverage limits.** Taken as authoritative from the supplied certificates and specification: CDW $35,000 limit with $1,000 deductible; SLI $500,000 aggregate, $100,000 per person, $10,000 property damage; PAI/PEI $55,000 accident aggregate, $1,000 emergency medical, $525 effects subject to $25 deductible. The kernel fixture already carries these values.

**One unresolved source conflict.** The API overview states personal effects at $500 while the certificate states $525 subject to a $25 deductible, and the flyer mentions both. This goes to Bonzah as a question and has not been resolved by assumption.

**One modelling decision taken to satisfy kernel rules.** SLI was declared as a policy-term aggregate while sitting excess of the per-occurrence RCLI layer. The kernel forbids mixing bases across an excess layer, so SLI is now per-occurrence to match its underlying cover. The limit value is unchanged. Whether per-occurrence is the correct structural expression of Bonzah's $500,000 aggregate needs confirmation.

## 7. Open questions for Bonzah

Carried from the API contract review; none block the kernel demo, all block a production integration.

Whether the accepted licence key is `licence_no` or `license_no`. Whether quote timestamps are required or plain `MM/DD/YYYY` is accepted. Whether `drivers_license_state` expects the full master value or an abbreviation. Whether vehicle and licence fields are contractually required despite being optional in the endpoint table. Where to send the business-required fields that have no published API keys. Whether the documented endorsement endpoints are enabled for this partner account, given the requirements README says duration changes and cancellation are unavailable. The production base URL, credentials, and a complete error-code catalogue with retry and idempotency rules.

## 8. Known environment and interface issues

The kernel test suite reports 108 failures on this machine, all with "The required exact-money Rust module is missing, invalid or incompatible". This is an unbuilt Rust financial core in the local environment, not a code defect; `npm run build:rust` is a prerequisite for a meaningful full-suite run.

Uriel's 8 September route `/quote/rental-car/new` is now canonical. The earlier `/quote/rental/new` path remains as a query-preserving compatibility redirect.

The MCP Feedback repair command created/repaired the workspace project connection, but the subsequent status read still returns an internal service error. The exposed MCP surface has no general feedback-submission command, so this platform defect must be reported externally until the service is restored.
