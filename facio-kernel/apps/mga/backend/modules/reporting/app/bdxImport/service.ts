import path from 'node:path';
import { readTabularRows } from '../../infra/readTabularRows.js';
import { buildQuoteDataFromDto, mapRawRowToDto } from './mapper.js';
import {
  classifyEvaluation,
  createValidationContext,
  runCalculabilityValidation,
  runCompletenessValidation,
  runReconciliationValidation,
  runStructuralValidation,
} from './validator.js';
import { isTermCreatingBdxEntry } from './types.js';
import { validateHomeBdxRow } from './productValidators/homeValidator.js';
import { validateMotorBdxRow } from './productValidators/motorValidator.js';
import { validateTravelBdxRow } from './productValidators/travelValidator.js';
import { resolveMissingBdxSlugs } from './bdxSlugResolver.js';
import { getTenantConfig } from '../../../../platform/tenant/tenantConfig.js';
import { resolveJurisdictionProductConfig, type JurisdictionProductConfig } from '../../../jurisdiction/domain/productConfiguration.js';
import type {
  BdxImportRequest,
  BdxImportResult,
  BdxRawRow,
  BdxRowEvaluation,
  BdxGap,
  BdxValidationStage,
} from './types.js';

type UnknownRecord = Record<string, unknown>;

function resolveInputPath(sourceFilePath: string): string {
  return path.isAbsolute(sourceFilePath) ? sourceFilePath : path.resolve(process.cwd(), sourceFilePath);
}

function inferProductCode(row: BdxRawRow, request: BdxImportRequest): 'MOTOR' | 'HOME' | 'TRAVEL' {
  const r = row && typeof row === 'object' ? row as UnknownRecord : {};
  const productLine = String(request.productLine || r.__productLine || '').trim().toLowerCase();
  const classOfBusiness = String(r['Class of Business'] || '').trim().toLowerCase();
  if (productLine === 'travel' || classOfBusiness === 'travel') return 'TRAVEL';
  if (productLine === 'home' || classOfBusiness === 'property') return 'HOME';
  return 'MOTOR';
}

function resolveBdxJurisdictionConfig(args: {
  row: BdxRawRow;
  request: BdxImportRequest;
  program: { id: string } | null;
}): JurisdictionProductConfig {
  const productCode = inferProductCode(args.row, args.request);
  return resolveJurisdictionProductConfig({
    productCode,
    program: args.program
      ? { id: args.program.id, productType: productCode }
      : { productType: productCode },
    tenant: getTenantConfig(),
    source: {
      tenantHost: args.request.tenantHost,
    },
  });
}

async function workbookRows(filePath: string): Promise<BdxRawRow[]> {
  return readTabularRows({ filePath, fileType: 'xlsx' });
}

function hasCellValue(row: BdxRawRow, keys: string[]): boolean {
  const record = row as UnknownRecord;
  return keys.some((key) => {
    const value = record[key];
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    return true;
  });
}

function hasPolicyIdentity(row: BdxRawRow): boolean {
  return hasCellValue(row, [
    'Policy',
    'Certificate Ref',
    'Policy or Group Ref',
  ]) || hasCellValue(row, [
    'Insured',
    'Insured First Name',
    'Insured Full Name, Last Name or Company Name',
    'Traveller 1',
    'Traveller 1 Name',
  ]);
}

function hasLifecycleDate(row: BdxRawRow): boolean {
  return hasCellValue(row, [
    'Inception',
    'Risk Inception Date',
    'Risk Trip Start Date',
    'From',
    'From Date',
    'Effective Date of Transaction',
  ]) || hasCellValue(row, [
    'Expiry',
    'Risk Expiry Date',
    'Risk Trip End Date',
    'To',
    'To Date',
    'Expiry Date of Transaction',
  ]);
}

function hasPremiumValue(row: BdxRawRow): boolean {
  return hasCellValue(row, [
    'Premium',
    'Gross Premium',
    'Total gross written premium',
    'Total Gross Written Premium',
    'Risk Gross Total Premium (ex Ipt)',
  ]);
}

