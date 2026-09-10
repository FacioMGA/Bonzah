import type { Prisma } from '@prisma/client';

import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { WithoutTenantScope } from '../../../platform/db/tenantExtension.js';
import { resolveLifecycleStatus } from '../../policy/app/status.js';

export {
  assignPolicyToStaff,
  PolicyAssignmentStaffTargetInvalidError,
  PolicyAssignmentTargetMissingError,
} from './policyAssignments.js';

export type ReportDateBasis = 'createdAt' | 'inceptionDate' | 'issuedAt';

export type PolicyReportFilters = {
  start?: Date | null;
  end?: Date | null;
  dateBasis: ReportDateBasis;
  programId?: string | null;
  productType?: string | null;
  operatingTenantId?: string | null;
  limit?: number;
};

export type AuditReportFilters = {
  start?: Date | null;
  end?: Date | null;
  actorId?: string | null;
  entityType?: string | null;
  actionPrefix?: string | null;
  changedOnly?: boolean;
  viewOnly?: boolean;
  limit?: number;
};

export type OfficeTargetBusinessCategory = 'NEW_BUSINESS' | 'RENEWAL';

export type TargetInput = {
  scope: 'OFFICE' | 'STAFF';
  businessCategory?: OfficeTargetBusinessCategory | null;
  userId?: string | null;
  productCode?: string | null;
  periodStart: Date;
  periodEnd: Date;
  premiumTarget: number;
  policyCountTarget: number;
  conversionTarget?: number | null;
  createdByUserId?: string | null;
};

export type OfficeTargetCategoryRow = {
  category: OfficeTargetBusinessCategory | 'TOTAL';
  label: string;
  premiumTarget: number;
  policyCountTarget: number;
  premiumActual: number;
  policyCountActual: number;
  premiumVariance: number;
  policyCountVariance: number;
};

export type OfficeTargetReportGroup = {
  productCode: string | null;
  periodStart: string;
  periodEnd: string;
  categories: OfficeTargetCategoryRow[];
};

type CashSheetRow = {
  policyId: string;
  policyNumber: string;
  insuredName: string;
  productType: string | null;
  status: string;
  boStatus: string | null;
  operatingTenantId: string;
  date: string | null;
  totalPremium: number;
  outstandingBalance: number;
  invoiceOverdue: boolean;
};

type AuditRow = {
  id: string;
  occurredAt: string;
  actorId: string;
  actorName: string | null;
  actorType: string;
  actionName: string;
  entityType: string;
  entityId: string;
  changed: boolean;
  result: string | null;
};

type ReportJsonLookup = { [key: string]: Prisma.JsonValue | undefined };
type ReportCsvCell = string | number | boolean | null | undefined;
type ReportCsvRow = { [key: string]: ReportCsvCell };

function asJsonLookup(value: Prisma.JsonValue | null | undefined): ReportJsonLookup | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as ReportJsonLookup;
}

