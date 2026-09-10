# ADR-0002: Versioned insurance record and exact financial calculation

Date: September 6, 2026. Status: S1 implementation decision for development and sandbox. Extends ADR-0001 with an executable insurance aggregate; production storage and release control remain open.

## Decision

Use one canonical application owner for a stable insurance record, immutable quote versions, binding and explicit manual service transactions. The server supplies scope, actor, permissions and correlation. It also injects a validated, versioned runtime policy; request payloads cannot set authority, commission rules or override missing provider checks. Draft configuration editing does not mutate a registered runtime policy.

The initial entry path records a **manual external quote** with source references, risk summary, term, eligibility outcome, expiration, premium and capacity participants. It is deliberately a small typed contract. It neither recreates external underwriting/rating nor admits an opaque customer record into the shared domain. Trusted automated provider ingestion is separate work and requires authentication, payload mapping, inbox idempotency and outcome evidence.

Binding identifies an exact stored quote version and hash. The application checks the stored outcome, expiry, current state, scope and policy prerequisites. A policy requiring a payment, approval or provider verification that has no implemented verifier blocks binding. The synthetic registered policy explicitly requires none of those checks and therefore cannot satisfy customer payment/approval acceptance.

Endorsement, cancellation and reinstatement record a reason, effective date and explicitly authorized signed premium delta. No generic pro-rata assumption is invented. The policy identity and original quote remain stable; immutable transaction snapshots retain historical allocation and financial rule references. This first slice does not implement renewal, configurable process execution, form issuance or payment processing.

The local date gates use the trusted server clock's UTC calendar date. Tenant business calendars and time-zone-specific cutoffs require a later explicit policy contract. Service actions currently adjust money only within the original term; future scheduling, risk/term amendments and changing capacity participants are not implemented.

Persist the current aggregate, immutable revisions/events, scoped command idempotency, audit and pending outbox intent atomically in the existing SQLite development store. Use optimistic versions and hashes to reject lost updates, and scope idempotency to the business command rather than only the actor. Retried requests cannot create a second bind across authorized operators. No worker or external delivery is implied by the outbox. Transactional worker claim/retry/dead-letter and replay are separate work.

A durable identity claim allows one record per full scope, product ID and external quote reference across source/product versions. A second create with another request key cannot create a separately bindable copy; source updates must revise the existing record, with a previously unused external source version. A future provider namespace or renewal identity must extend this contract explicitly rather than bypass the uniqueness rule.

## Financial boundary

Use canonical signed decimal minor-unit strings at JSON boundaries, bounded to 18 magnitude digits, and BigInt for all calculation. Currency precision is explicit: GBP/USD/EUR two digits, JPY zero and KWD three. Unsupported currencies fail validation. Percentages use integer basis points; capacity shares must total 10,000 with one lead and unique participants.

The initial algorithm allocates gross premium with largest remainders and a stable participant-ID tie break; negative amounts mirror positive allocations. Commission is a separate amount, rounded half away from zero against an explicit gross-premium base. The output names its calculation and allocation version. Commission is not deducted from carrier allocations by assumption. Tax, fees, net settlement, currency conversion, earned premium, receivables, cash custody and balanced ledger postings are not inferred by this calculation.

The synthetic fixture selects a commission rate and external settlement parties to exercise arithmetic. Customer approved rates, bases, return rules and residual treatment remain package inputs requiring golden acceptance. VUW's no-client-money boundary must be maintained when the later ledger/reconciliation capability is introduced.

## Rust adoption

Keep the first authoritative financial implementation small and exact in TypeScript/BigInt. A Rust implementation can replace the pure calculator behind the same versioned contract after it passes the identical golden cases and measures an end-to-end benefit, including bridge/serialization and deployment overhead. No language rewrite is allowed to change approved money behavior or delay the customer critical path without evidence.

Batch validation, deterministic rating/calculation and report transformation are candidates for bounded compute workers. I/O orchestration, authorization, provider workflows and the browser continue through the canonical owner. Abbeygate's Rust branch is a candidate implementation reference; its performance results must be reproduced with exact parity against this new contract before adoption.

## Consequences

S1 demonstrates a durable, inspectable insurance workflow with exact calculations and real denial paths. It is a reusable prerequisite for customer journeys, not their acceptance. A production relational adapter, signed immutable releases, policy-controlled approvals, protected provider credentials, operational recovery and reconciliation remain required before production adoption.