// Operator BDX workbooks occasionally include header-continuation rows and
// sub-total/footnote rows that the regular blank/aggregate filter misses
// because they happen to carry a token in the Policy or Insured column.
// On the Cyprus motor BDX these surface as `Cover` cells containing literal
// header-row tokens (`Cover`, `MIF Due`, `Units`, `Premium`) or as the
// operator's free-text MIF-stamp note pasted into a data row. They fail
// downstream validation loudly (structural cover-map check) and pollute
// the failure attribution. Treat them as junk rows.
const JUNK_COVER_TOKENS = new Set(['COVER', 'MIF DUE', 'UNITS', 'PREMIUM']);

function isJunkMotorBdxRow(row: BdxRawRow): boolean {
  const record = row as UnknownRecord;
  const cover = String(record['Cover'] ?? '').trim().toUpperCase();
  if (!cover) return false;
  if (JUNK_COVER_TOKENS.has(cover)) return true;
  // Operator notes pasted into the Cover column — long sentences are never
  // valid cover-type codes (Comp / Tpo / TPF&T are at most a few chars).
  if (cover.length > 16 && /\s/.test(cover)) return true;
  return false;
}

export function isBlankBdxRow(row: BdxRawRow): boolean {
  if (isJunkMotorBdxRow(row)) return true;
  return !hasPolicyIdentity(row) && !hasLifecycleDate(row) && !hasPremiumValue(row);
}

export function isAggregateBdxRow(row: BdxRawRow): boolean {
  return !hasPolicyIdentity(row) && !hasLifecycleDate(row) && hasPremiumValue(row);
}

function toGapsByCategory(evals: BdxRowEvaluation[]): Record<BdxValidationStage, number> {
  const base: Record<BdxValidationStage, number> = {
    STRUCTURAL: 0,
    COMPLETENESS: 0,
    CALCULABILITY: 0,
    RECONCILIATION: 0,
    DOMAIN: 0,
    MAPPING: 0,
  };
  evals.forEach((e) => {
    e.gaps.forEach((g) => {
      base[g.category] += 1;
    });
  });
  return base;
}

function policyRowTimestamp(evalResult: BdxRowEvaluation): number {
  const booked = evalResult.dto.bookedDate ? new Date(evalResult.dto.bookedDate).getTime() : NaN;
  if (Number.isFinite(booked)) return booked;
  const inception = evalResult.dto.inceptionDate ? new Date(evalResult.dto.inceptionDate).getTime() : NaN;
  if (Number.isFinite(inception)) return inception;
  return evalResult.dto.sourceRowNumber;
}

function normalizeTermDate(value: string): string {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().split('T')[0] || '';
}

function buildPolicyTermKey(dto: BdxRowEvaluation['dto']): string {
  const policyRef = String(dto.policyRef || '').trim() || dto.rowKey;
  const inception = normalizeTermDate(dto.inceptionDate);
  const expiry = normalizeTermDate(dto.expiryDate);
  const booked = normalizeTermDate(dto.bookedDate);
  const term = inception && expiry ? `${inception}_${expiry}` : inception || expiry || booked || `row_${dto.sourceRowNumber}`;
  return `${policyRef}::${term}`;
}

