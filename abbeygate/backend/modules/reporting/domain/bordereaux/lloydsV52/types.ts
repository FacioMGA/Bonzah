// Lloyd's CRS v5.2 bordereaux — public types and the preflight error class.
// Extracted from `../lloydsV52.ts` in PR 2.2 of the errors-and-warnings
// cleanup so the composer file stays under the file-size cap.

import type { CsrValidationSeverity } from '../../crsV52Motor.js';

export type BordereauxFormat = 'csv' | 'xlsx';
export type BordereauxStream = 'risk' | 'premium' | 'claims';
export type BordereauxProductType = 'MOTOR' | 'HOME' | 'TRAVEL';

export type ValidationCategory = 'STRUCTURE' | 'APPLICABILITY' | 'SEMANTIC';

export type LloydsValidationIssue = {
  row: number;
  category: ValidationCategory;
  code: string;
  severity: CsrValidationSeverity;
  field?: string;
  crCode?: string;
  message: string;
  sourcePath?: string;
};

export type LloydsV52ValidationResult = {
  errors: LloydsValidationIssue[];
  warnings: LloydsValidationIssue[];
  infos: LloydsValidationIssue[];
};

export class BdxExportPreflightError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = 'BdxExportPreflightError';
    this.code = code;
    this.status = status;
  }
}
