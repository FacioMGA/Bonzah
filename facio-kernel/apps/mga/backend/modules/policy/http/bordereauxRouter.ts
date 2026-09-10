// FacioMGA - Bordereaux API Routes (Lloyd's CRS v5.2)
// Motor-only (MOTOR) exporter for Risk / Premium / Claims streams.

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { storageService } from '../../../platform/storage/service.js';
import { addJobAndWait } from '../../../platform/events/queue.js';
import { logger } from '../../../platform/utils/logger.js';
import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { requirePermission } from '../../accessControl/http/permissionMiddleware.js';
import {
  buildLloydsV52ExportMetadata,
  fetchLloydsV52BordereauxRows,
  lloydsV52SpecVersionForProduct,
  rowsToCsv,
  validateLloydsV52Rows,
  validateLloydsV52RowsOrThrow,
  type BordereauxStream as Stream,
  type BordereauxFormat as Format,
} from '../app/reportingInterop.js';

const router = Router();

function bordereauxAuditLog(req: Request, _res: Response, next: NextFunction): void {
  try {
    const correlationId = (req.headers['x-correlation-id'] as string) || req.correlationId;
    const actionId = req.headers['x-action-id'] as string;
    const tenantId = String(req.headers['x-tenant-id'] || '').trim() || undefined;
    const textUser = req.user;
    const actorId = textUser?.id || 'system';
    const actorType = textUser?.role || 'SYSTEM';
    req.auditContext = { correlationId, actionId, tenantId, actorId, actorType };
    next();
  } catch {
    next();
  }
}

const ParamsSchema = z.object({
  stream: z.enum(['risk', 'premium', 'claims']),
});

const QuerySchema = z.object({
  binderId: z.string().trim().min(1, 'binderId is required'),
  productType: z.enum(['MOTOR', 'HOME', 'TRAVEL']),
  year: z.union([z.string(), z.number()]),
  month: z.union([z.string(), z.number()]),
  format: z.enum(['csv', 'xlsx']).optional(),
  validate: z.string().optional(),
  waiveCrs: z.string().optional(),
  waiverReasonCode: z.string().optional(),
  waiverExplanation: z.string().optional(),
  includeZeroFinancialRows: z.string().optional(),
  financialReportingType: z.enum(['TRANSACTIONAL', 'RESTATEMENT']).optional(),
  signConvention: z.enum(['POSITIVE', 'NEGATIVE']).optional(),
});

function parseWaivedCrs(raw: string | undefined) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((token) => token.trim().toUpperCase())
    .filter((token) => /^CR\d{4}$/.test(token));
}