function assignPolicyImportDispositions(evaluations: BdxRowEvaluation[]): void {
  const groups = new Map<string, BdxRowEvaluation[]>();
  for (const evaluation of evaluations) {
    const key = String(evaluation.dto.policyRef || '').trim();
    if (!key) {
      evaluation.policyImportDisposition = 'SKIP_UNGROUPED_ROW';
      continue;
    }
    const rows = groups.get(key) || [];
    rows.push(evaluation);
    groups.set(key, rows);
  }
  for (const rows of groups.values()) {
    const ordered = rows
      .slice()
      .sort((a, b) => {
        const delta = policyRowTimestamp(b) - policyRowTimestamp(a);
        if (delta !== 0) return -delta;
        return a.dto.sourceRowNumber - b.dto.sourceRowNumber;
      });
    const chainBase = ordered[0];
    const chainKey = chainBase
      ? `${String(chainBase.dto.policyRef || '').trim()}::${chainBase.dto.sourceRowNumber}`
      : '';
    ordered.forEach((evaluation, index) => {
      evaluation.dto.policyChainKey = chainKey;
      const entry = String(evaluation.dto.entry || '').trim().toUpperCase();
      // ADR-0056: a transaction line (PAM/ADJ/FIVA-PAM/CAN/NTU) never opens a
      // policy term, even when it is the earliest row we hold for the ref.
      // Marking it IMPORT_POLICY here is how bordereau adjustment lines became
      // standalone production policies in the 2026-07-30 incident.
      if (index === 0 && isTermCreatingBdxEntry(entry)) {
        evaluation.policyImportDisposition = 'IMPORT_POLICY';
        return;
      }
      evaluation.policyImportDisposition = entry === 'RNL' ? 'IMPORT_RENEWAL' : 'IMPORT_ENDORSEMENT';
    });
  }
}

function runProductValidation(dto: BdxRowEvaluation['dto']): BdxGap[] {
  if (dto.productType === 'TRAVEL') return validateTravelBdxRow(dto);
  if (dto.productType === 'HOME') return validateHomeBdxRow(dto);
  return validateMotorBdxRow(dto);
}

/**
 * Validates rows from a BDX spreadsheet against program rules and returns per-row evaluation results.
 * Called by both the dry-run scan and the live import flow.
 */
export async function evaluateBdxMigrationRows(args: {
  rows: BdxRawRow[];
  request: BdxImportRequest;
  program: { id: string } | null;
}): Promise<BdxRowEvaluation[]> {
  const { rows, request, program } = args;
  const start = request.startRow && request.startRow > 1 ? request.startRow : 2;
  const end = request.endRow && request.endRow >= start ? request.endRow : rows.length + 1;
  const ctx = createValidationContext(request.tolerances);
  const dedupe = new Set<string>();

  const evaluations: BdxRowEvaluation[] = [];
  for (let i = start - 2; i < rows.length && i <= end - 2; i += 1) {
    const sourceRow = rows[i] || {};
    const sourceRowNumber = Number((sourceRow as UnknownRecord).__sheetRowNumber) || i + 2;
    const jurisdictionConfig = resolveBdxJurisdictionConfig({ row: sourceRow, request, program });
    // Propagate `request.productLine` down to the row so the mapper's
    // dispatch sees a single canonical signal. Pre-`spine/v2` Wave 5
    // the mapper silently defaulted unknown productLine to `motor`,
    // which masked rows where neither the request nor the row carried
    // a product signal. The mapper now throws on missing productLine;
    // here we set it explicitly when the operator-supplied request
    // carries one (covers the common single-product import path).
    if (!('__productLine' in (sourceRow as UnknownRecord)) && request.productLine) {
      (sourceRow as UnknownRecord).__productLine = request.productLine;
    }
    const dto = mapRawRowToDto(sourceRow, sourceRowNumber, jurisdictionConfig);
    dto.termKey = buildPolicyTermKey(dto);
    if (!dto.policyRef && !dto.entry && !dto.insured) continue; // likely trailer row

    const slugResolution = resolveMissingBdxSlugs(dto);
    const gaps = [
      ...runStructuralValidation(dto, ctx),
      ...runCompletenessValidation(dto),
      ...runProductValidation(dto),
      ...slugResolution.gaps,
    ];
    if (dedupe.has(dto.rowKey)) {
      gaps.push({
        rowId: dto.sourceId,
        policyRef: dto.policyRef,
        category: 'STRUCTURAL',
        severity: 'Critical',
        message: `Duplicate row key '${dto.rowKey}'`,
        rootCauseHint: 'Composite key policy+sourceId+rowNumber must be unique.',
      });
    } else {
      dedupe.add(dto.rowKey);
    }

    const quoteData = buildQuoteDataFromDto(dto, jurisdictionConfig);
    const binderProductAuthorityId = request.resolveBinderProductAuthorityId
      ? await request.resolveBinderProductAuthorityId(dto)
      : String(request.binderProductAuthorityId || '').trim();
    const calculability = await runCalculabilityValidation({
      dto,
      quoteData,
      programId: String(program?.id || request.programId || '').trim(),
      binderProductAuthorityId: String(binderProductAuthorityId || '').trim(),
    });
    gaps.push(...calculability.gaps);

    let deltas = null;
    if (calculability.calculated) {
      const reconciliation = runReconciliationValidation(dto, calculability.calculated, ctx);
      gaps.push(...reconciliation.gaps);
      deltas = reconciliation.deltas;
    }

    const withoutResult: Omit<BdxRowEvaluation, 'result'> = {
      dto,
      rawRow: sourceRow,
      calculated: calculability.calculated,
      deltas,
      gaps,
      normalizedQuoteData: calculability.normalizedQuoteData,
      appliedEndorsements: calculability.appliedEndorsements,
      migrationCompliance: calculability.migrationCompliance,
      enrichment: calculability.enrichment,
      slugResolutions: slugResolution.resolutions,
    };
    evaluations.push({
      ...withoutResult,
      result: classifyEvaluation(withoutResult),
    });
  }
  assignPolicyImportDispositions(evaluations);
  return evaluations;
}

