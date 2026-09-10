# Sprint 1: shared insurance runtime evidence

Verified September 6, 2026. Work items [K01 / #1](https://github.com/FacioMGA/facio-kernel/issues/1) and [K02 / #2](https://github.com/FacioMGA/facio-kernel/issues/2). Implementation commit `f49c01e3a85149347cc9d03e4c3d6fb4fe872d59`; [PR #18](https://github.com/FacioMGA/facio-kernel/pull/18). Local implementation passed the checks below; the PR and its GitHub Actions records govern remote integration status, including the final CI configuration and evidence update.

## Implemented behavior

The existing browser application now includes an Insurance workspace over the canonical HTTP operations. A scoped, server-injected policy supplies product version, currency, premium/participant limits, commission and explicit unsupported prerequisite gates. Manual external quotes retain source/risk references, eligibility, term, expiry, selected price and variable lead/follow shares. An external reference belongs to one scoped product record, even across operators and request keys; revisions require new source versions.

Binding uses the stored selected quote version/hash and checks state, eligibility, expiry and policy prerequisites. Endorsement, cancellation and reinstatement record explicit manual premium deltas with a stable policy identity, chronological effective dates and bounded nonnegative totals. Original quote and prior financial snapshots remain immutable.

State, immutable revisions/events, idempotency, source identity, audit and pending outbox commit atomically. Startup adds migrations without resetting existing configuration; source identity backfill rejects conflicting legacy records and releases the database lock on failure. Insurance reads share the HTTP/MCP owner; insurance mutations are unavailable through MCP discovery and direct invocation.

Exact BigInt calculations preserve canonical minor-unit strings, variable participant shares, deterministic residual allocation and separate commission rounding. Browser forms accept normal decimal currency amounts and percentages, perform exact string scaling only, and retain raw values in optional trace views. They preserve an uncertain request for an exact idempotent retry and show stale/denied/error/empty states without presenting a failed read as absent data.

## Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Integrated formatting, types, customer boundaries, generated contracts and compiled build | Passed on Node 22.22.2 | `npm run check` |
| Automated domain/store/security/source/HTTP/MCP tests | **44 passed, zero failures** | `tests/*.test.ts`; includes 9 insurance domain/storage, 2 insurance surface and 8 money tests |
| Existing configuration browser workflow | **12 checks passed** | `npm run test:browser`, isolated disposable store |
| Insurance browser workflow | **10 compound checks passed, zero browser errors** | `npm run test:insurance-browser`; [captured result](../evidence/sprint-1-insurance-browser.json) |
| Desktop/mobile inspection | Passed at 1440px and 390px; forms/history remain usable without horizontal overflow | [Desktop](../evidence/sprint-1-insurance-workspace.png), [mobile](../evidence/sprint-1-insurance-mobile.png) |
| Exact presentation | GBP 500,000.00 → 50,000,000 minor units; 60.00%/40.00% → 6,000/4,000 bps; KWD above JavaScript safe integer retained | Browser test also rejects excess fractional precision without rounding |
| Real local development composition | Six-version create/revise/bind/endorse/cancel/reinstate chain; exact retries, duplicate identity, malformed money, stale bind and unauthorized-scope denials | [Runtime evidence](../evidence/sprint-1-runtime.json), verified 14:03 UTC |
| Compiled persistence and contract parity | Compiled Store reopened the same local six-version chain and six pending outbox rows; served hashes matched compiled contracts | Runtime evidence records exact policy/record/contract hashes and source fingerprint |
| Initial repository baseline CI | Passed for foundation commit `984edbbe6fa32ab44056bf61daa12bb7d868c5f7` | [GitHub run](https://github.com/FacioMGA/facio-kernel/actions/runs/34036900140) |

Local browser commands used `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`. CI installs the locked Playwright Chromium version and runs both suites. Browser checks are compound workflows, not extra unit-test counts.

The source fingerprint in the runtime JSON covers sorted source/test/script/public/package/lock/tsconfig/CI path and content pairs. GitHub records exact PR and merged commits and their CI status; this document does not replace those records with an inferred deployment SHA.

## Local review

The development app runs at `http://127.0.0.1:4310`. Use the `runtime-demo` credential from `.local/credentials.json`, then open **Insurance workspace**. A synthetic warehouse example has six immutable versions, current premium GBP 600,000.00 and separately calculated GBP 60,000.00 commission under the synthetic 10% rule. It remains bound after cancellation/reinstatement verification. All names, identifiers and values in this example are synthetic; the source intake profiles remain separate.

Credentials rotate at server restart and are never checked in. `.local/sprint-1-demo.json` records the local example identity without credentials. The committed runtime evidence contains only synthetic identifiers and hashes. The private repository requires a PR and successful `verify` status on current `main`, enforces linear history, and prohibits force push/deletion. Repository governance is implementation infrastructure, not insurance publication approval.

## Acceptance boundary and next work

This closes only the bounded shared-record implementation when its remote integration checks pass. It does **not** close M1, M2, M3 stakeholder acceptance or any full customer requirement by inference. The [sprint backlog](sprint-backlog.json) retains all customer obligations and dependencies.

- Manual external quote capture does not authenticate a provider or independently make underwriting/rating decisions. Required payment, approval and provider-verification gates block until their trusted workflow exists.
- Servicing currently adjusts premium within the original term and fixed participants. It does not change risk, dates or capacity, schedule future changes, compute proration/tax/fees, renew policies or issue documents. Date gates use the trusted clock's UTC day.
- Financial results are gross allocations and separate commission calculations. There is no balanced ledger, invoice, cash receipt, refund payment, bank reconciliation or BDX output yet. Outbox rows remain pending; no dispatch is claimed.
- SQLite/local credentials remain development implementations. Production identity/storage, signed publication, cloud hosting, recovery and customer migration are separate gates.

Next dependency: K03 versioned product/authority decisions and K04 provider ingress, alongside M3 acceptance and the customer-input work in K15. September 11 remains the deadline for the full VUW POC, with the forecast at risk until remaining implementation, integration inputs and acceptance evidence are resolved.
