# Exact-money Rust core

The `money` crate implements the existing `exact-money-v1` allocation and commission calculation. It does not introduce a new rating policy, commission base, currency default, tax, ledger or insurance decision. The TypeScript reference remains in `src/domain/money-reference.ts`; all persisted calculation fields and hashes are unchanged for equivalent inputs.

The backend loads a Rust-compiled WebAssembly module once and calls it synchronously through Node22's built-in WebAssembly API. There is no subprocess, HTTP call, JSON serialization, npm native addon or runtime download. The module has zero host imports and fixed 128 KiB linear memory; its current binary is 16,985 bytes. [Rust documents this target's minimal host assumptions](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html).

## Build and integrate

Install Rust **1.97.1**, `rustfmt`, and the `wasm32-unknown-unknown` target. The dependency-free crate is locked; compilation uses `--locked --offline` after the compiler/target are installed.

```sh
rustup toolchain install 1.97.1 --profile minimal --component rustfmt --target wasm32-unknown-unknown
rustup default 1.97.1
npm run build
npm run test:rust
npm run benchmark:rust
```

The build emits ignored `rust/money.wasm` and `rust/money.manifest.json`. Copy both into the runtime image at `/app/rust/`; run from `/app`, or pass an explicit trusted artifact directory to `initializeRustMoney(directory)`. The loader verifies artifact SHA256, size, zero imports, ABI and memory size, then checks signed residual/rounding behavior before use. An absent, corrupt or incompatible module throws `RUST_MONEY_UNAVAILABLE`. There is no TypeScript fallback. The canonical allocator delegates every supported case to Rust. Hosted, local and development entrypoints initialize it before opening storage; the HTTP composition also requires initialization and reports the loaded manifest in `/health.moneyEngine`. A missing artifact rejects hosted startup before either database can be created.

`src/domain/rust-money.ts` exports `allocateFinancialsRust(input)`, `initializeRustMoney(directory?)`, `rustMoneyStatus()` and the isolated `createRustMoneyEngine(directory?)`. Engine identity is separate from the unchanged calculation version. Application use cases consume the canonical allocator; callers cannot choose an engine or bypass the shared contract. CI installs the pinned compiler/target, runs native and Node conformance, and records a benchmark. The image builds Rust from source using a digest-pinned compiler stage and ships only the compiled module and manifest; the compiler, TS oracle and fixtures are excluded from the runtime image.

## Contract and safety boundary

The shared strict schema checks currencies, canonical signed minor strings, one lead, unique IDs, positive shares totaling 10,000 basis points, roles and explicit commission ownership. It sorts participants by stable ASCII ID before crossing the boundary. Rust independently rejects invalid count, premium magnitude, rate and share totals. Products use `u128`, so multiplying the 18-digit maximum by basis points cannot overflow `u64`. Largest-remainder ties use the supplied stable-ID rank; negative adjustments mirror positive calculations and commission rounds half away from zero.

Only fixed share/output buffers cross the ABI. JavaScript validates before i64/i32 conversion, preventing wraparound. One synchronous, non-reentrant instance owns those buffers, returns copied values, and never awaits or calls a host function. Rust declares the narrow static-buffer access as unsafe; bounds and the instance ownership contract are explicit. No raw pointer refers to host memory.

## Local evidence, September 7, 2026

The retained [benchmark receipt](evidence/2026-09-07-money-benchmark.json) records Node22, machine/CPU, compiler/module fingerprints, individual rounds, throughput, CPU and process memory. Its scope is the complete allocation function, including schema validation, stable-ID sorting, the JS/WASM bridge and result construction. It excludes HTTP, database writes, provider calls and actual cloud billing.

The initial recorded run used 12,000 deterministic synthetic parity cases, separate Node processes, 50,000 warmups, seven consecutive measured rounds, and full GC before and after the complete measured workload. Amortized CPU includes final GC. An optimized TypeScript control removes avoidable legacy object spreading/output validation, preventing those changes from being misattributed entirely to Rust.

| Participants | Wall speedup versus retained TS | Wall speedup versus optimized TS | CPU reduction versus optimized TS |
| ------------ | ------------------------------: | -------------------------------: | --------------------------------: |
| 1            |                           1.33× |                            1.04× |                              3.4% |
| 4            |                           1.46× |                            1.11× |                              9.8% |
| 10           |                           1.55× |                            1.15× |                             13.2% |
| 100          |                           1.56× |                            1.36× |                             24.6% |

