// Lloyd's Coverholder Reporting Standards (CRS) v5.2 - Motor (MOTOR).
// Composer / public surface only.
//
// The implementation lives in `./crsV52Motor/` (split in PR 2.3a of
// the errors-and-warnings cleanup so each concern stays under the
// file-size cap):
//
//   types.ts            - Csr* + RiskRowCtx / PremiumRowCtx / ClaimsRowCtx
//   helpers.ts          - row-context helpers (toISODate, derived values, etc.)
//   riskColumns.ts      - CRS_V52_MOTOR_RISK_COLUMNS canonical table
//   premiumColumns.ts   - CRS_V52_MOTOR_PREMIUM_COLUMNS canonical table
//   claimsColumns.ts    - CRS_V52_MOTOR_CLAIMS_COLUMNS canonical table
//   buildRow.ts         - generic row builder + simple required-only validator
//
// Existing consumers (crsV52Home, crsV52Travel, bordereaux/lloydsV52,
// the lineage generator, crsApplicabilityPolicy) import from this
// file unchanged.

export type {
  CsrStream,
  CsrRequiredness,
  CsrValidationSeverity,
  CsrSourceReliability,
  CsrSourceKind,
  CsrColumnSpec,
  RiskRowCtx,
  PremiumRowCtx,
  ClaimsRowCtx,
} from './crsV52Motor/types.js';

export { toISODate } from './crsV52Motor/helpers.js';

export { CRS_V52_MOTOR_RISK_COLUMNS } from './crsV52Motor/riskColumns.js';
export { CRS_V52_MOTOR_PREMIUM_COLUMNS } from './crsV52Motor/premiumColumns.js';
export { CRS_V52_MOTOR_CLAIMS_COLUMNS } from './crsV52Motor/claimsColumns.js';

export { buildRow, validateRow } from './crsV52Motor/buildRow.js';
