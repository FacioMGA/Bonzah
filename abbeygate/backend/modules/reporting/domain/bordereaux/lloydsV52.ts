// Lloyd's CRS v5.2 bordereaux. Composer / public surface only.
//
// The implementation lives in `./lloydsV52/` (split in PR 2.2 of the
// errors-and-warnings cleanup so each concern stays under the file-size
// cap):
//
//   types.ts           - public types and `BdxExportPreflightError`
//   csv.ts             - CSV serialiser
//   columns.ts         - per-product / per-stream column resolution
//   metadata.ts        - export-hash / row-identity / spec-version stamping
//   validation.ts      - 3-layer row validators
//   fetchRows.ts       - period-bound row fetcher
//   legacy.ts          - pre-canonical row builders (Phase 4 removal candidate)
//   internal/helpers.ts - shared helpers (NOT re-exported)
//
// XLSX generation is intentionally handled in the worker boundary
// (`backend/workers/handlers/XLSX.GENERATE_BORDEREAUX_V52.ts`).
//
// All existing consumers import from this file unchanged
// (`policy/app/reportingInterop.ts`, the BDX worker, the validation
// test harness, the bordereaux router).

export type {
  BordereauxFormat,
  BordereauxStream,
  BordereauxProductType,
  ValidationCategory,
  LloydsValidationIssue,
  LloydsV52ValidationResult,
} from './lloydsV52/types.js';
export { BdxExportPreflightError } from './lloydsV52/types.js';

export { rowsToCsv } from './lloydsV52/csv.js';

export { getDefaultHeaders } from './lloydsV52/columns.js';

export {
  buildLloydsV52ExportMetadata,
  lloydsV52SpecVersionForProduct,
} from './lloydsV52/metadata.js';

export {
  validateLloydsV52Rows,
  validateLloydsV52RowsOrThrow,
} from './lloydsV52/validation.js';

export { fetchLloydsV52BordereauxRows } from './lloydsV52/fetchRows.js';

export { buildRiskRowV52, buildPremiumRowV52 } from './lloydsV52/legacy.js';
