# Reporting Module — BDX Export & Import

This module owns **two distinct flows** that both touch BDX (Bordereaux)
but have different purposes, audiences, and life-cycles. **Do not
conflate them.**

| Direction | Purpose | Audience | Code root |
|-----------|---------|----------|-----------|
| **EXPORT** (outbound) | Generate Lloyd's CRS v5.2 bordereaux XLSX files for the binder / regulator. Recurring monthly. | BO reporting users. | `domain/bordereaux/` + `domain/crsV52*.ts` + worker `XLSX.GENERATE_BORDEREAUX_V52` |
| **IMPORT** (inbound) | One-off prospect data migration — load a prospect's legacy BDX rows into our system. Per onboarding. | Platform engineers + onboarding ops. | `app/bdxImport/` + worker `BDX.IMPORT_JOB` + tools in `tools/bdx/` |

Both flows resolve `JurisdictionProductConfig` through the canonical
resolver. See
[`docs/architecture/contracts/jurisdiction-product-config.md`](../../../docs/architecture/contracts/jurisdiction-product-config.md).
Country defaults, tax profiles, wording, and BDX `importDefaults` come
from there. Export mapping lives in the per-product column spec
(`crsV52<Product>.ts`); the jurisdiction config no longer carries an
`exportMapping` stub. **Never hardcode a jurisdiction in a mapper or
column resolver.**

## Wiring a new BDX EXPORT (per product)

The Lloyd's V52 export currently supports `MOTOR`. To add `HOME` or
`TRAVEL` (or any future product):

1. **Define product columns.** Create `domain/crsV52<Product>.ts` modelled
   on `domain/crsV52Motor.ts`. Export
   `CRS_V52_<PRODUCT>_RISK_COLUMNS`, `..._PREMIUM_COLUMNS`,
   `..._CLAIMS_COLUMNS`. Each entry is a `CsrColumnSpec` with `key`,
   `title`, `crCode`, `requiredness`, `sourcePath` (over `quoteData`,
   `Policy`, or `RiskTransaction`), and `derivationRule` if computed.
2. **Wire the column resolver.** Edit `domain/bordereaux/lloydsV52.ts`.
   `defaultHeadersForStream` and `buildRow` (and `fetchLloydsV52BordereauxRows`)
   switch on `productCode` to pick the right column set. Today they
   hardcode the `MOTOR` set — extend to dispatch by product.
3. **Mapping lives in the column spec, not jurisdiction config.** The
   `bdxConfig.exportMapping` stub was deleted in `spine/v2` Wave 5;
   reporting reads its mapping straight from `crsV52<Product>.ts`.
   Country-specific overlays (assistance phone, wording, premium row
   ordering) come from `documentConfig`/`greenCardConfig` in
   `productConfiguration.ts`.
4. **Add a golden reconciliation test** under
   `domain/bordereaux/__tests__/lloydsV52.<product>.validation.test.ts`.
   Fixture is a known XLSX in `artifacts/reporting/`. Asserts row count,
   header order, and `validateLloydsV52RowsOrThrow` passes per stream.
   Wire it into a `test:bdx-export-<product>` `package.json` script and
   call it from `tools/quality/agent-gate.sh` so CI gates regressions.
5. **Document the lineage.** Add
   `docs/architecture/baselines/lloyds-v52-<product>-spec.json` +
   `lloyds-v52-<product>-lineage.csv`. These are generated — edit the
   generator at `tools/quality/generateLloydsV52LineageArtifacts.ts`,
   then `npm run docs:generate`.
6. **No worker changes needed.** `XLSX.GENERATE_BORDEREAUX_V52` already
   iterates per `productCode` via `BinderProductAuthority`. Once the
   columns + resolver exist, the worker dispatches automatically.

## Wiring a new BDX IMPORT (per product or per prospect format)

To onboard prospect BDX data for a new product, or to support a new
dialect of an existing product's BDX format:

1. **Add a per-product mapper.** Create
   `app/bdxImport/productMappers/<product>Mapper.ts` modelled on
   `motorMapper.ts`. Input: parsed BDX row + `JurisdictionProductConfig`.
   Output: partial `EnrichedQuoteData`. **Produce the canonical shape
   from what the prospect actually provided. Do not silently default
   missing fields** — let downstream validation reject incomplete rows.
   (Rationale: deletion of the `setIfMissing` chain in `spine/v2`
   Wave 5 — silent defaults masked corrupt prospect data and produced
   plausible-looking but garbage policies.)
2. **Add a per-product validator.** Create
   `app/bdxImport/productValidators/<product>Validator.ts` modelled on
   `motorValidator.ts`. Encode every field the new product requires
   for `evaluateIssueReadiness` to pass.
3. **Register both.** Add the new product to:
   - `app/bdxImport/mapper.ts` → `mapRawRowToDto` (dispatches the row →
     DTO mapping by `productCode`).
   - `app/bdxImport/service.ts` → the validation dispatch (around the
     `dto.productType === 'TRAVEL' / 'HOME'` chain). When a fourth
     product appears, refactor both to a lookup table — the if-chain
     is the next deletion target on the product axis.
4. **Add `importDefaults`** for each `(country, product)` pair in
   `backend/modules/jurisdiction/domain/productConfiguration.ts`. This
   is the only legitimate place for jurisdiction-specific BDX defaults.
5. **Add a fixture-based test** under
   `app/bdxImport/__tests__/<product>.import.test.ts`. Cases must
   cover: happy-path mapping, missing-required-field rejection,
   duplicate `policyRef` detection, `dryRun: true` round-trip.
6. **Run a `dryRun: true` import** before any production commit. The engine
   reports duplicates, field coverage, and per-row migration-compliance state
   in a single response. See `tools/bdx/README.md` for the full operator
   playbook.
7. **Use staged-load** for production onboarding:
   `tools/migrations/run_bdx_staged_load.ts` with a template under
   `tools/migrations/`. Never single-shot a full prospect file.

## Guardrails (non-negotiable)

- **One canonical export path:** `bordereauxRouter` →
  `fetchLloydsV52BordereauxRows` → `XLSX.GENERATE_BORDEREAUX_V52`.
  No alternate routes, no compatibility aliases, no parallel generators.
- **One canonical import path per product:** per-product mapper +
  validator, dispatched by `app/bdxImport/service.ts`. No country
  `if`-branches inside mappers.
- **All BDX defaults live in `bdxConfig`** (per jurisdiction), never
  inline in mapper or export code.
- **Missing jurisdiction config throws** `ProductConfigurationError`
  (loud-fail). Do not catch and default.
- **Do not silently fill missing prospect data** in import. Validation
  must reject incomplete rows; the prospect cleans their input.
- **Reconcile financially.** Motor BDX is gated by
  `npm run test:bdx-import`. Any new `(country, product)` pair must add
  its own golden reconciliation test before going live — for export,
  add a `test:bdx-export-<product>` script and wire it into
  `tools/quality/agent-gate.sh`; for import, extend the existing
  `test:bdx-import` fixture set.

## Reference

- `docs/architecture/contracts/jurisdiction-product-config.md` —
  binding config contract.
- `docs/architecture/baselines/lloyds-v52-motor-spec.json` — column
  lineage spec (generated).
- `tools/bdx/README.md` — operator pre-flight + staged-load tools.
- `backend/modules/reporting/docs/bdx-export-inventory.md` — current
  export-side file inventory.
