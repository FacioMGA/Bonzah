# Bonzah on Kernel — execution plan

Updated 9 September 2026, the day before the demo. Reflects work completed in this session and by Codex, verified against the repositories rather than reported.

## 1. What the two emails ask for

**6 September — "turning your demo work into a kernel tenant".** Preserve the abbeygate demo at a known commit; add an implementation index to the Bonzah folder; separate working functionality from mocks and assumptions; map each scenario to supported configuration, defect, missing capability or customer question. From then on, new implementation goes to the kernel: configure the tenant through MCP/API, inspect in Studio, activate a sandbox release, run the demo against that tenant. Contained defect fixes and acceptance tests are welcome as reviewed PRs; new capability boundaries get discussed with the maintainer first.

**8 September — "This week: Bonzah onboarding and SIXT rental-car demos on Kernel".** Target **10 September**. Two journeys in one Bonzah workspace (`fd24a745-736e-4e70-9ffc-3c75438246e0`).

Journey A, Bonzah self-onboarding: a Bonzah static site whose entry page passes rental and channel parameters into the workspace-scoped rental-car journey, finishing at a retained quote and then a permitted bound policy visible in Policies with a downloadable document pack. Insured, rental dates, coverages, limits, premium and configuration version must agree across wizard, policy and documents. Invalid coverage combinations and stale prices must fail clearly.

Journey B, SIXT-style distribution: a second entry point that makes a coverage-discovery request into the tenant's rental-car service, renders the eligible coverages returned, then creates and retains a quote. Binding not required.

Also required: connect to the workspace MCP endpoint over OAuth with four scopes; configure product, questions, coverages, rates, eligibility, distribution and documents; save, read back, confirm in the UI, publish. Keep an evidence checklist in the Bonzah folder. No administrative MCP key in the static site; no rates or eligibility in frontend code.

## 2. Status — verified against the repositories

### Done and verified

**Both repos preserved.** abbeygate `88e33ce2` committed 33 files (Insillion provider boundary); kernel `4f364ba` committed 36 files (rental product registration). Two stale `.git/index.lock` files were blocking all git operations and have been cleared. Neither branch has been pushed; neither has an upstream, and the workspace has no GitHub credentials, so no remote comparison has been made.

**Implementation index written** to the Bonzah folder — the artefact owed since 6 September.

**Four real configuration defects fixed** (kernel `8a96b25`). `tests/bonzah-configuration.test.ts` was calling `validateConfiguration` with one argument instead of three and asserting `.length` on a report object, so it could never have passed. Behind it: uppercase `pickup-state` option ids the schema rejects; SLI declaring a policy-term aggregate while sitting excess of the per-occurrence RCLI layer; SLI and PAI/PEI each asserting a second aggregate on an aggregate limit basis; and a `referred` stage with no path to a terminal stage. Blocking gaps went 18 → 0; the 14 remaining are deliberate "capability not yet wired" markers. Three tests pass.

**Pre-quote coverage discovery built** (kernel `f3792f1`). `discoverRentalCoverages()` plus `POST /api/public/{slug}/coverages`. It never throws on an ineligible renter, because that is an answer the caller must render; the vehicle is optional, so a partner can ask what is available before a car is chosen. It delegates to `calculateRentalRating` rather than re-deriving anything, so discovery cannot contradict the quote that follows — asserted by test. Verified over real HTTP: six checks including price parity, vehicle-less discovery, ineligible-as-200, malformed-as-400 and no quote identity in the response.

**Rental wizard invites unblocked** (kernel `481cecc`). `sendWizardLink` refused RENTAL with `UNSUPPORTED_PRODUCT`. Fixed, plus a second defect found alongside: the invite hardcoded `step=policy-holder` for every product, so rental customers would have been deep-linked to a step their journey does not begin on. The step now comes from the product's own intake definition.

**PAI/PEI aligned to the certificate schedule** — personal effects $525 subject to a $25 deductible.

### Done by Codex, verified present but not yet run against the platform

**Certificate generation** (kernel `9ebc24e`). A real implementation: document pack contract, view models, a 250-line HTML certificate template, `generateRentalDocPack` reusing the kernel's generic doc-pack generator, a `DOC.GENERATE_RENTAL_DOC_PACK` worker handler registered in the built-in handlers, and manifest document types for all four coverages. The wording engine no longer returns an empty array.

Verified by rendering the template directly: it produces a 7.4KB document carrying the insured name, policy number, coverage limit, deductible and configuration version, marked "DEMO SPECIMEN" and stating it is not an issued insurance contract, with no ACORD or carrier claim and no unresolved template placeholders.

**Public intake completed** (kernel `4369f72`). US jurisdiction product configuration, tenant time handling, and the public route. Note the route decision below.

**Both journeys rewired to the kernel** (abbeygate `67bbeb68`). `kernelHandoff.ts` builds the entry URL to `platform.facio.io/quote/rental-car/new` carrying the trip parameters plus workspace and source. `kernelRentalProxy.ts` (191 lines) is a server-side proxy so the partner page reaches the tenant without any key in the browser — it authenticates with `X-Tenant-Slug` only, and calls the `/api/public/rental/coverages` endpoint built above plus the public session endpoints for quote creation and retrieval. `BonzahDirectPage` is reduced to its start page and hand-off; `SummitRentalDemoPage` is rewired.

### Not done

**The MCP connection and tenant configuration (Phases 1 and 3).** Nothing in either repository configures the actual Bonzah tenant, and there is no evidence of an MCP session. This remains the gating item.

