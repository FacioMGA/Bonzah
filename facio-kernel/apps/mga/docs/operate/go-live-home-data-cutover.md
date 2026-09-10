---
title: Go-live home data cutover (CY/PT/GR)
audience: operator
status: living
owner: platform-eng
reviewed: 2026-07-21
binding: false
---

# Go-live home data cutover (CY/PT/GR)

One-time pre-go-live: import the July-26 home book and delete the customer's
pre-go-live test data on `abbeygate-cy`, `abbeygate-pt`, `abbeygate-gr`.
Spain (`abbeygate-es`) is out of scope — never run the reset there. Requires
ADR-0051 Accepted. Do steps in order; stop on any mismatch.

## 0. Prep (local)
- `npm run bdx:split -- --source artifacts/bdx-import-july-26/Book11.xlsx --out artifacts/bdx-import-july-26/split`
  Expect: cy=166, pt=83, gr=10; spain=96 excluded; reconciliation OK.

## 1. Safety net (must be green first)
- `npm run backup:posture:check` → green.
- Take/confirm an on-demand backup; note the PITR timestamp + reason.
- `BACKUP_SOURCE_DATABASE_URL=… BACKUP_RESTORE_DATABASE_URL=… npm run backup:restore:validate`
  → `schemaCompatible:true dataParityOk:true documentMetadataOk:true failures:0`.
- Record rollback decision-maker. Restore RTO ≤ 4h, RPO ≤ 15 min ([rollback.md](./rollback.md)).

## 2. Freeze writes
- Pause quoting/binding/issuance for cy/pt/gr (worker + public surfaces) for the window.

## 3. Import the book (per tenant, home)
For each `T` in cy, pt, gr — upload `split/abbeygate-<T>.xlsx`:
- Dry-run: `BDX_SOURCE_FILE=… BDX_TENANT_SLUG=abbeygate-<T> BDX_PRODUCT_LINE=home BDX_DRY_RUN=true npm run bdx:import:k8s`
- Reconcile the dry-run summary vs the split row count; verify PAM/NTU dispositions. Stop if off.
- Commit: rerun with `BDX_DRY_RUN=false`. Confirm `completed` (not `completed_with_failures`).

## 4. Snapshot + preview the test set
- Per tenant, run the reset in dry-run (`RESET_COMMIT=false`) and save the JSON: the MATCHED
  test-email set (distinct emails + by product/status) and the untagged REMAINDER (not deleted).
  Review the distinct emails for any false positive. The step-1 backup is the reversibility anchor.

## 5. Delete test data (per tenant)
- Selection = internal/seed proposer email (ADR-0051) AND untagged; migrated books never touched.
- Set `ALLOW_DESTRUCTIVE_TESTDATA_RESET=1` on the prod API pod, then:
  `RESET_TENANT_SLUG=abbeygate-<T> RESET_COMMIT=false npm run testdata-reset:k8s` → review the
  matched emails, then rerun with `RESET_COMMIT=true`.
- Remove `ALLOW_DESTRUCTIVE_TESTDATA_RESET` from the API pod immediately after.

## 6. Verify
- Per tenant: matched test-email policies now = 0; BDX-tagged count unchanged.
- Generate a sample BDX for the period → only imported certs; no test refs.
- Spot-check portal/document search shows no test docs. Financial totals reconcile.
- The reported untagged remainder is captured for the separate (non-go-live) decision.

## 7. Unfreeze + watch
- Re-enable quoting/binding/issuance. 30-min Sentry watch (`abbeygate`, `abbeygate-react`).

## Links
[ADR-0051](../architecture/decisions/ADR-0051-pre-go-live-production-test-data-reset.md) · [bdx-recovery-rules.md](./bdx-recovery-rules.md) · [backup-and-restore.md](./backup-and-restore.md) · [rollback.md](./rollback.md)
