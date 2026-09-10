import { Router } from 'express';
import type { NextFunction } from 'express';
import { z } from 'zod';

import { typedHandler, type BoundaryRequest, type BoundaryResponse } from '../../../../platform/http/typedHandler.js';
import { requirePermission } from '../../../accessControl/http/permissionMiddleware.js';
import {
  hasEffectivePermission,
  resolveEffectivePermissionsForUser,
} from '../../../accessControl/app/permissionService.js';
import { requiredPermissionForPolicyAssignment } from '../../../accessControl/app/namedOperatorRoles.js';
import {
  assignPolicyToStaff,
  PolicyAssignmentStaffTargetInvalidError,
  PolicyAssignmentTargetMissingError,
  getAuditReport,
  getCashSheetReport,
  getCyprusDemographicReport,
  getDebtorsReport,
  getDnoReport,
  getOfficeTargetReport,
  getOriginConversionReport,
  rowsToReportCsv,
  saveOfficeStaffTarget,
  saveOfficeTargetBundle,
  type AuditReportFilters,
  type PolicyReportFilters,
  type ReportDateBasis,
} from '../../../reporting/app/boOperationalReports.js';
import { reportsAuditLog } from './dashboardHelpers.js';

const router = Router();

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').optional();
const DateBasisSchema = z.enum(['createdAt', 'inceptionDate', 'issuedAt']).optional();
const FormatSchema = z.enum(['json', 'csv']).optional();

function startNotAfterEnd<T extends { start?: string; end?: string }>(data: T, ctx: z.RefinementCtx): void {
  if (data.start && data.end && data.start > data.end) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'start date must be on or before end date',
      path: ['start'],
    });
  }
}

const PolicyReportQueryObjectSchema = z.object({
  start: IsoDateSchema,
  end: IsoDateSchema,
  dateBasis: DateBasisSchema,
  programId: z.string().trim().min(1).optional(),
  productType: z.string().trim().min(1).optional(),
  operatingTenantId: z.string().trim().min(1).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  format: FormatSchema,
}).strict();

const PolicyReportQuerySchema = PolicyReportQueryObjectSchema.superRefine(startNotAfterEnd);

// Zod 4: `.omit()` throws on schemas that already have refinements.
// Staging CrashLoop (AKS Deploy Staging, SHA d090b8ceca9d):
// `.omit() cannot be used on object schemas containing refinements`
// at operationalReportsRouter boot. Omit on the object, then refine.
const PolicyReportCsvQuerySchema = PolicyReportQueryObjectSchema
  .omit({ format: true })
  .superRefine(startNotAfterEnd);

const AuditReportQuerySchema = z.object({
  start: IsoDateSchema,
  end: IsoDateSchema,
  actorId: z.string().trim().min(1).optional(),
  entityType: z.string().trim().min(1).optional(),
  actionPrefix: z.string().trim().min(1).optional(),
  changedOnly: z.enum(['true', 'false']).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  format: FormatSchema,
}).strict().superRefine(startNotAfterEnd);

const OfficeTargetBundleBodySchema = z.object({
  productCode: z.string().trim().min(1).optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  newBusiness: z.object({
    premiumTarget: z.number().nonnegative(),
    policyCountTarget: z.number().int().nonnegative(),
  }),
  renewal: z.object({
    premiumTarget: z.number().nonnegative(),
    policyCountTarget: z.number().int().nonnegative(),
  }),
}).strict().superRefine((data, ctx) => {
  if (data.periodStart > data.periodEnd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'periodStart must be on or before periodEnd',
      path: ['periodStart'],
    });
  }
});

const OfficeTargetBodySchema = z.object({
  scope: z.enum(['OFFICE', 'STAFF']),
  businessCategory: z.enum(['NEW_BUSINESS', 'RENEWAL']).optional(),
  userId: z.string().trim().min(1).optional(),
  productCode: z.string().trim().min(1).optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  premiumTarget: z.number().nonnegative(),
  policyCountTarget: z.number().int().nonnegative(),
  conversionTarget: z.number().min(0).max(1).optional(),
}).strict().superRefine((data, ctx) => {
  if (data.periodStart > data.periodEnd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'periodStart must be on or before periodEnd',
      path: ['periodStart'],
    });
  }
});