/**
 * Data import lane (operator-driven): validates and imports policy rows from a BDX-format XLSX.
 * Supports dry-run mode, row range, tolerance controls, and idempotent re-import via policy ref deduplication.
 */
export async function evaluateBdxMigrationImportRequest(args: {
  request: BdxImportRequest;
  runId: string;
  program: { id: string } | null;
}): Promise<BdxImportResult> {
  const { request, runId, program } = args;
  const sourcePath = resolveInputPath(request.sourceFilePath);
  const rows = request.fileType
    ? await readTabularRows({
        filePath: sourcePath,
        fileType: request.fileType,
        productLine: request.productLine,
        tenantSite: request.tenantHost,
      })
    : await workbookRows(sourcePath);
  const skippedBlankRows = rows.filter(isBlankBdxRow).length;
  const skippedAggregateRows = rows.filter(isAggregateBdxRow).length;
  const rowsForEvaluation = rows.filter((row) => !isBlankBdxRow(row) && !isAggregateBdxRow(row));
  const evaluations = await evaluateBdxMigrationRows({ rows: rowsForEvaluation, request, program });

  const summary = {
    totalRows: evaluations.length,
    passRows: evaluations.filter((x) => x.result === 'PASS').length,
    failRows: evaluations.filter((x) => x.result === 'FAIL').length,
    policyImportCandidateRows: evaluations.filter((x) => x.policyImportDisposition === 'IMPORT_POLICY').length,
    endorsementReplayRows: evaluations.filter((x) => x.policyImportDisposition === 'IMPORT_ENDORSEMENT').length,
    renewalReplayRows: evaluations.filter((x) => x.policyImportDisposition === 'IMPORT_RENEWAL').length,
    skippedDeltaRows: 0,
    skippedBlankRows,
    skippedAggregateRows,
    skippedSupersededRows: evaluations.filter((x) => x.policyImportDisposition === 'SKIP_UNGROUPED_ROW').length,
    importedRows: 0,
    rejectedRows: 0,
    generatedPolicyIds: [] as string[],
  };

  const avg = (values: number[]) => {
    if (!values.length) return 0;
    return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
  };
  const allDeltas = evaluations.map((x) => x.deltas).filter(Boolean) as Array<NonNullable<BdxRowEvaluation['deltas']>>;
  const allGaps: BdxGap[] = evaluations.flatMap((x) => x.gaps);
  const slugResolutions = evaluations.flatMap((x) => x.slugResolutions || []);
  const createdSlugs = slugResolutions.filter((x) => x.status === 'created');
  const missingSlugsRequiringReview = slugResolutions.filter((x) => x.status === 'requires_review');
  const failureReasonCounts: Record<string, number> = {};
  for (const gap of allGaps) {
    const key = gap.message;
    failureReasonCounts[key] = (failureReasonCounts[key] || 0) + 1;
  }
  const byCategory = (categories: BdxValidationStage[]) => allGaps.filter((g) => categories.includes(g.category));
  const enrichmentFieldCounts: Record<string, number> = {};
  const sourceCounts: Record<'bdx' | 'derived' | 'default', number> = { bdx: 0, derived: 0, default: 0 };
  for (const evaluation of evaluations) {
    for (const field of evaluation.enrichment?.filledFields || []) {
      enrichmentFieldCounts[field] = (enrichmentFieldCounts[field] || 0) + 1;
    }
    for (const source of Object.values(evaluation.enrichment?.fieldSources || {})) {
      sourceCounts[source] += 1;
    }
  }

  return {
    runId,
    dryRun: request.dryRun,
    sourceFilePath: sourcePath,
    sourceHash: request.sourceHash,
    productLine: request.productLine,
    fileType: request.fileType,
    tenantHost: request.tenantHost,
    operatingTenantId: request.operatingTenantId,
    evaluations,
    summary: {
      ...summary,
      createdSlugCount: createdSlugs.length,
      missingSlugReviewCount: missingSlugsRequiringReview.length,
      failureReasonCounts,
    },
    gapsByCategory: toGapsByCategory(evaluations),
    outputs: {
      policyCreationSummary: {
        importedPolicyIds: [],
        importedCount: 0,
        rejectedCount: summary.failRows,
      },
      reconciliationStatistics: {
        avgGrossDelta: avg(allDeltas.map((x) => x.gross)),
        avgCommissionDelta: avg(allDeltas.map((x) => x.commission)),
        avgTaxDelta: avg(allDeltas.map((x) => x.tax)),
        avgNetDelta: avg(allDeltas.map((x) => x.net)),
        avgTotalDelta: avg(allDeltas.map((x) => x.total)),
      },
      exceptionFile: evaluations
        .filter((x) => x.result === 'FAIL')
        .map((x) => ({
          rowId: x.dto.sourceId,
          policyRef: x.dto.policyRef,
          sourceSheetName: x.dto.sourceSheetName,
          sourceRowNumber: x.dto.sourceRowNumber,
          ...(x.dto.sourceMonth ? { sourceMonth: x.dto.sourceMonth } : {}),
          ...(x.dto.termKey ? { termKey: x.dto.termKey } : {}),
          result: x.result,
          primaryGap: x.gaps[0]?.message || 'Unknown failure',
        })),
      importOutcomes: evaluations.map((x) => ({
        rowId: x.dto.sourceId,
        policyRef: x.dto.policyRef,
        policyChainKey: x.dto.policyChainKey,
        sourceSheetName: x.dto.sourceSheetName,
        ...(x.dto.termKey ? { termKey: x.dto.termKey } : {}),
        ...(x.dto.sourceMonth ? { sourceMonth: x.dto.sourceMonth } : {}),
        sourceRowNumber: x.dto.sourceRowNumber,
        status: 'skipped',
      })),
      enrichmentSummary: {
        profile: 'BDX_CONTRACT_PROFILE_MOTOR',
        version: 'v2',
        filledFieldCounts: enrichmentFieldCounts,
        sourceCounts,
        createdSlugs: createdSlugs.map((x) => ({
          field: x.field,
          sourceValue: x.sourceValue,
          slug: x.slug,
          ...(x.productLine ? { productLine: x.productLine } : {}),
        })),
        missingSlugsRequiringReview: missingSlugsRequiringReview.map((x) => ({
          field: x.field,
          sourceValue: x.sourceValue,
          ...(x.productLine ? { productLine: x.productLine } : {}),
          reason: x.reason,
        })),
      },
      gapReport: {
        structural: byCategory(['STRUCTURAL', 'MAPPING']),
        rating: byCategory(['COMPLETENESS', 'CALCULABILITY']),
        reconciliation: byCategory(['RECONCILIATION']),
        domain: byCategory(['DOMAIN']),
      },
    },
  };
}
