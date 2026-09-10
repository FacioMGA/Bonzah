---
title: BDX recovery rules
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-09
binding: true
---

# BDX recovery rules

## When to read
A BDX import landed dirty data: wrong premium, wrong/missing documents, or wrong policy fields. You need to repair without rederiving the question.

## The three-line rule
| Environment / situation | Tool | Why |
|---|---|---|
| **Staging validation** (acceptance test, customer demo, dev-loop) | **Wipe-and-reimport** the BDX-tagged policies, then re-run the full import. | Policy IDs / certificate numbers are not stable contracts on staging. Reusing canonical primitives (`cleanupImportedPolicy` + the BDX worker spine) is faster and safer than synthesising history. |
| **Production correction** of already-issued policies | **Correction endorsement / reversal / controlled reprocessing** through `RiskTransaction`. **Never destructive wipe.** | ADR-0007: every change to an issued policy is a `RiskTransaction`. Audit trail, premium delta math, and document regeneration all live there. |
| **Pre-issuance same-file retry** (re-run before any policy is issued) | **Idempotent upsert** keyed on `(rowKey, batchId, version)` — what `findImportedPolicyByRowKey` already enforces. | Safe because nothing is bound or issued yet; we are only resolving transient ingestion failures. **No upsert on bound/issued policies, ever.** |
| **Pre-go-live one-time reset** (tenant not yet live; delete customer test rows) | **Backup-guarded reset of NON-BDX (untagged) rows** via `wipe_non_bdx_test_policies.ts`. One-time only. | [ADR-0051](../architecture/decisions/ADR-0051-pre-go-live-production-test-data-reset.md): bounded exception — verified backup + import-first + tenant allowlist. Reversible via PITR, not soft-delete. |

## Staging — wipe-and-reimport (reference flow)
1. Confirm tenant + safety. The only gate that distinguishes staging from production is the explicit `ALLOW_DESTRUCTIVE_BDX_WIPE=1` env opt-in on the API process. NODE_ENV is intentionally `production` on every cluster (helm `runtime-configmap`) so it cannot be the gate. **Never set this opt-in on a production deployment.**
2. Dry-run wipe: `tools/migrations/wipe_bdx_imported_policies.ts --tenant <slug>` — prints per-product totals only. Equivalent HTTP: `POST /api/policies/imports/bdx/wipe` with `{ tenantSlug, commit: false }`.
3. Eyeball the totals against the source XLSX row count. Stop and root-cause if the count is off.
4. Live wipe: re-run with `--commit` (CLI) or `commit: true` (HTTP). Uses `cleanupImportedPolicy` — Policy + orphan PolicyHolder cascade.
5. Re-run import via the canonical spine: `tools/migrations/run-bdx-k8s.sh import` (job-based: dry-run → ready_for_commit → commit).
6. Verify: customer-flagged policies show correct premium and documents.

## Production — correction endorsement (reference flow)
Not yet implemented as a batch tool. When needed:
- Operator drives a per-policy correction through the existing endorsement chain (`executeCreateEndorsementDraft` → `Patch` → `Rate` → `Bind` → `executeIssueEndorsement`). The spine already regenerates the issued doc-pack via [enqueueIssuedPolicyPack](../../backend/modules/policy/app/commands/issuedPackEnqueue.ts).
- A batch tool, if built, must use this same chain — not in-place mutation of `Policy.quoteResponse`.

## Forbidden
- Destructive wipe in production, except the one-time pre-go-live reset authorised by ADR-0051.
- In-place mutation of `Policy.quoteResponse` / `PolicyStateCurrent.snapshot` for bound or issued policies (bypasses ADR-0007).
- Synthesising fake `RiskTransaction` rows that do not represent a real change. Use the chain or do not use the primitive.
- Re-running the import to "upsert" already-issued rows. The replay engine refuses this for a reason ([bdxReplayEngine.ts](../../backend/modules/policy/app/bdxReplayEngine.ts)).

## Links
- Decision: [ADR-0007](../architecture/decisions/ADR-0007-policy-versioning-lifecycle-primitives.md) · [ADR-0013](../architecture/decisions/ADR-0013-canonical-issuance-spine-outbox.md)
- Adjacent: [document-generation-recovery.md](./document-generation-recovery.md) · [staging-delivery.md](./staging-delivery.md)
- Tools: [bdx-import-runner.mjs](../../tools/migrations/bdx-import-runner.mjs) · [wipe_bdx_imported_policies.ts](../../tools/migrations/wipe_bdx_imported_policies.ts)
