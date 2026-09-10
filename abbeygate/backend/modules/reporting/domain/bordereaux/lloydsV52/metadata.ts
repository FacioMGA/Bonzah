// Lloyd's CRS v5.2 export-metadata builder. Produces the deterministic
// export hash, the row-identity keys, and the spec-version stamp that
// downstream consumers (the issuance ledger, the BDX worker, the
// lineage generator) anchor on.

import { createHash } from 'node:crypto';
import { normalizeProductType } from './columns.js';
import type { BordereauxStream, LloydsV52ValidationResult } from './types.js';

type UnknownRecord = Record<string, unknown>;

function rowIdentityKeyForStream(stream: BordereauxStream, row: UnknownRecord): string {
  if (stream === 'claims') {
    return [
      String(row['CR0104 Claim Reference'] || ''),
      String(row['CR0029 Certificate Reference'] || ''),
      String(row['CR0002 Reporting Period End'] || ''),
    ].join('|');
  }
  if (stream === 'premium') {
    return [
      String(row['CR0026 Policy or Group Reference'] || ''),
      String(row['CR0056 Premium Transaction Type'] || ''),
      String(row['CR0057 Effective Date of Transaction'] || ''),
    ].join('|');
  }
  return [
    String(row['CR0026 Policy or Group Reference'] || ''),
    String(row['CR0022 Risk Transaction Type'] || ''),
    String(row['CR0030 Risk Inception Date'] || ''),
  ].join('|');
}

export function buildLloydsV52ExportMetadata(args: {
  stream: BordereauxStream;
  binderId: string;
  productType: string;
  year: number;
  month: number;
  rows: UnknownRecord[];
  headers: string[];
  specVersion: string;
  ruleProfileVersion: string;
  validationSummary: LloydsV52ValidationResult;
}) {
  const productType = normalizeProductType(args.productType);
  const rowIdentity = args.rows.map((row) => rowIdentityKeyForStream(args.stream, row));
  const hashPayload = JSON.stringify({
    stream: args.stream,
    binderId: args.binderId,
    productType,
    year: args.year,
    month: args.month,
    headers: args.headers,
    rowIdentity,
    rows: args.rows,
    specVersion: args.specVersion,
    ruleProfileVersion: args.ruleProfileVersion,
  });
  const exportHash = createHash('sha256').update(hashPayload).digest('hex');
  return {
    stream: args.stream,
    productType,
    reportingTuple: {
      binderId: args.binderId,
      productType,
      year: args.year,
      month: args.month,
    },
    generatedAt: new Date().toISOString(),
    specVersion: args.specVersion,
    ruleProfileVersion: args.ruleProfileVersion,
    lineageVersion: args.specVersion,
    exportHash,
    rowCount: args.rows.length,
    rowIdentityKeys: rowIdentity,
    validationSummary: {
      errors: args.validationSummary.errors.length,
      warnings: args.validationSummary.warnings.length,
      infos: args.validationSummary.infos.length,
    },
  };
}

export function lloydsV52SpecVersionForProduct(productType: string): string {
  return `lloyds-v52-${normalizeProductType(productType).toLowerCase()}-1`;
}
