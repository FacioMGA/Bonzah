# Customer runtime boundaries from September source intake

Reviewed 6 September 2026 against the [UE](../delivery/ue-scope-matrix.md), [VUW.ai](../delivery/vuw-scope-matrix.md) and [Bonzah](../delivery/bonzah-scope-matrix.md) source matrices. These are implementation boundaries and unresolved inputs, not delivered insurance runtime.

## Decision ownership

VUW.ai retains submission intake, enrichment, pricing, appetite and primary underwriting decisioning. Facio must accept versioned outcomes through an idempotent contract and own the canonical insurance record, selected quote version, authorized bind outcome, policy transactions, documents, capacity allocation, finance, reconciliation and reporting. Screening execution and exact authority checks still require agreed ownership. A shared rating interface must support externally owned decisions as well as internally registered calculation engines; copying an Abbeygate motor calculator does not meet VUW's contract.

UE's new requirement is a property MGA walkthrough. Its rating engine/API, property rules, authority, finance and documents are unresolved customer inputs. Source-intake discrepancies must remain reviewable, with approved values distinguished from both extracted values and synthetic continuation cases. The existing institutional documents are not an approved new product. The same quote-version, policy-history, finance and reporting contracts should serve UE and Bonzah through versioned packages and typed adapters.

## Shared capabilities to implement

| Boundary | Required behavior | Source anchors |
| --- | --- | --- |
| Intake and external outcomes | Stable external IDs, schema versions, correlation and idempotency; original evidence and immutable revisions; explicit rejected/referred/quote-ready outcomes | VUW-UAT-02–07; UE-R02–05 |
| Quote and binding | Bind the selected accepted quote version; enforce effective authority and conditions; one authorized transaction on retry | VUW-UAT-08; UE-R06/R07; Bonzah P0 |
| Placement | One policy/risk and placement with a variable lead/follower panel; signed participation and allocation histories pinned per transaction | VUW-UAT-09/10; September 4 customer clarification |
| Servicing | Effective-dated manual MTA, endorsement, cancellation/return premium and reinstatement; preserve original policy and financial history; future QuoteBox automation uses the same commands | VUW-UAT-11–14 and SOW servicing criteria; UE-R08/R10/R11 |
| Finance and settlement | Currency-aware exact arithmetic with explicit rounding/residual rules; separate gross premium, participant shares, commission and settlement parties; do not record VUW as holding client premium | VUW-UAT-10/17/18; UE-R12/R13 |
| Documents and reporting | Approved versioned templates and BDX 5.2 mappings, transaction lineage, reconciliation and auditor access; keep cargo/Caribbean SOW obligations visible | VUW-UAT-15/16/19; VUW-SOW-05/08; UE-R14/R15 |

The declared VUW commission is 7.5%; its example uses the full premium base. The actual base, payer, deductions and return-commission treatment remain open. Participant names and example percentages are illustrative; no fixed panel belongs in shared runtime. UE commission, cancellation and refund rules must not inherit VUW or Abbeygate defaults.

## Current delivered boundary

The source-intake profiles in `tenant-packages/source-requirements` expose these obligations through the canonical read-only operation. They contain requirements and source references, not executable product/rating/finance configuration. Shared runtime modules never import customer packages. The separate development scopes have incomplete definitions, and all runtime/acceptance statuses remain pending. Profile capture hashes identify the local readable snapshots; they do not certify signatures, provider health or deployment.

Uriel reaffirmed September 11 for the full VUW POC. Every mandatory later-gate obligation remains in that target. Source-proposed US-first sequencing does not remove the SOW's mixed-capacity, Caribbean or cargo-auditor acceptance criteria; differences must be explicitly reconciled and tested.
