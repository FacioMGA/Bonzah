---
title: BDX export operations
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-14
binding: true
---

# BDX export operations

## When to read
Monthly Lloyd's CRS V5.2 Risk, Premium, or Claims export preview/download fails, or `XLSX.GENERATE_BORDEREAUX_V52` fails.

## Preflight
1. In BO Reporting, select a real binder and month.
2. Run preview. Blocking issues must be fixed at source data or explicitly waived by an admin where supported.
3. Confirm the selected binder exists for the tenant and authorizes the report product via `BinderProductAuthority`.

## Failure Signals
- `bdx.preview.failed`: preview failed before export.
- `bdx.export.validation_failed`: CRS validation blocked final export.
- `bdx.export.worker_unavailable`: API could not complete the XLSX worker job.
- `bdx.worker.failed`: worker failed while generating/uploading XLSX.

## Triage
1. Search logs by `cid`, `binderId`, and `exportHash` when present.
2. If the error is `BDX_BINDER_NOT_FOUND` or `PROGRAM_BINDER_NOT_ALLOWED`, fix binder/authority data before retrying.
3. If validation failed, use preview row issues and CR codes to correct policy, transaction, claim, binder, or product data.
4. If storage streaming failed after worker success, use the logged filename and `exportHash` to verify blob availability.

## Forbidden
- Do not create fake binder rows to satisfy export.
- Do not bypass CRS validation for production exports.
- Do not add fallback values for missing required Lloyd's fields.