function parseBooleanQuery(raw: unknown): boolean {
  return String(raw || '').trim().toLowerCase() === 'true';
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isZeroFinancialPremiumRow(row: Record<string, unknown>): boolean {
  const riskType = String(row['CR0022 Risk Transaction Type'] || '').trim();
  if (riskType !== 'Adjustment' && riskType !== 'Cancellation') return false;
  const keys = [
    'CR0059 Gross Premium Paid This Time',
    'CR0062 Commission Amount',
    'CR0064 Total Taxes and Levies',
    'CR0925 Total Fee Amount',
    'CR0065 Net Premium to London (Original Currency)',
    'CR0068 Net Premium to London (Settlement Currency)',
  ] as const;
  return keys.every((key) => {
    const n = asNumber(row[key]);
    return n !== null && n === 0;
  });
}

function buildRowIssueProjection(args: {
  rows: Array<Record<string, unknown>>;
  validation: { errors: Array<Record<string, unknown>>; warnings: Array<Record<string, unknown>>; infos: Array<Record<string, unknown>> };
  stream: Stream;
}) {
  const byRow = new Map<number, Array<Record<string, unknown>>>();
  const all = [...args.validation.errors, ...args.validation.warnings, ...args.validation.infos];
  for (const issue of all) {
    const rowIndex = Number(issue.row || 0);
    if (rowIndex <= 0) continue;
    const bucket = byRow.get(rowIndex) || [];
    bucket.push(issue);
    byRow.set(rowIndex, bucket);
  }

  const groupedCodes: Record<string, number> = {};
  for (const issue of all) {
    const code = String(issue.code || 'UNKNOWN');
    groupedCodes[code] = (groupedCodes[code] || 0) + 1;
  }

  const rows = args.rows.map((values, idx) => {
    const rowNumber = idx + 1;
    const issues = byRow.get(rowNumber) || [];
    const hasError = issues.some((i) => i.severity === 'error');
    const hasWarning = issues.some((i) => i.severity === 'warning');
    const status: 'valid' | 'warning' | 'error' = hasError ? 'error' : hasWarning ? 'warning' : 'valid';
    const suppressionCandidate = args.stream === 'premium' ? isZeroFinancialPremiumRow(values) : false;
    return {
      row: rowNumber,
      status,
      suppressionCandidate,
      policyRef: String(values['CR0026 Policy or Group Reference'] || ''),
      certificateRef: String(values['CR0029 Certificate Reference'] || ''),
      values,
      issues,
    };
  });

  return {
    rows,
    groupedCodes,
    summary: {
      totalRows: rows.length,
      validRows: rows.filter((row) => row.status === 'valid').length,
      warningRows: rows.filter((row) => row.status === 'warning').length,
      errorRows: rows.filter((row) => row.status === 'error').length,
      suppressionCandidates: rows.filter((row) => row.suppressionCandidate).length,
    },
  };
}

function isProductionValidationRequired() {
  return process.env.NODE_ENV === 'production' || String(process.env.BDX_VALIDATE_ALWAYS || '').toLowerCase() === 'true';
}

async function writeWaiverAuditLog(args: {
  req: Request;
  stream: Stream;
  binderId: string;
  year: number;
  month: number;
  waivedCrs: string[];
  reasonCode: string;
  explanation: string;
  exportHash: string;
}) {
  try {
    const user = args.req.user;
    await tenantScopedPrisma.auditAction.create({
      data: {
        actorType: user?.role || 'SYSTEM',
        actorId: user?.id || 'system',
        actorName: typeof user?.name === 'string' ? user.name : null,
        actionName: 'BDX.V52_WAIVER_APPLIED',
        entityType: 'BORDEREAUX_EXPORT',
        entityId: `${args.stream}:${args.binderId}:${args.year}-${String(args.month).padStart(2, '0')}`,
        diff: {
          waivedCrs: args.waivedCrs,
          reasonCode: args.reasonCode,
          explanation: args.explanation,
          exportHash: args.exportHash,
        },
        hash: args.exportHash,
      } as unknown as Prisma.AuditActionUncheckedCreateInput,
    });
  } catch (error) {
    logger.warn({ err: error }, 'Failed to write bordereaux waiver audit log');
  }
}

async function writeZeroRowOverrideAuditLog(args: {
  req: Request;
  stream: Stream;
  binderId: string;
  year: number;
  month: number;
  exportHash: string;
}) {
  try {
    const user = args.req.user;
    await tenantScopedPrisma.auditAction.create({
      data: {
        actorType: user?.role || 'SYSTEM',
        actorId: user?.id || 'system',
        actorName: typeof user?.name === 'string' ? user.name : null,
        actionName: 'BDX.V52_ZERO_ROW_OVERRIDE_APPLIED',
        entityType: 'BORDEREAUX_EXPORT',
        entityId: `${args.stream}:${args.binderId}:${args.year}-${String(args.month).padStart(2, '0')}`,
        diff: {
          includeZeroFinancialRows: true,
          exportHash: args.exportHash,
        },
        hash: args.exportHash,
      } as unknown as Prisma.AuditActionUncheckedCreateInput,
    });
  } catch (error) {
    logger.warn({ err: error }, 'Failed to write zero-row override audit log');
  }
}

async function writeExportAuditLog(args: {
  req: Request;
  stream: Stream;
  binderId: string;
  year: number;
  month: number;
  exportHash: string;
  validationSummary: { errors: number; warnings: number; infos: number };
}) {
  try {
    const user = args.req.user;
    await tenantScopedPrisma.auditAction.create({
      data: {
        actorType: user?.role || 'SYSTEM',
        actorId: user?.id || 'system',
        actorName: typeof user?.name === 'string' ? user.name : null,
        actionName: 'BDX.V52_EXPORT_GENERATED',
        entityType: 'BORDEREAUX_EXPORT',
        entityId: `${args.stream}:${args.binderId}:${args.year}-${String(args.month).padStart(2, '0')}`,
        diff: {
          exportHash: args.exportHash,
          validationSummary: args.validationSummary,
        },
        hash: args.exportHash,
      } as unknown as Prisma.AuditActionUncheckedCreateInput,
    });
  } catch (error) {
    logger.warn({ err: error }, 'Failed to write bordereaux export audit log');
  }
}

function parseQueryInt(v: unknown, name: string) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${name}`);
  return Math.floor(n);
}

function preflightErrorPayload(error: unknown): { status: number; code: string; message: string } | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  const code = String(record.code || '');
  const name = String(record.name || '');
  if (name === 'BdxExportPreflightError' || code === 'PROGRAM_BINDER_NOT_ALLOWED') {
    return {
      status: Number(record.status || 422),
      code: code || 'BDX_PREFLIGHT_FAILED',
      message: error instanceof Error ? error.message : 'BDX export preflight failed',
    };
  }
  return null;
}

// Lloyd's monthly reporting lane (user-operated): CRS v5.2 Risk/Premium/Claims export.
router.get('/v5.2/:stream/preview', bordereauxAuditLog, async (req, res) => {
  const startedAt = Date.now();
  try {
    const params = ParamsSchema.parse(req.params);
    const query = QuerySchema.parse(req.query);
    const stream = params.stream as Stream;
    const binderId = query.binderId;
    const productType = query.productType;
    const year = parseQueryInt(query.year, 'year');
    const month = parseQueryInt(query.month, 'month');
    logger.info({ event: 'bdx.preview.start', stream, binderId, productType, year, month }, 'bdx.preview.start');
    const waivedCrs = parseWaivedCrs(query.waiveCrs);

    const { rows, defaultHeaders } = await fetchLloydsV52BordereauxRows({
      binderId,
      year,
      month,
      stream,
      productCode: productType,
      financialReportingType: query.financialReportingType,
      signConvention: query.signConvention,
    });
    const validation = validateLloydsV52Rows(stream, rows, undefined, productType);
    const errorsAfterWaiver = validation.errors.filter((issue) => !issue.crCode || !waivedCrs.includes(issue.crCode.toUpperCase()));
    const projection = buildRowIssueProjection({
      rows: rows as Array<Record<string, unknown>>,
      validation,
      stream,
    });
    return res.json({
      success: true,
      data: {
        stream,
        binderId,
        productType,
        year,
        month,
        headers: defaultHeaders,
        rows: projection.rows,
        issues: {
          errors: validation.errors,
          warnings: validation.warnings,
          infos: validation.infos,
        },
        groupedIssueCounts: projection.groupedCodes,
        summary: projection.summary,
        blocking: errorsAfterWaiver.length > 0,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: error.issues[0]?.message || 'Invalid request' } });
    }
    const preflight = preflightErrorPayload(error);
    if (preflight) {
      return res.status(preflight.status).json({ success: false, error: { code: preflight.code, message: preflight.message } });
    }
    logger.error({ event: 'bdx.preview.failed', durationMs: Date.now() - startedAt, err: error }, 'bdx.preview.failed');
    return res.status(500).json({ success: false, error: { code: 'PREVIEW_FAILED', message: error instanceof Error ? error.message : 'Preview failed' } });
  }
});

// Lloyd's monthly reporting lane (user-operated): CRS v5.2 Risk/Premium/Claims export.
router.get('/v5.2/:stream', bordereauxAuditLog, requirePermission('reports', 'export'), async (req, res) => {
  const startedAt = Date.now();
  try {
    const params = ParamsSchema.parse(req.params);
    const query = QuerySchema.parse(req.query);
    const stream = params.stream as Stream;
    const binderId = query.binderId;
    const productType = query.productType;
    const year = parseQueryInt(query.year, 'year');
    const month = parseQueryInt(query.month, 'month');
    const format = (query.format || 'csv') as Format;
    const validateRequested = String(query.validate || '').toLowerCase() === 'true';
    const validate = isProductionValidationRequired() || validateRequested;
    const includeZeroFinancialRows = parseBooleanQuery(query.includeZeroFinancialRows);
    const suppressZeroFinancialRows = stream === 'premium' && !includeZeroFinancialRows;
    const waivedCrs = parseWaivedCrs(query.waiveCrs);
    const waiverReasonCode = String(query.waiverReasonCode || '').trim().toUpperCase();
    const waiverExplanation = String(query.waiverExplanation || '').trim();
    logger.info({ event: 'bdx.export.start', stream, binderId, productType, year, month, format }, 'bdx.export.start');

    const { rows, defaultHeaders } = await fetchLloydsV52BordereauxRows({
      binderId,
      year,
      month,
      stream,
      productCode: productType,
      financialReportingType: query.financialReportingType,
      signConvention: query.signConvention,
    });

    const filenameBase = `lloyds_v5.2_${productType.toLowerCase()}_${stream}_${year}-${String(month).padStart(2, '0')}`;

    const validation = validateLloydsV52Rows(stream, rows, undefined, productType);
    const errorsAfterWaiver = validation.errors.filter((issue) => !issue.crCode || !waivedCrs.includes(issue.crCode.toUpperCase()));

    const wantsWaiver = waivedCrs.length > 0;
    if (includeZeroFinancialRows) {
      const userRole = String(req.user?.role || '').toUpperCase();
      const isAdmin = userRole === 'ADMIN' || userRole === 'SYSTEM';
      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          error: { code: 'ZERO_ROW_OVERRIDE_NOT_AUTHORIZED', message: 'Only admin/system users can include zero-financial rows in final export.' },
        });
      }
    }
    if (wantsWaiver) {
      const userRole = String(req.user?.role || '').toUpperCase();
      const isAdmin = userRole === 'ADMIN' || userRole === 'SYSTEM';
      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          error: { code: 'WAIVER_NOT_AUTHORIZED', message: 'Only admin/system users can apply CR waivers.' },
        });
      }
      if (!waiverReasonCode || !waiverExplanation) {
        return res.status(400).json({
          success: false,
          error: { code: 'WAIVER_REASON_REQUIRED', message: 'waiverReasonCode and waiverExplanation are required when waiveCrs is used.' },
        });
      }
    }

    if (validate && rows.length > 0 && errorsAfterWaiver.length > 0) {
      try {
        validateLloydsV52RowsOrThrow(stream, rows, undefined, productType);
      } catch (e: unknown) {
        logger.warn({
          event: 'bdx.export.validation_failed',
          stream,
          binderId,
          year,
          month,
          validationErrorCount: errorsAfterWaiver.length,
        }, 'bdx.export.validation_failed');
        const details = e && typeof e === 'object' && 'details' in e ? e.details : validation;
        return res.status(422).json({
          success: false,
          error: {
            code: e && typeof e === 'object' && 'code' in e && typeof e.code === 'string' ? e.code : 'CRS_VALIDATION_FAILED',
            message: e instanceof Error ? e.message : 'Lloyd’s CRS v5.2 validation failed',
            details,
          },
        });
      }
    }

    const rowsForExport = suppressZeroFinancialRows
      ? rows.filter((row) => !isZeroFinancialPremiumRow(row as Record<string, unknown>))
      : rows;
    const suppressedZeroRows = rows.length - rowsForExport.length;

    const exportMetadata = buildLloydsV52ExportMetadata({
      stream,
      binderId,
      productType,
      year,
      month,
      rows: rowsForExport,
      headers: defaultHeaders as string[],
      specVersion: lloydsV52SpecVersionForProduct(productType),
      ruleProfileVersion: 'default-v1',
      validationSummary: {
        errors: errorsAfterWaiver,
        warnings: validation.warnings,
        infos: validation.infos,
      },
    });

    if (wantsWaiver && errorsAfterWaiver.length === 0) {
      await writeWaiverAuditLog({
        req,
        stream,
        binderId,
        year,
        month,
        waivedCrs,
        reasonCode: waiverReasonCode,
        explanation: waiverExplanation,
        exportHash: exportMetadata.exportHash,
      });
    }
    if (includeZeroFinancialRows && stream === 'premium') {
      await writeZeroRowOverrideAuditLog({
        req,
        stream,
        binderId,
        year,
        month,
        exportHash: exportMetadata.exportHash,
      });
    }
    await writeExportAuditLog({
      req,
      stream,
      binderId,
      year,
      month,
      exportHash: exportMetadata.exportHash,
      validationSummary: exportMetadata.validationSummary,
    });

    if (format === 'xlsx') {
      // Heavy XLSX generation is isolated in the worker boundary (prevents DoS and keeps API image slim).
      let out: { filename: string; url: string };
      try {
        out = await addJobAndWait<{ filename: string; url: string }>(
          'XLSX.GENERATE_BORDEREAUX_V52',
          {
            binderId,
            year,
            month,
            stream,
            productType,
            filenameBase,
            validate: true,
            includeZeroFinancialRows,
            exportHash: exportMetadata.exportHash,
            correlationId: req.correlationId,
          },
          { timeoutMs: 180_000 }
        );
        logger.info({
          event: 'bdx.export.queued',
          stream,
          binderId,
          productType,
          year,
          month,
          format,
          rowCount: rowsForExport.length,
          exportHash: exportMetadata.exportHash,
          suppressedZeroRows,
        }, 'bdx.export.queued');
      } catch (e: unknown) {
        logger.error({
          event: 'bdx.export.worker_unavailable',
          stream,
          binderId,
          productType,
          year,
          month,
          format,
          durationMs: Date.now() - startedAt,
          err: e,
        }, 'bdx.export.worker_unavailable');
        return res.status(503).json({
          success: false,
          error: { code: 'XLSX_WORKER_UNAVAILABLE', message: e instanceof Error ? e.message : 'XLSX worker unavailable. Try CSV or retry shortly.' },
        });
      }

      const storedName = String(out?.filename || '');
      const streamOut = storedName ? await storageService.getFileStream(storedName) : null;
      if (!streamOut) {
        logger.error({
          event: 'bdx.export.stream_failed',
          stream,
          binderId,
          year,
          month,
          format,
          filename: storedName,
        }, 'bdx.export.stream_failed');
        return res.status(500).json({ success: false, error: { code: 'XLSX_STREAM_FAILED', message: 'Failed to load generated XLSX from storage.' } });
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
      res.setHeader('X-BDX-Export-Hash', exportMetadata.exportHash);
      res.setHeader('X-BDX-ZeroRows-Suppressed', String(suppressedZeroRows));
      logger.info({
        event: 'bdx.export.completed',
        stream,
        binderId,
        year,
        month,
        format,
        rowCount: rowsForExport.length,
        exportHash: exportMetadata.exportHash,
        suppressedZeroRows,
        durationMs: Date.now() - startedAt,
      }, 'bdx.export.completed');
      return streamOut.pipe(res);
    }

    const csv = rowsToCsv(rowsForExport, defaultHeaders as string[]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
    res.setHeader('X-BDX-Export-Hash', exportMetadata.exportHash);
    res.setHeader('X-BDX-ZeroRows-Suppressed', String(suppressedZeroRows));
    logger.info({
      event: 'bdx.export.completed',
      stream,
      binderId,
      year,
      month,
      format,
      rowCount: rowsForExport.length,
      exportHash: exportMetadata.exportHash,
      suppressedZeroRows,
      durationMs: Date.now() - startedAt,
    }, 'bdx.export.completed');
    return res.send(csv);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: error.issues[0]?.message || 'Invalid request' } });
    }
    const preflight = preflightErrorPayload(error);
    if (preflight) {
      return res.status(preflight.status).json({ success: false, error: { code: preflight.code, message: preflight.message } });
    }
    logger.error({ event: 'bdx.export.failed', durationMs: Date.now() - startedAt, err: error }, 'bdx.export.failed');
    return res.status(500).json({ success: false, error: { code: 'EXPORT_FAILED', message: error instanceof Error ? error.message : 'Export failed' } });
  }
});

export default router;