const AssignPolicyBodySchema = z.object({
  policyId: z.string().trim().min(1),
  assignedToUserId: z.string().trim().min(1),
}).strict();

function parseDate(value: string | undefined, bound: 'start' | 'end'): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map((part) => Number(part));
  const h = bound === 'end' ? 23 : 0;
  const m = bound === 'end' ? 59 : 0;
  const s = bound === 'end' ? 59 : 0;
  const ms = bound === 'end' ? 999 : 0;
  return new Date(Date.UTC(year, month - 1, day, h, m, s, ms));
}

function numberFromQuery(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function policyFilters(query: z.infer<typeof PolicyReportQueryObjectSchema>): PolicyReportFilters {
  return {
    start: parseDate(query.start, 'start'),
    end: parseDate(query.end, 'end'),
    dateBasis: (query.dateBasis || 'inceptionDate') as ReportDateBasis,
    programId: query.programId || null,
    productType: query.productType ? query.productType.toUpperCase() : null,
    operatingTenantId: query.operatingTenantId || null,
    limit: numberFromQuery(query.limit),
  };
}

function auditFilters(query: z.infer<typeof AuditReportQuerySchema>, viewOnly: boolean): AuditReportFilters {
  return {
    start: parseDate(query.start, 'start'),
    end: parseDate(query.end, 'end'),
    actorId: query.actorId || null,
    entityType: query.entityType || null,
    actionPrefix: query.actionPrefix || null,
    changedOnly: query.changedOnly === 'true',
    viewOnly,
    limit: numberFromQuery(query.limit),
  };
}

function requireCsvExportPermission(req: BoundaryRequest, res: BoundaryResponse, next: NextFunction): void {
  if (String(req.query.format || '').toLowerCase() !== 'csv') {
    next();
    return;
  }
  void requirePermission('reports', 'export')(req, res, next);
}

function sendCsv(res: BoundaryResponse, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

router.get(
  '/cash-sheet',
  reportsAuditLog,
  requireCsvExportPermission,
  typedHandler({ query: PolicyReportQuerySchema }, async (req, res) => {
    const report = await getCashSheetReport(policyFilters(req.query));
    if (req.query.format === 'csv') {
      const headers = [
        'policyNumber',
        'insuredName',
        'productType',
        'status',
        'boStatus',
        'operatingTenantId',
        'date',
        'totalPremium',
        'outstandingBalance',
        'invoiceOverdue',
      ];
      sendCsv(res, 'cash-sheet.csv', rowsToReportCsv(report.items, headers));
      return;
    }
    res.json({ success: true, data: report });
  }),
);

router.get(
  '/cash-sheet.csv',
  reportsAuditLog,
  requirePermission('reports', 'export'),
  typedHandler({ query: PolicyReportCsvQuerySchema }, async (req, res) => {
    const report = await getCashSheetReport(policyFilters(req.query));
    const headers = [
      'policyNumber',
      'insuredName',
      'productType',
      'status',
      'boStatus',
      'operatingTenantId',
      'date',
      'totalPremium',
      'outstandingBalance',
      'invoiceOverdue',
    ];
    sendCsv(res, 'cash-sheet.csv', rowsToReportCsv(report.items, headers));
  }),
);

router.get(
  '/debtors',
  reportsAuditLog,
  typedHandler({ query: PolicyReportQuerySchema }, async (req, res) => {
    const report = await getDebtorsReport(policyFilters(req.query));
    res.json({ success: true, data: report });
  }),
);

router.post(
  '/office-targets',
  reportsAuditLog,
  requirePermission('reports', 'generate'),
  typedHandler({ body: z.union([OfficeTargetBundleBodySchema, OfficeTargetBodySchema]) }, async (req, res) => {
    const { body } = req;
    if ('newBusiness' in body && 'renewal' in body) {
      const saved = await saveOfficeTargetBundle({
        productCode: body.productCode || null,
        periodStart: parseDate(body.periodStart, 'start') ?? new Date(body.periodStart),
        periodEnd: parseDate(body.periodEnd, 'end') ?? new Date(body.periodEnd),
        newBusiness: body.newBusiness,
        renewal: body.renewal,
        createdByUserId: req.user?.id || null,
      });
      res.json({ success: true, data: saved });
      return;
    }
    const target = await saveOfficeStaffTarget({
      scope: body.scope,
      businessCategory: body.scope === 'OFFICE' ? body.businessCategory || null : null,
      userId: body.userId || null,
      productCode: body.productCode || null,
      periodStart: parseDate(body.periodStart, 'start') ?? new Date(body.periodStart),
      periodEnd: parseDate(body.periodEnd, 'end') ?? new Date(body.periodEnd),
      premiumTarget: body.premiumTarget,
      policyCountTarget: body.policyCountTarget,
      conversionTarget: body.conversionTarget ?? null,
      createdByUserId: req.user?.id || null,
    });
    res.json({ success: true, data: { id: target.id } });
  }),
);

router.get(
  '/office-targets',
  reportsAuditLog,
  typedHandler({ query: PolicyReportQuerySchema }, async (req, res) => {
    const report = await getOfficeTargetReport(policyFilters(req.query));
    res.json({ success: true, data: report });
  }),
);

router.post(
  '/allocator/assign',
  reportsAuditLog,
  typedHandler({ body: AssignPolicyBodySchema }, async (req, res) => {
    const { body } = req;
    const actorId = String(req.user?.id || '').trim();
    if (!actorId) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication is required before permission checks run.' },
      });
      return;
    }
    const needed = requiredPermissionForPolicyAssignment({
      actorUserId: actorId,
      assignedToUserId: body.assignedToUserId,
    });
    const permissions = await resolveEffectivePermissionsForUser(actorId, req.user?.role);
    if (!hasEffectivePermission(permissions, needed)) {
      res.status(403).json({
        success: false,
        error: { code: 'PERMISSION_DENIED', message: `You do not have permission to perform this action (${needed}).` },
      });
      return;
    }
    try {
      const assignment = await assignPolicyToStaff({
        policyId: body.policyId,
        assignedToUserId: body.assignedToUserId,
        assignedByUserId: actorId,
        source: 'MANUAL',
      });
      res.json({ success: true, data: { id: assignment.id } });
    } catch (error) {
      if (error instanceof PolicyAssignmentTargetMissingError) {
        res.status(404).json({
          success: false,
          error: { code: error.code, message: error.message },
        });
        return;
      }
      if (error instanceof PolicyAssignmentStaffTargetInvalidError) {
        res.status(422).json({
          success: false,
          error: { code: error.code, message: error.message },
        });
        return;
      }
      throw error;
    }
  }),
);

