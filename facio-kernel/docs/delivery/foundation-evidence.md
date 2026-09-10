# Kernel foundation: local verification record

Date: 6 September 2026. Scope: configuration visibility, draft editing and source-backed journey requirements toward M3 (September 8). Status: **implemented and verified locally; milestone acceptance pending**. No customer journey, production deployment, migration, signed publication or public documentation release is claimed.

## Implemented result

One application service powers the authenticated Configuration Studio, HTTP routes and real MCP Streamable HTTP endpoint. Five typed definition sections persist in a scoped SQLite store. All thirteen target categories expose their implementation state. Users can inspect current values, switch draft/published views, edit a draft, inspect machine/human diffs and retrieve actionable metadata/capability gaps. Unsupported aggregate payloads are rejected.

The complete reference fixture means valid metadata within `configuration-metadata-v0.1`. It still has thirteen broader capability gaps and `productionReady: false`. The incomplete fixture has no tenant/entity/product/process definitions and produces additional named configuration gaps. These are synthetic conformance examples, not Bonzah/UE/VUW.ai customer packages.

The subsequent source-intake slice adds `configuration_requirements` / `GET /api/requirements` and a Journey requirements screen through the same permission/audit/application funnel. Source packages are immutable within the build and selected by all four server-authorized scope dimensions. They are independent of draft/published definition state. Missing profiles return `source_not_attached`; all results explicitly retain `runtimeStatus: pending_evidence` and `acceptanceStatus: not_recorded`. Profile hash, source references and identifiers are validated; tests also verify each captured file digest and detect dropped source obligations.

Two separate development intake scopes start with incomplete definitions and an `unassigned` entity label: `ue-intake` contains 15 requested modules; `vuw-intake` contains 22 proposed UAT scenarios, eight separately retained SOW criteria and 23 open inputs. Counts represent source items, not independent passing tests or accepted requirements. JSON packages are imported only by the development composition root and are included in the compiled output. No operational customer data or approved legal identity is invented by these scopes.

## Verification

| Check | Observed result | Evidence |
| --- | --- | --- |
| Strict TypeScript and compilation | Pass | `npm run check` |
| Formatting and customer boundary guard | Pass; no known customer literals/fixture imports in shared runtime modules | `npm run check`; `scripts/check-boundaries.ts` |
| Domain/store/transport/source tests | 25 passed | `tests/kernel.test.ts`, `tests/validation.test.ts`, `tests/surfaces.test.ts`, `tests/requirements.test.ts`, `tests/customer-requirements.test.ts` |
| OpenAPI 3.1 | Validated and generated from strict operation contracts | `artifacts/contracts/openapi.json` |
| Real MCP protocol | Discovery/read/write and errors exercised through the official SDK client over an actual HTTP socket | `tests/surfaces.test.ts` |
| HTTP/MCP parity | Complete and incomplete fixtures return identical configuration and gap responses | `tests/surfaces.test.ts` |
| Role-scoped discovery/hash parity | Reader tools/list equals its served discovery; manifest hashes the same projection; forbidden tool calls audited | `tests/surfaces.test.ts` |
| Isolation | Workspace/tenant/environment/operating-entity boundaries, injected context, read/write permissions denied | `tests/kernel.test.ts`, `tests/surfaces.test.ts` |
| Persistence/retries/integrity | Reopen durable draft, optimistic version conflict, cross-transport idempotent retry, immutable release/audit triggers and corrupt-state refusal | `tests/kernel.test.ts`, `tests/surfaces.test.ts` |
| Drift detection | Deliberately mismatched contract hash rejected by local verifier | `tests/surfaces.test.ts`; not a deployed promotion gate |
| Browser workflows | 12 checks passed; desktop 1440px, mobile 390px, editor/reference/incomplete/read-only contexts; zero uncaught page errors | `scripts/browser-smoke.ts`; [captured browser evidence](../evidence/browser-evidence.json) |
| Source profile visibility and isolation | Requirements/outcomes/source captures displayed; missing profile and failed refresh explicit; logout removes prior scope; HTTP/MCP permission and full-scope isolation pass | Source tests and browser smoke |
| Actual UE/VUW local packages | Live HTTP and browser returned 15 UE / 53 VUW items, no other-profile content, zero page errors; served contract manifest matched generated artifacts | [Local intake evidence](../evidence/source-intake-evidence.json) |
| Compiled source package delivery | Imported `dist/src/fixtures/customer-requirements.js` using Node; both packaged JSON profiles load and the registry returns 15/53 source items | Post-build import smoke; no source-tree-only runtime data dependency |
| Browser race/failure recovery | Mismatched snapshot/report revisions retried; successful save with failed report refresh displays unavailable validity and recovers without lost data | Browser smoke |
| Dev startup credential safety | Occupied port leaves running credentials unchanged; publication failure closes listener/removes temporary file; successful credentials are owner-only | Independent real child-process checks in disposable directories, recorded in implementation review |
| Dependency install audit | 160 packages audited, zero reported vulnerabilities at install | `npm install`; point-in-time package audit, not a general security certification |