The [integration repeat](evidence/2026-09-07-money-benchmark-repeat.json) on the same module measured 1.37/1.51/1.59/1.40× wall throughput versus retained TS and 26.6/32.7/36.0/12.8% less amortized process CPU for 1/4/10/100 participants. Against optimized TS, the 100-participant repeat used 15.6% more CPU despite 1.06× wall throughput. Both receipts remain available; they do not establish universal CPU savings over optimized JavaScript. The changed source fingerprint adds the rustfmt toolchain component; the executable module fingerprint is unchanged.

These are observations from one machine. The single-participant gain is small and sensitive to noise. Peak RSS includes Node/JIT/GC baseline and does not prove an application memory reduction. Earlier exploratory measurements forced GC between rounds but excluded that work from CPU windows; those CPU estimates were not used for the final comparison. Whole-service latency, target-host behavior and cloud-bill reduction require their own measurements.

Four arithmetic Node test cases compare every output field/hash over 12,000 generated cases and exercise source-illustrative amounts, all supported currencies, signed 18-digit extremes, zero, residual ties, reordering, invalid input/error parity, direct-ABI conversion bounds and corrupt/missing artifacts. Two native Rust tests independently check arithmetic and rejection. Two integration tests cover the canonical allocator, health fingerprint and missing-module startup before storage. A clean local Linux arm64 container (Node22.23.2, uid1000, networking disabled) loaded the packaged Rust and passed the illustrative allocation while excluding the compiler, oracle and fixtures; this is local packaging evidence, not a hosted deployment or Linux amd64 benchmark. The sanitized [container receipt](evidence/2026-09-07-money-container.json) identifies that image. A clean build in another temporary checkout produced the same artifact SHA256, `970064d3640e112cab1fae9acea35c4d2968c9fbcaaec300437236e99e12b7e7`.

The [final Sprint 5 local image check](evidence/2026-09-07-sprint5-final-container.json) built the current uncommitted working tree for Linux arm64 and verified actual hosted startup and health, positive/negative canonical allocation, and runtime exclusions as uid1000 with networking disabled and a read-only root filesystem. Missing WASM, corrupt WASM and a missing manifest each rejected hosted startup before either database was created. Its supplied build label identifies the candidate baseline; it does not establish an immutable release or deployment. The same WASM fingerprint was retained. Both benchmark comparison tables were recomputed from the recorded measurements; no new performance or cloud-cost measurement is implied by this packaging check.

## Abbeygate provenance and limits

The existing Abbeygate checkout was read without changes. Branch `rust-kernel` resolves to `4f771823953ad0442882c24e17e71efcf3860532`. Its benchmark/evaluator structure demonstrates separating compute, parsing, serialization, bounded streaming, threads and persistence. The locally retained July29 streaming results cover roughly one million rows and distinguish chunk/thread configurations. These are earlier machine observations; they do not measure this Kernel or prove a current deployed integration.

The Kernel adapts that measurement discipline. It does not copy the Motor-specific financial/tax defaults. `packages/policy-engine-rs/src/domain/calculation.rs` in the branch contains Motor/Cyprus calculation identity and MIF/stamp movements; `tools/benchmarks/run_parity_check.ts` prints a literal “100% Parity” label even when its counters show differences. Its streaming evaluator skips parse failures with `if let Ok`. This new crate rejects malformed inputs and uses independent exact field/hash parity. Customer golden evidence and production acceptance remain separate.

The [final contract-refinement container check](evidence/2026-09-07-contract-final-container.json) rebuilds and repeats the same offline startup, allocation, runtime exclusion and missing/corrupt artifact checks after contract deduplication. It still identifies an uncommitted local candidate; exact hosted release proof is recorded separately.

The [verified PR CI benchmark](evidence/2026-09-07-money-ci-benchmark.json) repeats all 12,000 parity cases on Linux x64 / Node22.23.2. For 1/4/10/100 participants, measured wall throughput was 1.28/1.40/1.57/1.48× the retained TypeScript baseline, with 22.2/29.9/36.6/22.4% less amortized process CPU. Against the optimized TypeScript control it measured 1.05/1.12/1.21/1.31× throughput and 5.7/12.8/18.7/21.3% less amortized CPU. The receipt identifies the exact verified PR head and identical merged tree. These are allocator measurements on a GitHub runner, not serving-VM measurements, whole-service throughput or billed cost savings. Earlier local variation remains part of the evidence.
