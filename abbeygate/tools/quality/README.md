# tools/quality

This folder contains the quality guards wired into `npm` scripts and CI. Every file here must be reachable from one of:

- a script in [`package.json`](../../package.json) (e.g. `guard:*`, `gate:*`, `docs:generate:check`, `contract:generate:check`)
- `npm run gate:ci`, which is invoked by [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
- another guard in this folder

If you need an ad-hoc Prisma probe, a one-off backfill, or a debug helper, put it under [`backend/scripts/`](../../backend/scripts/) with a documented `npm run` target. Do not park scratch files here — guard inventories assume every entry is enforced.

The `aks/` and `perf/` subfolders host operational checks (deploy preflights, Lighthouse, etc.); the `tests/` subfolder holds harnesses that are invoked by guards above. Generators (e.g. [`generateValidationContractArtifacts.ts`](generateValidationContractArtifacts.ts)) write into `packages/products/src/*/generated/` and `docs/reference/`; never hand-edit their outputs.

Guard inventory is generated into [`docs/reference/guards.md`](../../docs/reference/guards.md). Run `npm run docs:generate` after adding or removing a guard.