**Any execution against platform.facio.io.** Every piece above is code that has never spoken to the real platform. Specifically unverified: whether the tenant slug Codex hardcoded (`bonzah-demo-fd24a745736e4e709ffc3c75438246e0`) is the real one; whether `/api/public/rental/session` behaves as the proxy assumes; whether the rental product is published in the tenant; whether a certificate is actually produced at bind, which needs the database and the worker, not just the generator.

**Mail configuration** for send-to-customer. The code path works; whether the tenant can actually send has not been checked.

**Evidence pack and rehearsal (Phase 7).**

## 3. Decisions and conflicts

**a. Route naming — decision reversed, and correctly.** The plan previously kept `/quote/rental/new` as canonical. Codex made `/quote/rental-car/new` canonical, matching Uriel's email exactly, with `/quote/rental/new` redirecting and preserving query parameters. That is the better call: it matches what Uriel asked for without breaking the existing slug, and a test covers the parameter-preserving redirect. The plan now follows Codex here.

**b. Coverage limits.** Certificates and specification are authoritative: CDW $35,000 limit with $1,000 deductible; SLI $500,000 aggregate, $100,000 per person, $10,000 property damage; PAI/PEI $55,000 accident aggregate, $1,000 emergency medical, $525 effects subject to $25 deductible.

**c. One unresolved source conflict.** The API overview states personal effects at $500 while the certificate states $525 less a $25 deductible. This goes to Bonzah as a question rather than being resolved by assumption.

**d. One modelling decision taken to satisfy kernel rules.** SLI is now per-occurrence to match its underlying RCLI layer, because the kernel forbids mixing bases across an excess layer. The limit value is unchanged. Whether per-occurrence correctly expresses Bonzah's $500,000 aggregate needs confirmation.

**e. No written reply to Uriel.** Decided. Both blockers he named were closed by us instead, with no advance notice, so the first he sees of any of it is the demo.

## 4. Journey design

Two doors into one questionnaire, which lives on platform.facio.io. Staff door: create-new-policy inside the Bonzah workspace, enter the start-page values, continue into the questionnaire, and send it to the customer to finish. Customer door: the Bonzah start page, then straight into the same questionnaire.

The start page passes pickup state, residence state, rental dates and driver age as query parameters. The questionnaire's first section is shown pre-filled rather than skipped. Parameters stop at that handover; the step indicator stays visible throughout.

Payment runs on the platform after the questionnaire, in simulated mode, because payment status is an authoritative kernel result rather than something a page asserts — the readiness review records the browser asserting its own verified flag as a P0 defect.

Certificates appear in two places: download links on the customer's confirmation screen, and the policy record in Policies. Both the payment and the certificates are labelled as simulated.

## 5. What remains, in order

**1. Connect MCP and verify read-only.** Add the workspace endpoint over Streamable HTTP with OAuth, selecting all four scopes — `configuration.read`, `configuration.draft`, `programs.view`, `programs.edit`; the last two are off by default. List tools, ping, read the configuration schema without changing anything, confirm the workspace is Bonzah. This has to be done by Amit: there is no network to platform.facio.io from either the Cowork VM or the cloud container, no `codex` CLI installed, and the consent needs his own Google sign-in.

**2. Configure the tenant through MCP.** Questions, coverages at the certificate limits, rates, eligibility including the SLI-requires-RCLI dependency and the age and licence gates, distribution, and the document definitions the certificate generator expects. Save, read back, confirm in Studio, publish. Then change one value and show the tenant's behaviour change — that is the evidence, and it is the moment worth recording.

**3. Confirm the tenant slug.** The proxy and the hand-off URL both hardcode a guessed slug. If the real workspace slug differs, both journeys fail at the first call. This is a five-minute check that prevents the most likely demo failure.

**4. Run both journeys end to end against the tenant.** SIXT first: discovery returns real coverages from the tenant, then a retained quote. Then Bonzah: start page, questionnaire, simulated payment, bound policy in Policies, certificates downloadable. Check the two negative cases explicitly — an invalid coverage combination and a stale price must fail clearly.

**5. Prove a certificate is actually generated at bind**, not merely that the generator exists. This needs the database and the worker running, and is the single largest gap between "built" and "works".

**6. Check tenant mail**, then prove the staff door: create a policy in the workspace, land in the questionnaire, send it to the customer. If mail is not configured, show the generated resume link on screen and label the delivery as skipped.

**7. Assemble the evidence pack and rehearse.** Website links, sample requests and responses, workspace, programme and version identifiers, quote and policy IDs, document links, and a recording of each journey. Mark every failed, missing or simulated step.

## 6. Risks for tomorrow

**Nothing has touched the real platform.** This is now the dominant risk and it has grown, not shrunk, as more code landed. A large, coherent, well-tested body of work exists that has never made a single successful call to platform.facio.io. The first end-to-end run will surface integration problems — a wrong slug, an endpoint shape that differs, an unpublished product — and there is one day to absorb them. Getting one call to succeed against the real tenant is worth more today than any further code.

**The test suites cannot be run in the Cowork workspace.** `npm test` at the kernel root shows 109 failures, all from the unbuilt Rust exact-money module; the failure set is identical at Codex's head and at the previous commit, so nothing regressed, but it also means the suite proves little here. Worse, after the recent install the workspace carries macOS binaries: vitest fails on the rollup native module and tsx fails on esbuild, so none of the new tests — certificate rendering, view models, the router alias, the kernel hand-off, coverage discovery — have been executed. They should be run on Amit's own machine before the demo, and `npm run build:rust` first.

**Fallbacks.** The tagged abbeygate build (`bonzah-demo-reference-2026-09`) still runs the proven local journey and remains the safety net for any chapter that will not run against the tenant. Decide the cut order tonight rather than in the room: if something has to go, the SIXT quote chapter is the most self-contained to drop, and the bind-and-documents chapter is the one most likely to need the fallback.
