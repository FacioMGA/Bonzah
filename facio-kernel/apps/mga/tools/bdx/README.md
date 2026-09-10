# BDX Migration & Data Tools

This directory contains operator tools for BDX data migration and validation. These are **critical** for onboarding new programs and accounts — they are not scratch scripts.

## Tools

The standalone analysis scripts (`bdx_analysis.ts`, `bdx_dup_analysis.ts`) were retired; their checks are now part of the import endpoint's `dryRun: true` path which surfaces duplicate refs, field coverage, and per-row migration-compliance state directly from the same engine that performs the commit.

## Pre-flight workflow

```bash
# Dry-run an XLSX through the engine for full validation + duplicate detection.
# The response includes per-row warnings, errors, and chain projections.
curl -fsS -X POST \
  -H "Authorization: Bearer ${BDX_AUTH_TOKEN}" \
  -F "file=@path/to/file.xlsx" \
  -F "dryRun=true" \
  "${API_BASE_URL}/api/policies/imports/bdx" | jq .
```

For production onboarding, never single-shot a full file — use the staged-load runner described below.

## Staged Rollout

Use `tools/migrations/run_bdx_staged_load.ts` for controlled remote uploads. A repo-local starter template lives at `tools/migrations/bdx-staged-load-template.example.json`.

```bash
# Dry run against the default abbeygate endpoint
BDX_UPLOAD_FILE=true npx tsx tools/migrations/run_bdx_staged_load.ts \
  tools/migrations/bdx-staged-load-template.example.json \
  validateOnly-all
```

To generate a row-number-based template containing only locally safe rows:

```bash
npm run bdx:build-safe-template -- \
  artifacts/reporting/premium-v52-2026-03-local.xlsx \
  tmp/bdx-safe-upload-template.json
```

To generate a continuation template that keeps replayable endorsement rows even when
their `migrationCompliance.state` is `FAIL`, use the continuation mode:

```bash
npm run bdx:build-safe-template -- \
  artifacts/reporting/premium-v52-2026-03-local.xlsx \
  tmp/bdx-continue-upload-template.json \
  continue
```

The generated template now includes a `chainRows` map keyed by `policyChainKey`
(`POLICYREF::baseRowNumber`). You can target whole chains in staged-load files by
adding `policyChainKeys` to a stage instead of manually listing row numbers.

Example:

```json
{
  "name": "bindIssue-chain-proof",
  "dryRun": false,
  "batchSize": 50,
  "maxImports": 50,
  "parallelWorkers": 1,
  "policyChainKeys": ["ABLV1001638::3510", "ABLV1007568::3511"]
}
```

To report already-imported policy numbers whose base row or endorsement order no
longer matches the spreadsheet, export a mismatch report:

```bash
npm run bdx:export-history-mismatches -- \
  artifacts/reporting/premium-v52-2026-03-local.xlsx
```

For a disposable environment where you explicitly want to wipe the DB, reseed, run
the proof batch, and then run the continuation import in one pass, use:

```bash
ALLOW_DESTRUCTIVE_BDX_RERUN=1 DATABASE_URL=postgres://... \
npm run bdx:reset-rerun:disposable -- \
  --source-file artifacts/reporting/premium-v52-2026-03-local.xlsx \
  --proof-template tools/migrations/bdx-proof-batch-template.json \
  --endpoint http://127.0.0.1:3000/api/policies/imports/bdx
```

Notes:
- The script is intentionally destructive and will refuse to run unless `ALLOW_DESTRUCTIVE_BDX_RERUN=1`.
- It is intended only for disposable/local/staging-style databases, never for production.
- It defaults to the local API endpoint and seeded admin credentials, but both can be overridden with `--endpoint`, `--auth-email`, and `--auth-password`.
- It will:
  1. force-reset the database
  2. reseed it
  3. build a continuation template in `tmp/bdx-rerun-continue-template.json`
  4. run the BDX dry run
  5. run the proof staged load
  6. run the wider continuation staged load
- You can skip the proof or full pass with `--skip-proof true` or `--skip-full true`.

## Source data

The source BDX files used during onboarding are **not committed** to the repository. They contain personal policyholder data. Store them in the secure shared drive and reference them by local path.

## Adding a new BDX tool

- Co-locate it in this directory as `<purpose>.ts`
- Add a usage section to this README
- Write a corresponding test in `__tests__/<purpose>.test.ts`
