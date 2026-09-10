// Pure helpers + shared constants for the `/api/reports/dashboard`
// route. Extracted from the parent `reportsRouter.ts` in PR 2.3c
// of the errors-and-warnings cleanup so the route file shrinks
// toward the file-size cap.

import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { PolicyDateBasis } from '../../app/read/policyRepositoryCounts.js';

export type JsonRecord = Record<string, unknown>;

export const DASHBOARD_MAX_ROWS = Math.max(100, Number(process.env.DASHBOARD_MAX_ROWS || 2000));
export const DASHBOARD_CLAIMS_KPI_MAX_ROWS = Math.max(100, Number(process.env.DASHBOARD_CLAIMS_KPI_MAX_ROWS || 1500));

export const policySearchDashboardSelect = {
  policyId: true,
  policyNumber: true,
  insuredName: true,
  status: true,
  segment: true,
  totalPremium: true,
  updatedAt: true,
  policy: {
    select: {
      createdAt: true,
      inceptionDate: true,
      issuedAt: true,
      updatedAt: true,
      status: true,
      stateCurrent: { select: { snapshot: true } },
    },
  },
} as const;

export const STEP_ORDER: Record<string, number> = {
  'policy-holder': 1,
  'driving-history': 2,
  'vehicle-cover': 3,
  'your-quote': 4,
  'payment': 5,
  'issued': 6,
};

export function reportsAuditLog(req: Request, _res: Response, next: NextFunction): void {
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

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DateInputSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    if (DATE_ONLY_REGEX.test(value)) return true;
    return !Number.isNaN(Date.parse(value));
  }, 'Invalid date format');

export const DashboardQuerySchema = z.object({
  'period.start': DateInputSchema.optional(),
  'period.end': DateInputSchema.optional(),
  programId: z.string().trim().optional(),
  mode: z.enum(['MTD', 'FULL', 'MONTH', 'FULL_MONTH']).optional(),
  dateBasis: z.enum(['createdAt', 'inceptionDate', 'issuedAt']).optional().default('inceptionDate'),
  bdxOnly: z.preprocess((value) => {
    if (typeof value === 'boolean') return value;
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === '') return false;
    return value;
  }, z.boolean()).optional().default(false),
});

export function toNumber(value: unknown): number {
  return Number(value || 0);
}

export function parseDashboardDate(value: string, bound: 'start' | 'end'): Date {
  if (DATE_ONLY_REGEX.test(value)) {
    const [year, month, day] = value.split('-').map((part) => Number(part));
    if (!year || !month || !day) {
      throw new Error(`Invalid date: ${value}`);
    }
    const hour = bound === 'end' ? 23 : 0;
    const minute = bound === 'end' ? 59 : 0;
    const second = bound === 'end' ? 59 : 0;
    const ms = bound === 'end' ? 999 : 0;
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed;
}

export function utcDate(year: number, month: number, day: number, bound: 'start' | 'end'): Date {
  const hour = bound === 'end' ? 23 : 0;
  const minute = bound === 'end' ? 59 : 0;
  const second = bound === 'end' ? 59 : 0;
  const ms = bound === 'end' ? 999 : 0;
  return new Date(Date.UTC(year, month, day, hour, minute, second, ms));
}

export function shiftUtcMonth(date: Date, deltaMonths: number): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + deltaMonths,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ));
}

export function clampToUtcMonthDay(date: Date, day: number): Date {
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), Math.min(Math.max(1, day), lastDay), 'end');
}

export function isSameUtcMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

export function policyDateWhere(args: {
  dateBasis: PolicyDateBasis;
  start: Date;
  end: Date;
  programId?: string;
}) {
  const dateFilter = args.dateBasis === 'createdAt'
    ? { createdAt: { gte: args.start, lte: args.end } }
    : args.dateBasis === 'issuedAt'
      ? { issuedAt: { gte: args.start, lte: args.end } }
      : { inceptionDate: { gte: args.start, lte: args.end } };
  return {
    productType: { not: null },
    ...(args.programId ? { programId: args.programId } : {}),
    ...dateFilter,
  };
}

export function policyDateValue(policy: JsonRecord, dateBasis: PolicyDateBasis): number {
  const raw = dateBasis === 'createdAt'
    ? policy.createdAt
    : dateBasis === 'issuedAt'
      ? policy.issuedAt
      : policy.inceptionDate;
  return raw ? new Date(String(raw)).getTime() : 0;
}
