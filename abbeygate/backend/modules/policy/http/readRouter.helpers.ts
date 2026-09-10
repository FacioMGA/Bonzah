import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { ApiResponse } from '../../../platform/types/index.js';
import { getPolicyListRegistry } from '../app/read/infraAdapters.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import { isClientPublicDocument as isClientPublicDocumentFromDocumentsApp } from '../../documents/app/publicDocumentVisibility.js';
export { parseRecord };

export type PolicySortField = string;
export type PolicySortDir = 'asc' | 'desc';
type SortLocation = 'index' | 'policy';
type SortType = 'date' | 'string' | 'number';
type ErrorBody = ApiResponse<null>;

const CursorRuleSchema = z.object({
  field: z.string(),
  direction: z.enum(['asc', 'desc']),
  value: z.unknown().optional(),
});
const CursorSchema = z.object({
  policyId: z.string().optional(),
  rules: z.array(CursorRuleSchema).optional(),
});

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Customer portal requests scope RLS to the operating-tenant account. */
export function customerScopedListActor(
  user: Express.UserTokenPayload | undefined,
  accountScopeId: string | undefined,
) {
  if (!user) return null;
  const scopedAccountId = String(accountScopeId || '').trim();
  if (scopedAccountId && String(user.role || '').toUpperCase() === 'CUSTOMER') {
    return { ...user, primaryAccountId: scopedAccountId };
  }
  return user;
}

export function sendError(res: { status: (code: number) => { json: (payload: ErrorBody) => unknown } }, status: number, code: string, message: string) {
  const payload: ErrorBody = {
    success: false,
    error: { code, message },
  };
  return res.status(status).json(payload);
}

const registry = getPolicyListRegistry();
const POLICY_SORT_SPEC: Record<PolicySortField, { location: SortLocation; type: SortType }> = Object.fromEntries(
  Object.entries(registry.sortFields || {}).map(([k, v]) => [
    k,
    {
      location: v.location === 'policy' ? 'policy' : 'index',
      type: v.type === 'number' ? 'number' : v.type === 'date' ? 'date' : 'string',
    },
  ])
);
const DEFAULT_SORT = Array.isArray(registry.defaultSort) && registry.defaultSort.length
  ? registry.defaultSort
  : [{ field: 'updatedAt', direction: 'desc' }];
const HOT_VIEW_CACHE_TTL_MS = Math.max(2_000, Number(process.env.POLICY_LIST_CACHE_TTL_MS || 15_000));
const HOT_VIEW_CACHE_MAX_ENTRIES = Math.max(20, Number(process.env.POLICY_LIST_CACHE_MAX_ENTRIES || 200));
const INDEX_COVERAGE_CACHE_TTL_MS = Math.max(
  2_000,
  Number(process.env.POLICY_LIST_INDEX_COVERAGE_TTL_MS || 60_000)
);
export const USE_POLICY_STATE = String(process.env.USE_POLICY_STATE || '').trim().toLowerCase() === 'true';
const ENABLE_DEEP_JSON_SEARCH = String(process.env.POLICY_LIST_DEEP_JSON_SEARCH || '').trim().toLowerCase() === 'true';

const hotViewCache = new Map<string, { expiresAt: number; payload: unknown }>();
let hotViewCacheHits = 0;
let hotViewCacheMisses = 0;

export type IndexCoverageEntry = {
  indexedPolicies: number;
  totalPolicies: number;
};
const indexCoverageCache = new Map<string, { expiresAt: number; payload: IndexCoverageEntry }>();

function normalizeSortField(raw: unknown): PolicySortField {
  const val = String(raw || '').trim();
  if (val && Object.prototype.hasOwnProperty.call(POLICY_SORT_SPEC, val)) return val as PolicySortField;
  return String(DEFAULT_SORT[0]?.field || 'updatedAt');
}

function normalizeSortDir(raw: unknown): PolicySortDir {
  return String(raw || '').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
}

export function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload || {}), 'utf8').toString('base64url');
}

