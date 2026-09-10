// Per-product / per-stream column resolution for Lloyd's CRS v5.2.
// The actual column tables live in `../crsV52{Motor,Home,Travel}.ts`
// (one file per product) — this module is the dispatcher.

import {
  CRS_V52_MOTOR_CLAIMS_COLUMNS,
  CRS_V52_MOTOR_PREMIUM_COLUMNS,
  CRS_V52_MOTOR_RISK_COLUMNS,
  type CsrColumnSpec,
  buildRow,
} from '../../crsV52Motor.js';
import {
  CRS_V52_HOME_CLAIMS_COLUMNS,
  CRS_V52_HOME_PREMIUM_COLUMNS,
  CRS_V52_HOME_RISK_COLUMNS,
} from '../../crsV52Home.js';
import {
  CRS_V52_TRAVEL_CLAIMS_COLUMNS,
  CRS_V52_TRAVEL_PREMIUM_COLUMNS,
  CRS_V52_TRAVEL_RISK_COLUMNS,
} from '../../crsV52Travel.js';
import { BdxExportPreflightError, type BordereauxProductType, type BordereauxStream } from './types.js';

export function normalizeProductType(productType: string): BordereauxProductType {
  const normalized = String(productType || '').trim().toUpperCase();
  if (normalized === 'MOTOR' || normalized === 'HOME' || normalized === 'TRAVEL') return normalized;
  throw new BdxExportPreflightError(
    'BDX_PRODUCT_UNSUPPORTED',
    `BDX export does not support product type ${normalized || 'EMPTY'}.`,
    422,
  );
}

export function getColumnsForStream(
  stream: BordereauxStream,
  productType: string = 'MOTOR',
): Array<CsrColumnSpec<unknown>> {
  const product = normalizeProductType(productType);
  if (product === 'HOME') {
    const cols = stream === 'risk'
      ? CRS_V52_HOME_RISK_COLUMNS
      : stream === 'premium'
        ? CRS_V52_HOME_PREMIUM_COLUMNS
        : CRS_V52_HOME_CLAIMS_COLUMNS;
    return cols as Array<CsrColumnSpec<unknown>>;
  }
  if (product === 'TRAVEL') {
    const cols = stream === 'risk'
      ? CRS_V52_TRAVEL_RISK_COLUMNS
      : stream === 'premium'
        ? CRS_V52_TRAVEL_PREMIUM_COLUMNS
        : CRS_V52_TRAVEL_CLAIMS_COLUMNS;
    return cols as Array<CsrColumnSpec<unknown>>;
  }
  const cols = stream === 'risk'
    ? CRS_V52_MOTOR_RISK_COLUMNS
    : stream === 'premium'
      ? CRS_V52_MOTOR_PREMIUM_COLUMNS
      : CRS_V52_MOTOR_CLAIMS_COLUMNS;
  return cols as Array<CsrColumnSpec<unknown>>;
}

export function getDefaultHeaders(stream: BordereauxStream, productType: string = 'MOTOR') {
  return getColumnsForStream(stream, productType).map((c) => c.title);
}

export function buildSelectedProductRow(
  cols: Array<CsrColumnSpec<unknown>>,
  ctx: unknown,
): Record<string, unknown> {
  return buildRow(cols, ctx);
}
