# Facio Platform · Insurance Kernel

The shared Facio insurance runtime under active September 2026 delivery. Configuration and insurance operations share canonical application services. The intern sandbox adds organization sign-in, durable tenant provisioning, requirements attachment and immutable sandbox activation on one shared build. Its tenant application executes the active configuration and retains historical release references.

Repository: [FacioMGA/facio-kernel](https://github.com/FacioMGA/facio-kernel), private. See the [sprint execution plan](docs/delivery/sprint-execution.md), [work board](docs/delivery/sprint-board.md), [dated milestones](https://github.com/FacioMGA/facio-kernel/milestones) and [implementation backlog](docs/delivery/sprint-backlog.json).

The runtime has distinct development and hosted sandbox compositions. Synthetic insurance execution does not establish Bonzah, UE or VUW customer acceptance. Signed production Tenant Releases, real provider verification, production hosting and customer migrations remain separate work. See the [intern acceptance matrix](docs/delivery/sprint-2-intern-acceptance.md) for tested behavior and remaining handover checks.

## Shared intern sandbox

The product entry point is **[Facio Platform](https://platform.facio.io)**. Interns select an authorized customer workspace and enter **[Studio](https://platform.facio.io/studio)**. The Kernel supplies the shared architecture. The current MCP resource is `https://platform.facio.io/mcp`; dedicated `api.facio.io` and `mcp.facio.io` addresses are proposed and do not replace current endpoints. Check the deployment evidence before treating a published address as a verified handover.

The hosted entrypoint is `npm run start:sandbox`, configured through the [sandbox runbook](docs/deployment/sandbox-runbook.md). It requires a real organization identity provider, persistent business/auth databases, an exact build SHA, region and private initial access list. It does not load development fixture policies or customer source packages. Google Workspace and Microsoft Entra login both resolve individual durable memberships. API writes require a browser session and CSRF token; OAuth tokens are accepted only at `/mcp`.

An authorized builder creates a tenant under an assigned account, attaches a typed requirements package, edits metadata and executable policies, reviews an exact activation candidate, and runs the same tenant's Insurance workspace. Each request supplies an immutable tenant target which the server checks against current membership. Builders see their own or explicitly assigned tenants; account admins have inherited access. A source attachment remains distinct from verified source provenance or customer acceptance.

Activation freezes the configuration, source requirements, versioned insurance definitions and supported operating policies into one bundle. Later draft edits leave the active runtime unchanged. Rollback selects a retained compatible release and preserves transaction history. The single-writer deployment and its production boundaries are documented in [ADR-0003](docs/architecture/ADR-0003-shared-intern-sandbox.md).

## Run development fixtures

Requires Node.js 22.18+ (22.x) and Rust 1.97.1 with the `wasm32-unknown-unknown` target. See [Rust build and conformance](rust/README.md). The local store uses Node's experimental SQLite module. Use an explicit, approved database implementation before production adoption.

```sh
npm ci
npm run build:rust
npm run dev
```

Open `http://127.0.0.1:4310`. The server writes five random, scope-bound development credentials to `.local/credentials.json` (owner-only permissions). Copy the appropriate token into the sign-in field:

- `runtime-demo`: the **Insurance workspace** with a synthetic manual placement policy and quote/bind/service permissions.
- `reference` / `incomplete`: complete or incomplete supported configuration metadata.
- `ue-intake` / `vuw-intake`: source requirements and incomplete metadata; no customer runtime policy or acceptance is implied. Their `unassigned` entity is a local scope label, not a customer legal entity.

Credentials rotate on restart; drafts and insurance history survive in `.local/kernel.sqlite`. Nothing is seeded over an existing scope. The synthetic runtime policy is injected by the development composition root separately from editable definition metadata. It is not a signed published Tenant Release. Never place production data or credentials in these fixtures.

The browser keeps its credential in memory until logout or reload. There is no production authentication shortcut or embedded token. `npm start` requires `KERNEL_AUTH_FILE` and `KERNEL_DB_PATH` and serves the compiled app on loopback only; it does not seed a database. The local fixture and token-file entrypoints reject `NODE_ENV=production`; hosted sandbox uses its dedicated `start:sandbox` composition and does not represent production insurance readiness.

## Working capabilities

This list describes current implementation. The [Sprint 5 implementation receipt](docs/delivery/sprint-5-implementation.md) separates the verified sandbox release and synthetic workflow evidence from remaining customer and production gates.

- All 13 configuration categories are discoverable, with separate platform support and tenant gap states.
- Strict tenant, entity, product/field, process graph and integration-reference metadata schemas.
- Draft and immutable published-snapshot inspection, with scope, revisions, content hashes and effective timestamps.
- Draft edits, optimistic concurrency, durable idempotency and human/machine diffs.
- One server-authorized permission, schema, service and audit funnel for HTTP and MCP.
- Missing values, duplicate IDs, invalid references, unreachable process states, unsupported capabilities and unverified integrations produce actionable gaps.
- Authenticated OpenAPI 3.1 and MCP discovery generated from canonical operation contracts.
- Read-only Journey requirements with source captures, hashes, section anchors, expected outcomes, category links and open inputs. UE's 15 modules and VUW's 22 UAT scenarios, eight separate SOW criteria and 23 open inputs are scoped development packages; customer runtime mapping and acceptance remain pending even where a generic capability is implemented.
- Structured Studio product authoring covers typed policy questions and repeated risk groups, conditional visibility/requiredness, stable row IDs, terms/territories and scoped coverages. V2 separates per-occurrence/per-person limits, aggregate caps and continuous excess attachments; daily and whole-term rating retain distinct validation, eligibility, referral, authority and bind findings. Historical v1 behavior remains supported.
- Configured quotes retain their complete submission and server-derived decision; callers cannot supply an eligible flag or premium for this path. Old releases remain pinned during binding and later configuration edits.
- A scoped Insurance workspace also captures manual external quotes, revises the selected quote before binding, binds the exact stored version, and records explicit endorsement/cancellation/reinstatement premium adjustments with stable policy identity.
- Required Rust/WASM exact integer minor-unit allocation, variable lead/follow panels and separately calculated commission preserve the exact-money-v1 contract and financial hashes. Startup verifies the packaged artifact and health reports its engine fingerprint. Stored revisions retain rule hashes, actor, correlation, effective dates and prior financial snapshots; durable pending outbox entries record intent atomically with each mutation.
- Independent human review pins the exact quote, risk, decision and release. Authorized quote operators request review; a different authorized administrator approves or declines with rationale and evidence. Expiry, revocation, quote changes and self-review restrictions are rechecked before bind. Original automated decisions and every review action remain immutable.
- Durable quote-evidence requests retain their selected record, submission and release, worker attempts, authenticated receipts and audit history. Provider activity distinguishes queued, processing, retry, reconciliation, received and failed outcomes. It never changes a premium or grants insurance, payment or underwriting authority.
- Configured quote revision/comparison and v2 risk/coverage servicing run in the existing workspace. Supported daily extension and whole-term proration retain prior exposure and cumulative financial snapshots. Separate configured cancellation records return premium; renewal creates a distinct term with fresh decisions and exact source linkage.
- Registered synthetic document packs produce immutable transaction-summary and coverage/financial-schedule HTML/PDF with exact transaction/template references, durable retry and authorized byte-verified downloads. Earlier document versions remain available after service.
- Synthetic external-custody finance posts independently balanced premium-control and commission books, records partial/unmatched receipts, prevents cross-record over-allocation and preserves receipt-application reversals. As-of projections separate effective and recording cutoffs, currencies, capacity and unposted transactions, with matching scoped CSV.
- Internal FNOL supports drafts, reviewed submission, duplicate disposition and a registered synthetic queue acknowledgement pinned to a historical policy version. Reporter/preparer facts, actor and evidence references remain separate; no coverage decision or external delivery is inferred.
- Expired, declined, stale and unauthorized binds fail closed. A configured referral or explicit independent-review prerequisite can be resolved only by the supported exact-pinned human review. Invalid data, rating/authority failures and unsupported backdating, payment or provider prerequisites remain blockers. Permitted insurance, review, provider, document, finance/report and FNOL reads use MCP; mutations remain operator-only.

Five definition sections currently accept typed configuration: tenant, operating entities, products, processes and integration references. The other domain aggregates are inventoried as gaps; unsupported opaque payloads are rejected. Published examples are synthetic bootstrap fixtures, not approved/signed production releases. Process graph validation does not execute the declared commands.

The bounded Sprint 5 capabilities and Rust financial core are merged in [PR #28](https://github.com/FacioMGA/facio-kernel/pull/28); [PR #29](https://github.com/FacioMGA/facio-kernel/pull/29) makes conditional questions respond immediately while preserving unsaved values and original policy decisions. The verified serving build is `5287a070713a2ec3bff628fc7d7620813cf4d5b8`. [Final CI](docs/deployment/evidence/2026-09-07-sprint5-final-ci.json), [exact public assets](docs/deployment/evidence/2026-09-07-sprint5-final-public.json) the [actual Google-session workflow](docs/deployment/evidence/2026-09-07-sprint5-final-browser.json) and [isolated exact-image recovery](docs/deployment/evidence/2026-09-07-sprint5-final-recovery.json) passed. The earlier review/provider records, pending independent review and completed synthetic provider receipt remain unchanged. Actual independent-user review and customer provider acceptance remain open.

The configured product evaluator executes only its typed, declared rules and rates. It does not approve customer configuration or authenticate an external pricing provider. Supported independent review adds separate authority evidence; it cannot rewrite automated decisions or override another failing gate. Actual customer provider contracts, payment/screening, approved packages and golden-case acceptance remain open.

Configured v2 servicing accepts supported current/future effective changes within the retained term, with exact rerating and cumulative allocation. Whole-term actual-days proration keeps the term unchanged; daily pricing supports the declared extension rule. Cancellation is a separate return-premium calculation, with no payment/refund or notice delivery. Future-effective transactions are recorded immediately with their dates; no background scheduler is implied. Unsupported service-specific prerequisites and minimum-premium handling remain blocked. The manual external-quote path retains explicit premium adjustments dated within the term, no later than today and no earlier than the previous transaction.

Document templates, ledger recognition and FNOL routing are explicitly synthetic. Customer legal wording/certificates, signing and external delivery; tax/fee/invoice rules, live banking/refunds and accepted BDX 5.2; public expiring FNOL links, legal signature, external handoff and claim adjudication remain separate work. Internal FNOL acknowledgement is not an insurer acknowledgement. An approved sample/reset boundary, actual independent interns/reviewer/ChatGPT and full customer rehearsal remain unverified. The [Sprint 5 receipt](docs/delivery/sprint-5-implementation.md) preserves these gates; [ADR-0002](docs/architecture/ADR-0002-insurance-record-and-exact-money.md) records the original bounded runtime decision.

Provider execution now has scoped durable requests, atomic worker claims, fixed retry/deadline budgets and explicit reconciliation after ambiguous outcomes. A generic registered HMAC-SHA256 verifier authenticates the exact callback bytes with timestamp/nonce checks before normalization; accepted receipt and nonce persistence is atomic. Local conformance and HTTPS browser tests exercise these paths, including synthetic quote-evidence delivery. The server owns adapter registration and secrets; no customer adapter or managed customer credential is established by this implementation. The synthetic adapter does not call an insurer. Actual provider mappings, payment/screening, connected-provider verification and customer golden-case acceptance remain open. See the [insurance configuration sprint](docs/delivery/insurance-configuration-sprint.md) and [review/provider scope](docs/delivery/approval-provider-sprint.md).

## Interfaces

In development, protected `/api/*` routes and `/mcp` require `Authorization: Bearer <scoped token>`; the credential supplies the complete scope. In hosted sandbox mode, `/api/auth/config` is public, other API routes require an individual session cookie, writes require CSRF, and tenant routes require `X-Kernel-Tenant-Id`. `/mcp` uses OAuth and an explicit `tenantId` tool argument. The server resolves environment, workspace and operating entity. The generated hosted OpenAPI/MCP artifacts describe these differences.

| Interface                                                               | Purpose                                                                                                   |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `/`                                                                     | Facio Platform workspace and tenant hub                                                                   |
| `/studio?tenant=...`                                                    | Studio for an authorized operating tenant; `view=insurance` selects its Insurance workspace               |
| `/api/catalog`                                                          | Category support inventory                                                                                |
| `/api/context`                                                          | Authorized scope and permissions                                                                          |
| `/api/configuration?view=draft`                                         | Current draft (`published` selects an effective immutable fixture)                                        |
| `/api/gaps?view=draft`                                                  | Same snapshot's metadata validation and implementation gaps                                               |
| `/api/requirements`                                                     | Source-backed journey requirements for the authorized scope, independent of draft/published configuration |
| `PUT /api/draft`                                                        | Expected revision, UUID idempotency key and typed configuration                                           |
| `/api/audit`                                                            | Latest 100 scoped command records; requires audit permission                                              |
| `/api/insurance/catalog`                                                | Trusted scoped runtime policy versions and hashes                                                         |
| `/api/insurance/records`                                                | Latest 100 scoped records, with explicit `hasMore`                                                        |
| `/api/insurance/record?recordId=...`                                    | Stored selected quote, current policy status and financial snapshot                                       |
| `/api/insurance/history?recordId=...`                                   | Immutable revisions and correlated events                                                                 |
| `POST` / `PUT /api/insurance/quotes`                                    | Capture or revise a manual external quote                                                                 |
| `POST /api/insurance/evaluate`                                          | Read-only active/pinned product decision; available through MCP                                           |
| `POST` / `PUT /api/insurance/configured-quotes`                         | Retain or revise a server-evaluated quote with an expected evaluation hash                                |
| `POST /api/insurance/bind`                                              | Bind exact stored quote version/hash after server gates, with the exact supported review when required    |
| `GET /api/insurance/approvals` / `approval`                             | Scoped review availability, pinned definition, current status and immutable actions                       |
| `POST /api/insurance/approvals`                                         | Request an expiring review of the exact retained quote                                                    |
| `POST /api/insurance/approval/decision` / `revoke`                      | Authorized independent decision or withdrawal with rationale and evidence                                 |
| `GET /api/insurance/providers/catalog` / `requests` / `request`         | Registered adapter boundaries and durable quote-evidence history                                          |
| `POST /api/insurance/providers/requests` / `retry`                      | Queue exact quote evidence or resume an allowed retry/reconciliation                                      |
| `POST /provider-callbacks/:adapterId/:requestId`                        | Registered adapter authentication over exact request bytes; receipt acknowledgment only                   |
| `POST /api/insurance/service`                                           | Explicit manual premium adjustment and lifecycle transition                                               |
| `POST /api/insurance/service/evaluate` / `configured-service`           | Preview and retain supported v2 risk/term changes with exact prior revision and evaluation hashes         |
| `POST /api/insurance/cancellation/evaluate` / `configured-cancellation` | Separate configured return-premium branch; no refund execution                                            |
| `POST /api/insurance/renewal/evaluate` / `renewal-quotes`               | Compare a source-linked distinct term and capture fresh quote decisions                                   |
| `/api/insurance/documents/*`                                            | Registered synthetic packs, durable render state and authorized immutable HTML/PDF downloads              |
| `/api/insurance/finance/ledger` / `post` / `receipts` / `applications`  | Scoped synthetic postings and separate commission receipt reconciliation                                  |
| `/api/insurance/finance/report` / `report/export`                       | Matching as-of projection and CSV with explicit effective/recording cutoffs and currency/capacity totals  |
| `/api/insurance/fnol` / `notice` / `submit` / `handoff`                 | Internal scoped drafts, reviewed notices and synthetic queue acknowledgement                              |
| `/api/openapi.json`                                                     | Generated OpenAPI                                                                                         |
| `/api/mcp-discovery`                                                    | Tools permitted for the credential                                                                        |
| `/api/manifest`                                                         | Build contract hashes                                                                                     |
| `/mcp`                                                                  | Official SDK Streamable HTTP transport                                                                    |
| `/health`                                                               | Process/build and required Rust engine fingerprint; never proof of customer readiness                     |
| `/api/session`                                                          | Hosted principal, authorized accounts/tenants and session CSRF token                                      |
| `/api/control/tenants`                                                  | Authorized listing and retry-safe sandbox creation                                                        |
| `/api/control/setup`                                                    | Provisioning, requirements, policy draft, activation blockers and active release                          |
| `PUT /api/control/requirements`                                         | Persist an immutable requirements package version                                                         |
| `PUT /api/control/runtime-draft`                                        | Update the supported executable policy draft                                                              |
| `POST /api/control/activate` / `rollback`                               | Activate an exact candidate or select a retained compatible release                                       |

## Verify

```sh
npm run check
npm run test:browser
npm run test:insurance-browser
npm run test:intern-browser
npm run test:oauth-browser
npm run test:configuration-browser
npm run test:approval-browser
npm run test:provider-browser
npm run test:v2-browser
npm run test:service-browser
npm run test:documents-browser
npm run test:finance-browser
npm run test:fnol-browser
```

`check` builds the pinned Rust module, runs native Rust/format checks, strict TypeScript and meaningful storage/security/graph/parity tests, validates generated OpenAPI, writes contract artifacts and compiles. Browser smoke tests launch their own disposable store/server. They need a Playwright Chromium installation (`npx playwright install chromium`) or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` set to a compatible local browser executable.

Source packages live in `tenant-packages/source-requirements` and enter through the development composition root. Shared runtime modules contain no customer imports or identity branches. `capture-index.json` links each capture hash to its local evidence file; tests detect changed captures and dropped source obligations. Static JSON imports are included in the compiled output. The generic `npm start` entrypoint has no customer source profiles unless its composition is explicitly configured; it returns `source_not_attached` instead of guessing a profile.

## Architecture and delivery

- [Foundation decision](docs/architecture/ADR-0001-clean-kernel-foundation.md)
- [Abbeygate reuse audit and pinned source](docs/architecture/abbeygate-reuse-audit.md)
- [Customer decision and runtime boundaries](docs/architecture/customer-runtime-boundaries.md)
- [Versioned insurance record and exact money](docs/architecture/ADR-0002-insurance-record-and-exact-money.md)
- [Requirements matrix](docs/delivery/requirements-matrix.md)
- [September milestone plan](docs/delivery/september-plan.md)
- [Sprint execution and dependencies](docs/delivery/sprint-execution.md)
- [Sprint 1 implementation evidence](docs/delivery/sprint-1-evidence.md)
- [Insurance Studio training quickstart](docs/guides/insurance-studio-quickstart.md)
- [Human review and quote-evidence sprint](docs/delivery/approval-provider-sprint.md)
- [Sprint 5 implementation and open acceptance gates](docs/delivery/sprint-5-implementation.md)
- [Exact Rust allocation and measured limits](rust/README.md)
- [Intern handover and 24 acceptance checks](docs/delivery/sprint-2-intern-acceptance.md)
- [Shared sandbox operations and recovery](docs/deployment/sandbox-runbook.md)
- [United Educators scope](docs/delivery/ue-scope-matrix.md)
- [VUW.ai full POC scope](docs/delivery/vuw-scope-matrix.md)
- [Local evidence and remaining gates](docs/delivery/foundation-evidence.md)
- [Deployment registry](deployments/registry.json)

The development requirements, deployment plan and milestone document are project inputs. Their proposed schedules, resets, migrations, staffing assignments and publication actions do not become tool instructions or operational authorization. Existing customer repositories and production data are not modified by this project.