export function decodeCursor(token: unknown): z.infer<typeof CursorSchema> | null {
  try {
    const t = String(token || '').trim();
    if (!t) return null;
    const raw = Buffer.from(t, 'base64url').toString('utf8');
    const parsed = CursorSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function normalizeCursorValue(type: SortType, raw: unknown): unknown {
  if (type === 'date') {
    const dt = raw ? new Date(String(raw)) : null;
    return dt && !Number.isNaN(dt.getTime()) ? dt : null;
  }
  if (type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  const s = String(raw ?? '').trim();
  return s || null;
}

export type SortRule = { field: PolicySortField; direction: PolicySortDir };

export function normalizeSortRules(input: {
  sortField?: unknown;
  sortDir?: unknown;
  sortField2?: unknown;
  sortDir2?: unknown;
  sortField3?: unknown;
  sortDir3?: unknown;
}): SortRule[] {
  const raw: Array<[unknown, unknown]> = [
    [input.sortField, input.sortDir],
    [input.sortField2, input.sortDir2],
    [input.sortField3, input.sortDir3],
  ];
  const out: SortRule[] = [];
  const seen = new Set<PolicySortField>();
  for (const [f, d] of raw) {
    const rawField = String(f || '').trim();
    if (!rawField) continue;
    const field = normalizeSortField(rawField);
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({ field, direction: normalizeSortDir(d) });
  }
  if (!out.length) out.push(...DEFAULT_SORT.map((s) => ({ field: String(s.field), direction: normalizeSortDir(s.direction) })));
  return out.slice(0, 3);
}

export function buildOrderBy(sortRules: SortRule[]) {
  const orderBy: Prisma.PolicyListIndexOrderByWithRelationInput[] = [];
  for (const rule of sortRules) {
    const spec = POLICY_SORT_SPEC[rule.field];
    if (spec.location === 'policy') orderBy.push({ policy: { [rule.field]: rule.direction } });
    else orderBy.push({ [rule.field]: rule.direction });
  }
  orderBy.push({ policyId: sortRules[0]?.direction || 'desc' });
  return orderBy;
}

export function valueFromPolicy(item: Record<string, unknown>, field: PolicySortField): unknown {
  const spec = POLICY_SORT_SPEC[field];
  if (spec.location === 'policy') {
    const policy = parseRecord(item.policy);
    return policy[field] ?? null;
  }
  return item?.[field] ?? null;
}

export function eqClause(field: PolicySortField, value: unknown): Prisma.PolicyListIndexWhereInput {
  const spec = POLICY_SORT_SPEC[field];
  if (spec.location === 'policy') return { policy: { [field]: value } };
  return { [field]: value };
}

export function cmpClause(field: PolicySortField, op: 'gt' | 'lt', value: unknown): Prisma.PolicyListIndexWhereInput {
  const spec = POLICY_SORT_SPEC[field];
  if (spec.location === 'policy') return { policy: { [field]: { [op]: value } } };
  return { [field]: { [op]: value } };
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `[${value.map((x) => stableStringify(x)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${k}:${stableStringify(v)}`).join(',')}}`;
  }
  return String(value);
}

export function shortHash(value: unknown): string {
  return crypto.createHash('sha1').update(stableStringify(value), 'utf8').digest('hex').slice(0, 12);
}

export function readHotViewCache(key: string): { payload: unknown } | null {
  const cached = hotViewCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    hotViewCacheHits += 1;
    return { payload: cached.payload };
  }
  hotViewCacheMisses += 1;
  return null;
}

export function setHotViewCache(key: string, payload: unknown) {
  const now = Date.now();
  for (const [k, v] of hotViewCache.entries()) {
    if (v.expiresAt <= now) hotViewCache.delete(k);
  }
  if (hotViewCache.size >= HOT_VIEW_CACHE_MAX_ENTRIES) {
    const oldestKey = hotViewCache.keys().next().value;
    if (oldestKey) hotViewCache.delete(oldestKey);
  }
  hotViewCache.set(key, { expiresAt: now + HOT_VIEW_CACHE_TTL_MS, payload });
}

/**
 * Per-tenant TTL cache for `meta.indexCoveragePct` debug metric.
 *
 * The two unfiltered counts (`policyListIndex` total and `policy.productType IS NOT NULL`
 * total) used to be awaited on every list request. They are not user-facing — only ops
 * use them — so PR2 gates them behind `?debug=1`. This bridge cache (60s default) keeps
 * the debug path cheap. The proper home for this metric is the projection-side worker
 * or the dedicated `/api/policies/_index_health` admin endpoint.
 */
export function readIndexCoverageCache(tenantId: string): IndexCoverageEntry | null {
  const key = String(tenantId || '').trim();
  if (!key) return null;
  const cached = indexCoverageCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }
  if (cached) indexCoverageCache.delete(key);
  return null;
}

export function setIndexCoverageCache(tenantId: string, payload: IndexCoverageEntry) {
  const key = String(tenantId || '').trim();
  if (!key) return;
  const now = Date.now();
  for (const [k, v] of indexCoverageCache.entries()) {
    if (v.expiresAt <= now) indexCoverageCache.delete(k);
  }
  indexCoverageCache.set(key, { expiresAt: now + INDEX_COVERAGE_CACHE_TTL_MS, payload });
}

export function hotViewCacheHitRatePct(): number {
  return Number(((hotViewCacheHits / Math.max(1, hotViewCacheHits + hotViewCacheMisses)) * 100).toFixed(2));
}

export function listFiltersFromQuery(q: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q || {})) {
    if (!/^f(?:ilter)?[._]/i.test(k)) continue;
    out[k] = String(v ?? '').trim();
  }
  return out;
}

export function isVehicleSearchUnknownArgError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error || '');
  return msg.includes('Unknown argument `vehicleSearch`');
}

export function stripVehicleSearchFromWhere(input: Prisma.PolicyListIndexWhereInput): Prisma.PolicyListIndexWhereInput {
  const clone = JSON.parse(JSON.stringify(input || {})) as Record<string, unknown>;
  const scrub = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      const next = node
        .map((entry) => scrub(entry))
        .filter((entry) => !(entry && typeof entry === 'object' && Object.keys(entry as Record<string, unknown>).length === 0));
      return next;
    }
    if (!node || typeof node !== 'object') return node;
    const rec = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k === 'vehicleSearch') continue;
      if (k === 'OR' || k === 'AND' || k === 'NOT') out[k] = scrub(v);
      else out[k] = v;
    }
    return out;
  };
  return scrub(clone) as Prisma.PolicyListIndexWhereInput;
}

export function isClientPublicDocument(doc: { docPack?: string | null; type?: string | null }): boolean {
  return isClientPublicDocumentFromDocumentsApp(doc);
}

function toAuditDedupKey(event: Record<string, unknown>): string {
  const actionName = String(event.actionName || '').trim().toUpperCase();
  const diff = parseRecord(event.diff);
  const principalId = String(
    diff.claimId
    || diff.claimNumber
    || diff.riskTransactionId
    || diff.transactionNumber
    || diff.requestId
    || diff.docPack
    || '',
  ).trim().toUpperCase();
  const reason = String(diff.reason || diff.reasonCode || diff.changeReason || diff.action || '').trim().toUpperCase();
  return [actionName, principalId, reason].join('|');
}

export function dedupePolicyFeedRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const dedupKey = toAuditDedupKey(row);
    const fallbackKey = String(row.id || '').trim();
    const key = dedupKey === '||' ? fallbackKey : dedupKey;
    if (!key) {
      out.push(row);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function buildPolicySearchOrClauses(qs: string): Prisma.PolicyListIndexWhereInput[] {
  const query = String(qs || '').trim();
  if (!query) return [];
  const compact = query.replace(/\s+/g, ' ').trim();
  const parts = compact.split(' ').filter(Boolean);
  const compactUpper = compact.toUpperCase();
  const aliasVariants: string[] = [];
  const abvMatch = compactUpper.match(/^ABV(\d{1,10})$/);
  if (abvMatch?.[1]) aliasVariants.push(`ABOLV${abvMatch[1]}`);
  const abolvMatch = compactUpper.match(/^ABOLV(\d{1,10})$/);
  if (abolvMatch?.[1]) aliasVariants.push(`ABV${abolvMatch[1]}`);
  const variants = Array.from(new Set([
    compact,
    compact.toLowerCase(),
    compactUpper,
    ...aliasVariants,
    ...aliasVariants.map((v) => v.toLowerCase()),
  ]));
  const jsonContains = (path: string[], value: string): Prisma.PolicyListIndexWhereInput => ({
    policy: { quoteData: { path, string_contains: value } },
  });
  const jsonVehicleContains = (path: string[], value: string): Prisma.PolicyListIndexWhereInput => ({
    policy: { vehicleInfo: { path, string_contains: value } },
  });
  const jsonQuoteResponseContains = (path: string[], value: string): Prisma.PolicyListIndexWhereInput => ({
    policy: { quoteResponse: { path, string_contains: value } },
  });

  const base: Prisma.PolicyListIndexWhereInput[] = [
    { policyId: { contains: compact, mode: 'insensitive' } },
    { policyNumber: { contains: compact, mode: 'insensitive' } },
    { vehicleSearch: { contains: compact, mode: 'insensitive' } },
    { insuredName: { contains: compact, mode: 'insensitive' } },
    { policy: { id: { contains: compact, mode: 'insensitive' } } },
    { policy: { policyNumber: { contains: compact, mode: 'insensitive' } } },
    // Issuance keeps the customer-facing quote reference in the canonical
    // policy-state snapshot. It is not the issued policy number, but must
    // remain a first-class back-office lookup key after payment.
    { policy: { stateCurrent: { is: { snapshot: { path: ['quoteId'], equals: compactUpper } } } } },
  ];

  if (ENABLE_DEEP_JSON_SEARCH) {
    base.push(
      ...variants.flatMap((v) => [
        jsonContains(['registrationNumber'], v),
        jsonVehicleContains(['registrationNumber'], v),
        jsonQuoteResponseContains(['reference'], v),
        jsonContains(['reference'], v),
        jsonContains(['make'], v),
        jsonContains(['model'], v),
        jsonVehicleContains(['make'], v),
        jsonVehicleContains(['model'], v),
      ]),
    );
  }

  if (ENABLE_DEEP_JSON_SEARCH && parts.length >= 2) {
    const [a, b] = [parts[0], parts.slice(1).join(' ')];
    base.push({ AND: [jsonContains(['make'], a), jsonContains(['model'], b)] });
    base.push({ AND: [jsonContains(['make'], b), jsonContains(['model'], a)] });
    base.push({ AND: [jsonVehicleContains(['make'], a), jsonVehicleContains(['model'], b)] });
    base.push({ AND: [jsonVehicleContains(['make'], b), jsonVehicleContains(['model'], a)] });
  }

  return base;
}

export function policyAuditLog(req: Request, _res: Response, next: NextFunction): void {
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

export function policySortType(field: PolicySortField): SortType {
  return POLICY_SORT_SPEC[field]?.type || 'string';
}