router.get(
  '/origin-conversion',
  reportsAuditLog,
  typedHandler({ query: PolicyReportQuerySchema }, async (req, res) => {
    const report = await getOriginConversionReport(policyFilters(req.query));
    res.json({ success: true, data: report });
  }),
);

router.get(
  '/cyprus-demographic',
  reportsAuditLog,
  typedHandler({ query: PolicyReportQuerySchema }, async (req, res) => {
    const report = await getCyprusDemographicReport(policyFilters(req.query));
    res.json({ success: true, data: report });
  }),
);

router.get(
  '/dno',
  reportsAuditLog,
  typedHandler({ query: PolicyReportQuerySchema }, async (req, res) => {
    const report = await getDnoReport(policyFilters(req.query));
    res.json({ success: true, data: report });
  }),
);

router.get(
  '/activity-log',
  reportsAuditLog,
  requirePermission('people', 'activity.view'),
  typedHandler({ query: AuditReportQuerySchema }, async (req, res) => {
    const report = await getAuditReport(auditFilters(req.query, false));
    res.json({ success: true, data: report });
  }),
);

router.get(
  '/view-tracks',
  reportsAuditLog,
  typedHandler({ query: AuditReportQuerySchema }, async (req, res) => {
    const report = await getAuditReport(auditFilters(req.query, true));
    res.json({ success: true, data: report });
  }),
);

export default router;
