// Lloyd's CRS v5.2 — generic row builder + simple required-only validator.
// Stream/product-specific validation lives in
// `bordereaux/lloydsV52/validation.ts`.

import type { CsrColumnSpec } from './types.js';
import { isMandatory } from './helpers.js';

export function buildRow<RowCtx>(cols: Array<CsrColumnSpec<RowCtx>>, ctx: RowCtx) {
  const row: Record<string, unknown> = {};
  for (const col of cols) row[col.title] = col.get(ctx);
  return row;
}

export function validateRow<RowCtx>(cols: Array<CsrColumnSpec<RowCtx>>, row: Record<string, unknown>) {
  const missing: string[] = [];
  for (const col of cols) {
    if (!isMandatory(col)) continue;
    const v = row[col.title];
    if (v === null || v === undefined || String(v).trim() === '') missing.push(col.title);
  }
  return missing;
}
