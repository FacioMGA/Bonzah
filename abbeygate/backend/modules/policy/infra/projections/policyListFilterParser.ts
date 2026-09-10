import type { PolicyListRegistry } from './policyListRegistry.js';

type SupportedOperator = 'eq' | 'in' | 'gte' | 'lte' | 'between' | 'contains' | 'prefix';

const FILTER_PARAM_RE = /^f(?:ilter)?[._]([a-zA-Z0-9_]+)[._](eq|in|gte|lte|between|contains|prefix)$/;
const FILTER_PARAM_ANY_OP_RE = /^f(?:ilter)?[._]([a-zA-Z0-9_]+)[._]([a-zA-Z0-9_]+)$/;
const MAX_FILTERS = 12;
const MAX_IN_LIST = 50;
const MAX_BETWEEN_DATE_SPAN_DAYS = 3660;

function parseBoolean(v: unknown): boolean | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return null;
}

function parseNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDate(v: unknown): Date | null {
  const d = new Date(String(v ?? '').trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseScalar(type: string, v: unknown): unknown | null {
  if (type === 'boolean') return parseBoolean(v);
  if (type === 'number') return parseNumber(v);
  if (type === 'date') return parseDate(v);
  const s = String(v ?? '').trim();
  return s ? s : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function buildPathClause(path: string, condition: unknown): Record<string, unknown> | null {
  const keys = String(path || '').split('.').filter(Boolean);
  if (!keys.length) return null;
  let node: unknown = condition;
  for (let i = keys.length - 1; i >= 0; i -= 1) {
    node = { [keys[i]]: node };
  }
  return asRecord(node);
}

function parseBetween(type: string, raw: unknown): { start: unknown; end: unknown } | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const parts = text.includes('..') ? text.split('..') : text.split(',');
  if (parts.length !== 2) return null;
  const start = parseScalar(type, parts[0]);
  const end = parseScalar(type, parts[1]);
  if (start === null || end === null) return null;
  return { start, end };
}

function parseIn(type: string, raw: unknown): unknown[] {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  const parts = text.split(',').map((x) => x.trim()).filter(Boolean);
  const out: unknown[] = [];
  for (const p of parts) {
    const v = parseScalar(type, p);
    if (v !== null) out.push(v);
  }
  return out;
}

type RegistryFilterDef = {
  field?: string;
  type?: string;
  operators?: string[];
  attentionThreshold?: number;
  urlKey?: string;
};

function normalizeLegacyQuery(reqQuery: Record<string, unknown>, registry: PolicyListRegistry): Record<string, string> {
  const out: Record<string, string> = {};
  if (reqQuery.status) out['f.status.eq'] = String(reqQuery.status);
  if (reqQuery.statusIn) out['f.status.in'] = Array.isArray(reqQuery.statusIn) ? reqQuery.statusIn.join(',') : String(reqQuery.statusIn);
  if (reqQuery.needsAttention) out['f.needsAttention.eq'] = String(reqQuery.needsAttention);

  for (const [filterKey, rawDef] of Object.entries(registry.filters || {})) {
    const def = rawDef as RegistryFilterDef;
    const urlKey = String(def.urlKey || '').trim();
    if (!urlKey || !(urlKey in reqQuery)) continue;
    if (!Array.isArray(def.operators) || !def.operators.includes('eq')) continue;
    const value = String(reqQuery[urlKey] ?? '').trim();
    if (!value) continue;
    const targetKey = `f.${filterKey}.eq`;
    if (!(targetKey in reqQuery)) out[targetKey] = value;
  }
  return out;
}

export function buildPolicyListWhereFromQuery(
  reqQuery: unknown,
  registry: PolicyListRegistry
): {
  whereClauses: Array<Record<string, unknown>>;
  parsed: Array<{ key: string; op: SupportedOperator }>;
  errors: Array<{ code: string; key: string; message: string }>;
} {
  const whereClauses: Array<Record<string, unknown>> = [];
  const parsed: Array<{ key: string; op: SupportedOperator }> = [];
  const errors: Array<{ code: string; key: string; message: string }> = [];
  const reqQueryRecord = asRecord(reqQuery);
  const queryEntries = Object.entries({
    ...normalizeLegacyQuery(reqQueryRecord, registry),
    ...reqQueryRecord,
  });
  const filterEntries = queryEntries.filter(([rawKey]) => /^f(?:ilter)?[._]/i.test(String(rawKey || '').trim()));
  if (filterEntries.length > MAX_FILTERS) {
    errors.push({
      code: 'TOO_MANY_FILTERS',
      key: '*',
      message: `Too many filters. Maximum is ${MAX_FILTERS}.`,
    });
    return { whereClauses, parsed, errors };
  }

  for (const [rawKey, rawValue] of filterEntries) {
    const key = String(rawKey || '').trim();
    const anyOp = key.match(FILTER_PARAM_ANY_OP_RE);
    if (!anyOp) {
      errors.push({ code: 'INVALID_FILTER_KEY', key, message: `Invalid filter key '${key}'.` });
      continue;
    }
    const filterKey = anyOp[1];
    const rawOp = anyOp[2];
    if (!registry.filters?.[filterKey as keyof typeof registry.filters]) {
      errors.push({ code: 'UNKNOWN_FILTER_FIELD', key, message: `Unknown filter field '${filterKey}'.` });
      continue;
    }
    if (!['eq', 'in', 'gte', 'lte', 'between', 'contains', 'prefix'].includes(rawOp)) {
      errors.push({ code: 'UNKNOWN_FILTER_OPERATOR', key, message: `Unknown filter operator '${rawOp}' for '${filterKey}'.` });
      continue;
    }
    const m = key.match(FILTER_PARAM_RE);
    if (!m) continue;
    const strictFilterKey = m[1];
    const op = m[2] as SupportedOperator;

    const def = (registry.filters?.[strictFilterKey as keyof typeof registry.filters] || {}) as RegistryFilterDef;
    const field = String(def.field || '').trim();
    const type = String(def.type || '').trim() || 'string';
    const operators = Array.isArray(def.operators) ? def.operators.map((x) => String(x)) : [];
    if (!field || !operators.includes(op)) {
      errors.push({
        code: 'UNSUPPORTED_FILTER_OPERATOR',
        key,
        message: `Operator '${op}' is not supported for '${strictFilterKey}'.`,
      });
      continue;
    }

    if (strictFilterKey === 'needsAttention' && op === 'eq') {
      const boolVal = parseBoolean(rawValue);
      if (boolVal === null) {
        errors.push({ code: 'INVALID_FILTER_VALUE', key, message: `Invalid boolean value for '${strictFilterKey}'.` });
        continue;
      }
      const threshold = Number(def.attentionThreshold || 80);
      whereClauses.push({ attentionScore: boolVal ? { gte: threshold } : { lt: threshold } });
      parsed.push({ key: strictFilterKey, op });
      continue;
    }

    if (op === 'eq') {
      const v = parseScalar(type, rawValue);
      if (v === null) {
        errors.push({ code: 'INVALID_FILTER_VALUE', key, message: `Invalid value for '${strictFilterKey}.${op}'.` });
        continue;
      }
      const clause = buildPathClause(field, v);
      if (clause) whereClauses.push(clause);
      parsed.push({ key: strictFilterKey, op });
      continue;
    }

    if (op === 'contains' || op === 'prefix') {
      const v = String(rawValue ?? '').trim();
      if (!v) {
        errors.push({ code: 'INVALID_FILTER_VALUE', key, message: `Invalid value for '${strictFilterKey}.${op}'.` });
        continue;
      }
      const clause =
        op === 'prefix'
          ? buildPathClause(field, { startsWith: v, mode: 'insensitive' })
          : buildPathClause(field, { contains: v, mode: 'insensitive' });
      if (clause) whereClauses.push(clause);
      parsed.push({ key: strictFilterKey, op });
      continue;
    }

    if (op === 'in') {
      const vals = parseIn(type, rawValue);
      if (!vals.length) {
        errors.push({ code: 'INVALID_FILTER_VALUE', key, message: `Invalid value for '${strictFilterKey}.${op}'.` });
        continue;
      }
      if (vals.length > MAX_IN_LIST) {
        errors.push({ code: 'IN_LIST_TOO_LONG', key, message: `Too many values for '${strictFilterKey}.in'. Maximum is ${MAX_IN_LIST}.` });
        continue;
      }
      const clause = buildPathClause(field, { in: vals });
      if (clause) whereClauses.push(clause);
      parsed.push({ key: strictFilterKey, op });
      continue;
    }

    if (op === 'gte' || op === 'lte') {
      const v = parseScalar(type, rawValue);
      if (v === null) {
        errors.push({ code: 'INVALID_FILTER_VALUE', key, message: `Invalid value for '${strictFilterKey}.${op}'.` });
        continue;
      }
      const clause = buildPathClause(field, { [op]: v });
      if (clause) whereClauses.push(clause);
      parsed.push({ key: strictFilterKey, op });
      continue;
    }

    if (op === 'between') {
      const rng = parseBetween(type, rawValue);
      if (!rng) {
        errors.push({ code: 'INVALID_FILTER_VALUE', key, message: `Invalid value for '${strictFilterKey}.${op}'.` });
        continue;
      }
      if (type === 'date') {
        const start = new Date(String(rng.start));
        const end = new Date(String(rng.end));
        const diffDays = Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        if (Number.isFinite(diffDays) && diffDays > MAX_BETWEEN_DATE_SPAN_DAYS) {
          errors.push({
            code: 'DATE_RANGE_TOO_WIDE',
            key,
            message: `Date range for '${strictFilterKey}.between' is too wide (max ${MAX_BETWEEN_DATE_SPAN_DAYS} days).`,
          });
          continue;
        }
      }
      const clause = buildPathClause(field, { gte: rng.start, lte: rng.end });
      if (clause) whereClauses.push(clause);
      parsed.push({ key: strictFilterKey, op });
      continue;
    }
  }

  return { whereClauses, parsed, errors };
}