function finiteNumber(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

function policyDateWhere(args: PolicyReportFilters): Prisma.PolicyWhereInput {
  const range = {
    ...(args.start ? { gte: args.start } : {}),
    ...(args.end ? { lte: args.end } : {}),
  };
  const byDate = !Object.keys(range).length
    ? {}
    : args.dateBasis === 'createdAt'
      ? { createdAt: range }
      : args.dateBasis === 'issuedAt'
        ? { issuedAt: range }
        : { inceptionDate: range };

  return {
    productType: { not: null },
    ...(args.programId ? { programId: args.programId } : {}),
    ...(args.productType ? { productType: args.productType } : {}),
    ...byDate,
  };
}

function policyListWhere(args: PolicyReportFilters): Prisma.PolicyListIndexWhereInput {
  return {
    ...(args.operatingTenantId ? { operatingTenantId: args.operatingTenantId } : {}),
    policy: policyDateWhere(args),
  };
}

function selectedDate(row: {
  policy: { createdAt: Date; inceptionDate: Date; issuedAt: Date | null };
}, dateBasis: ReportDateBasis): string | null {
  const value = dateBasis === 'createdAt'
    ? row.policy.createdAt
    : dateBasis === 'issuedAt'
      ? row.policy.issuedAt
      : row.policy.inceptionDate;
  return value ? value.toISOString() : null;
}

function extractResult(diff: Prisma.JsonValue | null | undefined): string | null {
  const record = asJsonLookup(diff);
  if (!record) return null;
  for (const key of ['result', 'outcome', 'status']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function hasChange(diff: Prisma.JsonValue | null | undefined): boolean {
  const record = asJsonLookup(diff);
  if (!record) return false;
  if ('before' in record || 'after' in record) return true;
  if ('changes' in record || 'changed' in record) return true;
  return Object.keys(record).length > 0;
}

function isViewAction(actionName: string): boolean {
  const normalized = actionName.toUpperCase();
  return normalized.includes('.VIEW') || normalized.includes('.READ') || normalized.includes('VIEWED');
}

function readPath(source: Prisma.JsonValue | null | undefined, path: string[]): Prisma.JsonValue | undefined {
  let current = source;
  for (const key of path) {
    const record = asJsonLookup(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

function firstString(...values: Array<Prisma.JsonValue | undefined>): string | null {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return null;
}

function originFromQuoteData(quoteData: Prisma.JsonValue | null | undefined): string {
  return firstString(
    readPath(quoteData, ['proposer', 'whereDidYouHear']),
    readPath(quoteData, ['proposer', 'hearAboutUs']),
    readPath(quoteData, ['whereDidYouHear']),
    readPath(quoteData, ['hearAboutUs']),
    readPath(quoteData, ['origin']),
  ) || 'Unknown';
}

function dateOfBirthFromQuoteData(quoteData: Prisma.JsonValue | null | undefined): string | null {
  return firstString(
    readPath(quoteData, ['proposer', 'dateOfBirth']),
    readPath(quoteData, ['proposer', 'dob']),
    readPath(quoteData, ['policyHolder', 'dateOfBirth']),
    readPath(quoteData, ['dateOfBirth']),
  );
}

function ageBand(dob: string | null, now = new Date()): string {
  if (!dob) return 'Unknown';
  const parsed = new Date(dob);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  const age = now.getUTCFullYear() - parsed.getUTCFullYear();
  if (age < 25) return '<25';
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  if (age < 55) return '45-54';
  if (age < 65) return '55-64';
  return '65+';
}

export async function getCashSheetReport(filters: PolicyReportFilters) {
  const limit = clampLimit(filters.limit, 200, 500);
  const where = policyListWhere(filters);
  const [rows, totals, overdueCount] = await Promise.all([
    tenantScopedPrisma.policyListIndex.findMany({
      where,
      orderBy: [{ coverageStart: 'desc' }, { policyNumber: 'desc' }],
      take: limit,
      select: {
        policyId: true,
        policyNumber: true,
        insuredName: true,
        status: true,
        bo_status: true,
        operatingTenantId: true,
        coverageStart: true,
        coverageEnd: true,
        totalPremium: true,
        outstandingBalance: true,
        invoiceOverdue: true,
        policy: {
          select: {
            productType: true,
            createdAt: true,
            inceptionDate: true,
            issuedAt: true,
          },
        },
      },
    }),
    tenantScopedPrisma.policyListIndex.aggregate({
      where,
      _count: { policyId: true },
      _sum: { totalPremium: true, outstandingBalance: true },
    }),
    tenantScopedPrisma.policyListIndex.count({
      where: { ...where, invoiceOverdue: true },
    }),
  ]);

  const items: CashSheetRow[] = rows.map((row) => ({
    policyId: row.policyId,
    policyNumber: row.policyNumber,
    insuredName: row.insuredName,
    productType: row.policy.productType,
    status: row.status,
    boStatus: resolveLifecycleStatus(row.bo_status || row.status, {
      inceptionDate: row.coverageStart,
      expiryDate: row.coverageEnd,
    }),
    operatingTenantId: row.operatingTenantId,
    date: selectedDate(row, filters.dateBasis),
    totalPremium: finiteNumber(row.totalPremium),
    outstandingBalance: finiteNumber(row.outstandingBalance),
    invoiceOverdue: row.invoiceOverdue,
  }));

  return {
    filters: reportFilterEcho(filters),
    totals: {
      count: totals._count.policyId,
      totalPremium: finiteNumber(totals._sum.totalPremium),
      outstandingBalance: finiteNumber(totals._sum.outstandingBalance),
      invoiceOverdueCount: overdueCount,
    },
    items,
  };
}

export async function getDebtorsReport(filters: PolicyReportFilters) {
  const limit = clampLimit(filters.limit, 200, 500);
  const where: Prisma.PolicyListIndexWhereInput = {
    ...policyListWhere(filters),
    OR: [
      { outstandingBalance: { gt: 0 } },
      { invoiceOverdue: true },
    ],
  };
  const [rows, totals, overdueCount] = await Promise.all([
    tenantScopedPrisma.policyListIndex.findMany({
      where,
      orderBy: [{ invoiceOverdue: 'desc' }, { outstandingBalance: 'desc' }],
      take: limit,
      select: {
        policyId: true,
        policyNumber: true,
        insuredName: true,
        status: true,
        bo_status: true,
        operatingTenantId: true,
        coverageStart: true,
        coverageEnd: true,
        totalPremium: true,
        outstandingBalance: true,
        invoiceOverdue: true,
        policy: {
          select: {
            productType: true,
            createdAt: true,
            inceptionDate: true,
            issuedAt: true,
          },
        },
      },
    }),
    tenantScopedPrisma.policyListIndex.aggregate({
      where,
      _count: { policyId: true },
      _sum: { totalPremium: true, outstandingBalance: true },
    }),
    tenantScopedPrisma.policyListIndex.count({
      where: { ...where, invoiceOverdue: true },
    }),
  ]);

  const items: CashSheetRow[] = rows.map((row) => ({
    policyId: row.policyId,
    policyNumber: row.policyNumber,
    insuredName: row.insuredName,
    productType: row.policy.productType,
    status: row.status,
    boStatus: resolveLifecycleStatus(row.bo_status || row.status, {
      inceptionDate: row.coverageStart,
      expiryDate: row.coverageEnd,
    }),
    operatingTenantId: row.operatingTenantId,
    date: selectedDate(row, filters.dateBasis),
    totalPremium: finiteNumber(row.totalPremium),
    outstandingBalance: finiteNumber(row.outstandingBalance),
    invoiceOverdue: row.invoiceOverdue,
  }));

  return {
    filters: reportFilterEcho(filters),
    totals: {
      count: totals._count.policyId,
      totalPremium: finiteNumber(totals._sum.totalPremium),
      outstandingBalance: finiteNumber(totals._sum.outstandingBalance),
      invoiceOverdueCount: overdueCount,
    },
    items,
  };
}

export async function getAuditReport(filters: AuditReportFilters) {
  const limit = clampLimit(filters.limit, 100, 500);
  const where: Prisma.AuditActionWhereInput = {
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.actionPrefix ? { actionName: { startsWith: filters.actionPrefix } } : {}),
    ...((filters.start || filters.end) ? {
      occurredAt: {
        ...(filters.start ? { gte: filters.start } : {}),
        ...(filters.end ? { lte: filters.end } : {}),
      },
    } : {}),
  };

  const rows = await tenantScopedPrisma.auditAction.findMany({
    where,
    orderBy: { occurredAt: 'desc' },
    take: limit * 2,
  });

  const items: AuditRow[] = rows
    .filter((row) => !filters.viewOnly || isViewAction(row.actionName))
    .map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      actorId: row.actorId,
      actorName: row.actorName,
      actorType: row.actorType,
      actionName: row.actionName,
      entityType: row.entityType,
      entityId: row.entityId,
      changed: hasChange(row.diff),
      result: extractResult(row.diff),
    }))
    .filter((row) => !filters.changedOnly || row.changed)
    .slice(0, limit);

  return {
    filters: auditFilterEcho(filters),
    totals: { count: items.length },
    items,
  };
}

export function rowsToReportCsv<T extends ReportCsvRow>(rows: T[], headers: string[]): string {
  const escape = (value: ReportCsvCell) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[,"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
  ].join('\n');
}

export async function saveOfficeStaffTarget(input: TargetInput) {
  const data: WithoutTenantScope<Prisma.OfficeStaffTargetUncheckedCreateInput> = {
    scope: input.scope,
    businessCategory: input.scope === 'OFFICE' ? input.businessCategory || null : null,
    userId: input.scope === 'STAFF' ? input.userId || null : null,
    productCode: input.productCode ? input.productCode.toUpperCase() : null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    premiumTarget: input.premiumTarget,
    policyCountTarget: input.policyCountTarget,
    conversionTarget: input.conversionTarget ?? null,
    createdByUserId: input.createdByUserId || null,
  };

  if (input.scope === 'OFFICE' && input.businessCategory) {
    const existing = await tenantScopedPrisma.officeStaffTarget.findFirst({
      where: {
        scope: 'OFFICE',
        businessCategory: input.businessCategory,
        productCode: data.productCode,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      },
      select: { id: true },
    });
    if (existing) {
      return tenantScopedPrisma.officeStaffTarget.update({
        where: { id: existing.id },
        data: {
          premiumTarget: input.premiumTarget,
          policyCountTarget: input.policyCountTarget,
          conversionTarget: input.conversionTarget ?? null,
          createdByUserId: input.createdByUserId || null,
        },
      });
    }
  }

  return tenantScopedPrisma.officeStaffTarget.create({
    data: data as Prisma.OfficeStaffTargetUncheckedCreateInput,
  });
}

export async function saveOfficeTargetBundle(input: {
  productCode?: string | null;
  periodStart: Date;
  periodEnd: Date;
  newBusiness: { premiumTarget: number; policyCountTarget: number };
  renewal: { premiumTarget: number; policyCountTarget: number };
  createdByUserId?: string | null;
}) {
  const shared = {
    scope: 'OFFICE' as const,
    productCode: input.productCode || null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    createdByUserId: input.createdByUserId || null,
  };
  const [newBusiness, renewal] = await Promise.all([
    saveOfficeStaffTarget({
      ...shared,
      businessCategory: 'NEW_BUSINESS',
      premiumTarget: input.newBusiness.premiumTarget,
      policyCountTarget: input.newBusiness.policyCountTarget,
    }),
    saveOfficeStaffTarget({
      ...shared,
      businessCategory: 'RENEWAL',
      premiumTarget: input.renewal.premiumTarget,
      policyCountTarget: input.renewal.policyCountTarget,
    }),
  ]);
  return { newBusinessId: newBusiness.id, renewalId: renewal.id };
}

export async function listOfficeStaffTargets(filters: PolicyReportFilters) {
  return tenantScopedPrisma.officeStaffTarget.findMany({
    where: {
      scope: 'OFFICE',
      ...(filters.start || filters.end ? {
        periodEnd: { ...(filters.start ? { gte: filters.start } : {}) },
        periodStart: { ...(filters.end ? { lte: filters.end } : {}) },
      } : {}),
      ...(filters.productType ? { productCode: filters.productType } : {}),
    },
    orderBy: [{ periodStart: 'desc' }, { businessCategory: 'asc' }],
    take: clampLimit(filters.limit, 100, 300),
  });
}

function officeTargetGroupKey(target: {
  productCode: string | null;
  periodStart: Date;
  periodEnd: Date;
}): string {
  return [
    target.productCode || 'ALL',
    target.periodStart.toISOString(),
    target.periodEnd.toISOString(),
  ].join('::');
}

function categoryLabel(category: OfficeTargetBusinessCategory | 'TOTAL'): string {
  if (category === 'NEW_BUSINESS') return 'New Business';
  if (category === 'RENEWAL') return 'Renewal';
  return 'Total';
}

function buildCategoryRow(args: {
  category: OfficeTargetBusinessCategory | 'TOTAL';
  premiumTarget: number;
  policyCountTarget: number;
  premiumActual: number;
  policyCountActual: number;
}): OfficeTargetCategoryRow {
  return {
    category: args.category,
    label: categoryLabel(args.category),
    premiumTarget: args.premiumTarget,
    policyCountTarget: args.policyCountTarget,
    premiumActual: args.premiumActual,
    policyCountActual: args.policyCountActual,
    premiumVariance: args.premiumActual - args.premiumTarget,
    policyCountVariance: args.policyCountActual - args.policyCountTarget,
  };
}

export async function getOfficeTargetReport(filters: PolicyReportFilters) {
  const actualsWhere = (args?: {
    productCode?: string | null;
    businessCategory?: OfficeTargetBusinessCategory | 'TOTAL';
  }): Prisma.PolicyListIndexWhereInput => {
    const targetFilters: PolicyReportFilters = {
      ...filters,
      productType: args?.productCode || filters.productType || null,
    };
    const renewalFilter = args?.businessCategory === 'NEW_BUSINESS'
      ? { priorTermPolicyId: null }
      : args?.businessCategory === 'RENEWAL'
        ? { priorTermPolicyId: { not: null } }
        : {};
    const policyWhere: Prisma.PolicyWhereInput = {
      ...policyDateWhere(targetFilters),
      ...renewalFilter,
    };
    return {
      ...policyListWhere(targetFilters),
      status: { in: ['ACTIVE', 'ISSUED'] },
      policy: policyWhere,
    };
  };
  const aggregateActuals = async (args?: {
    productCode?: string | null;
    businessCategory?: OfficeTargetBusinessCategory | 'TOTAL';
  }) => {
    const actuals = await tenantScopedPrisma.policyListIndex.aggregate({
      where: actualsWhere(args),
      _count: { policyId: true },
      _sum: { totalPremium: true },
    });
    return {
      premium: finiteNumber(actuals._sum.totalPremium),
      policyCount: actuals._count.policyId,
    };
  };

  const targets = await listOfficeStaffTargets(filters);
  const groupedTargets = new Map<string, typeof targets>();
  for (const target of targets) {
    const key = officeTargetGroupKey(target);
    const group = groupedTargets.get(key) || [];
    group.push(target);
    groupedTargets.set(key, group);
  }

  const groups: OfficeTargetReportGroup[] = [];
  for (const groupTargets of groupedTargets.values()) {
    const anchor = groupTargets[0];
    const productCode = anchor.productCode;
    const newBusinessTarget = groupTargets.find((target) => target.businessCategory === 'NEW_BUSINESS');
    const renewalTarget = groupTargets.find((target) => target.businessCategory === 'RENEWAL');
    const legacyTotalTarget = groupTargets.find((target) => !target.businessCategory);

    const [newBusinessActuals, renewalActuals] = await Promise.all([
      aggregateActuals({ productCode, businessCategory: 'NEW_BUSINESS' }),
      aggregateActuals({ productCode, businessCategory: 'RENEWAL' }),
    ]);
    const totalActuals = {
      premium: newBusinessActuals.premium + renewalActuals.premium,
      policyCount: newBusinessActuals.policyCount + renewalActuals.policyCount,
    };

    const categories: OfficeTargetCategoryRow[] = [];
    if (newBusinessTarget || renewalTarget) {
      const newBusinessPremiumTarget = newBusinessTarget ? finiteNumber(newBusinessTarget.premiumTarget) : 0;
      const renewalPremiumTarget = renewalTarget ? finiteNumber(renewalTarget.premiumTarget) : 0;
      const newBusinessPolicyCountTarget = newBusinessTarget?.policyCountTarget || 0;
      const renewalPolicyCountTarget = renewalTarget?.policyCountTarget || 0;
      categories.push(
        buildCategoryRow({
          category: 'NEW_BUSINESS',
          premiumTarget: newBusinessPremiumTarget,
          policyCountTarget: newBusinessPolicyCountTarget,
          premiumActual: newBusinessActuals.premium,
          policyCountActual: newBusinessActuals.policyCount,
        }),
        buildCategoryRow({
          category: 'RENEWAL',
          premiumTarget: renewalPremiumTarget,
          policyCountTarget: renewalPolicyCountTarget,
          premiumActual: renewalActuals.premium,
          policyCountActual: renewalActuals.policyCount,
        }),
        buildCategoryRow({
          category: 'TOTAL',
          premiumTarget: newBusinessPremiumTarget + renewalPremiumTarget,
          policyCountTarget: newBusinessPolicyCountTarget + renewalPolicyCountTarget,
          premiumActual: totalActuals.premium,
          policyCountActual: totalActuals.policyCount,
        }),
      );
    } else if (legacyTotalTarget) {
      categories.push(
        buildCategoryRow({
          category: 'TOTAL',
          premiumTarget: finiteNumber(legacyTotalTarget.premiumTarget),
          policyCountTarget: legacyTotalTarget.policyCountTarget,
          premiumActual: totalActuals.premium,
          policyCountActual: totalActuals.policyCount,
        }),
      );
    }

    if (categories.length > 0) {
      groups.push({
        productCode,
        periodStart: anchor.periodStart.toISOString(),
        periodEnd: anchor.periodEnd.toISOString(),
        categories,
      });
    }
  }

  const [newBusinessActuals, renewalActuals, totalActuals] = await Promise.all([
    aggregateActuals({ businessCategory: 'NEW_BUSINESS' }),
    aggregateActuals({ businessCategory: 'RENEWAL' }),
    aggregateActuals({ businessCategory: 'TOTAL' }),
  ]);

  return {
    filters: reportFilterEcho(filters),
    actuals: {
      premium: totalActuals.premium,
      policyCount: totalActuals.policyCount,
      newBusinessPremium: newBusinessActuals.premium,
      renewalPremium: renewalActuals.premium,
      newBusinessPolicyCount: newBusinessActuals.policyCount,
      renewalPolicyCount: renewalActuals.policyCount,
    },
    groups,
  };
}

export async function getOriginConversionReport(filters: PolicyReportFilters) {
  const rows = await tenantScopedPrisma.policyListIndex.findMany({
    where: policyListWhere(filters),
    take: clampLimit(filters.limit, 1000, 2000),
    select: {
      policyId: true,
      policyNumber: true,
      status: true,
      totalPremium: true,
      policy: {
        select: {
          quoteData: true,
          productType: true,
          assignment: { select: { assignedToUserId: true } },
        },
      },
    },
  });

  const groups = new Map<string, { staffUserId: string; origin: string; enquiries: number; converted: number; premium: number }>();
  for (const row of rows) {
    const staffUserId = row.policy.assignment?.assignedToUserId || 'Unassigned';
    const origin = originFromQuoteData(row.policy.quoteData);
    const key = `${staffUserId}::${origin}`;
    const group = groups.get(key) || { staffUserId, origin, enquiries: 0, converted: 0, premium: 0 };
    group.enquiries += 1;
    if (['ACTIVE', 'ISSUED'].includes(String(row.status).toUpperCase())) {
      group.converted += 1;
      group.premium += finiteNumber(row.totalPremium);
    }
    groups.set(key, group);
  }

  return {
    filters: reportFilterEcho(filters),
    items: Array.from(groups.values()).map((group) => ({
      ...group,
      conversionRate: group.enquiries > 0 ? group.converted / group.enquiries : 0,
    })),
  };
}

export async function getCyprusDemographicReport(filters: PolicyReportFilters) {
  const rows = await tenantScopedPrisma.policyListIndex.findMany({
    where: {
      ...policyListWhere({ ...filters, productType: filters.productType || 'HOME' }),
      operatingTenant: { countryCode: 'CY' },
    },
    take: clampLimit(filters.limit, 1000, 2000),
    select: {
      policyId: true,
      totalPremium: true,
      status: true,
      policy: { select: { quoteData: true } },
    },
  });
  const groups = new Map<string, { ageBand: string; policies: number; premium: number }>();
  for (const row of rows) {
    const band = ageBand(dateOfBirthFromQuoteData(row.policy.quoteData));
    const group = groups.get(band) || { ageBand: band, policies: 0, premium: 0 };
    group.policies += 1;
    group.premium += finiteNumber(row.totalPremium);
    groups.set(band, group);
  }
  return {
    filters: reportFilterEcho(filters),
    items: Array.from(groups.values()).sort((a, b) => a.ageBand.localeCompare(b.ageBand)),
  };
}

export async function getDnoReport(filters: PolicyReportFilters) {
  const rows = await tenantScopedPrisma.policyListIndex.findMany({
    where: {
      ...policyListWhere(filters),
      OR: [{ status: 'DECLINED' }, { bo_status: 'DECLINED' }],
    },
    orderBy: { updatedAt: 'desc' },
    take: clampLimit(filters.limit, 200, 500),
    select: {
      policyId: true,
      policyNumber: true,
      insuredName: true,
      status: true,
      bo_status: true,
      totalPremium: true,
      updatedAt: true,
      policy: {
        select: {
          productType: true,
          quoteData: true,
        },
      },
    },
  });
  return {
    filters: reportFilterEcho(filters),
    items: rows.map((row) => ({
      policyId: row.policyId,
      policyNumber: row.policyNumber,
      insuredName: row.insuredName,
      productType: row.policy.productType,
      status: row.bo_status || row.status,
      origin: originFromQuoteData(row.policy.quoteData),
      totalPremium: finiteNumber(row.totalPremium),
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

function reportFilterEcho(filters: PolicyReportFilters) {
  return {
    start: filters.start?.toISOString() || null,
    end: filters.end?.toISOString() || null,
    dateBasis: filters.dateBasis,
    programId: filters.programId || null,
    productType: filters.productType || null,
    operatingTenantId: filters.operatingTenantId || null,
  };
}

function auditFilterEcho(filters: AuditReportFilters) {
  return {
    start: filters.start?.toISOString() || null,
    end: filters.end?.toISOString() || null,
    actorId: filters.actorId || null,
    entityType: filters.entityType || null,
    actionPrefix: filters.actionPrefix || null,
    changedOnly: Boolean(filters.changedOnly),
    viewOnly: Boolean(filters.viewOnly),
  };
}