Local browser invocation used the installed Chrome executable:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser
```

CI is configured to install Playwright Chromium and rerun the same checks. The workflow has not run remotely because this repository has not been pushed. Generated contract artifacts are checked for drift in CI.

## Review findings resolved

- The MCP convenience registry rejected bad arguments and forbidden tools before domain audit. Replaced it with low-level SDK protocol handlers that keep known-tool authorization and strict parsing inside the canonical audited funnel.
- A reader's shorter discovery projection initially disagreed with a full-registry hash. The manifest now distinguishes canonical MCP hash, scoped discovery hash and catalog hash.
- The OpenAPI validator caught nested recursive JSON references in generic diffs. Diffs now use the actual bounded configuration section types.
- Mobile table accessibility text escaped its scroll container. A positioned wrapper fixes the cause without hiding page overflow.
- Separate configuration/report reads could race another writer. The screen verifies version/view/hash agreement and never displays old validity for a newly saved definition.
- Development credentials could be overwritten by an unsuccessful second server startup. They now publish atomically only after the listener succeeds.

## Inputs and next delivery gates

- Original three DOCX baselines are extracted with source checksums in `docs/source/manifest.json`; requirements/milestones remain traceable in the delivery matrix.
- Bonzah's supplied Drive blueprint and supporting API/FNOL material are captured and mapped to all 14 P0 plus two P1 criteria. See [Bonzah scope matrix](bonzah-scope-matrix.md).
- Latest reviewed Abbeygate includes reusable canonical lifecycle services but no Bonzah implementation. See [extraction map](../architecture/bonzah-extraction-map.md). Existing customer source/data were not changed.
- UE's supplied folder was populated later on September 6; its deck, runbook, project plan and source guide are captured in the [UE scope matrix](ue-scope-matrix.md). The initial empty-folder observation is superseded. Property product/rating/finance/provider inputs and executable demo evidence remain open.
- VUW.ai POC/SOW/configuration workbook sources are now received and recorded in the [VUW scope matrix](vuw-scope-matrix.md). Specific open inputs, scope precedence and full POC execution remain unresolved; source acquisition is no longer the blocker. Uriel reaffirmed September 11 for the full POC despite later staged source dates.
- The M4 self-onboarding design track is a draft specification and remains subject to product/design/engineering review.

To accept M3 beyond local review: agree the target configuration breadth and authorized review environment, verify fields/conditional requirements/provenance against actual tenant packages, review the screen walkthrough and evidence, and connect the deployment/source inventory to authenticated observations. `deployments/registry.json` currently keeps live values unknown; [source reconciliation backlog](source-reconciliation-backlog.md) records remaining owners and publication work.

To deliver customer journeys: extract typed product/authority/process/rating/document/finance capabilities; implement Bonzah's API/DTC→verified simulated money→bind/certificates→date endorsement→FNOL/reporting sequence; preserve all P0 checks. Signed releases, approval policy, runtime adapters, managed identity, regional storage, observability and production recovery need their own evidence. No demo/POC date authorizes an existing-customer cutover.

## Captured browser views

- [Reference configuration overview](../evidence/reference-overview.png)
- [Incomplete tenant overview](../evidence/incomplete-overview.png)
- [Mobile configuration view](../evidence/mobile.png)
- [United Educators Journey requirements](../evidence/ue-intake-requirements.png)
- [VUW.ai Journey requirements](../evidence/vuw-intake-requirements.png)

The restarted local server was also checked against `artifacts/contracts/manifest.json`: served manifest matched exactly; catalog returned 13 categories; reference metadata valid; productionReady false.
