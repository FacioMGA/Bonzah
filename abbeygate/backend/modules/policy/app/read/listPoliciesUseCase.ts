import type { Prisma } from '@prisma/client';
import { mapPolicyListRows } from './listPolicies.mapper.js';
import { termScopedPolicyWhere } from '../policyTermFamily.js';
import { buildEmptyLeadExclusionWhere, shouldIncludeEmptyLeads, stableEmptyLeadNow } from './emptyLeadListFilter.js';

type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

type SortRule = { field: string; direction: 'asc' | 'desc' };

type ListPoliciesActor = {
  role?: string;
  primaryAccountId?: string;
  email?: string;
};

/**
 * Build the policy-where OR clauses that scope the listing to a single
 * authenticated customer.
 *
 * The scope must cover three classes of policy ownership:
 *
 *   1. Linked policies — `policy.accountId === actor.primaryAccountId`.
 *      This is the steady-state case once `/auth/verify-email` has run
 *      its sweep, or when the policy was bound while the customer was
 *      logged in (see `CreateFromQuote.ts:170-192`).
 *
 *   2. Policy-holder contact match — the customer email lives in
 *      `policyHolder.contact` (a JSON-stringified blob written at
 *      policy creation, see `CreateFromQuote.ts:156-163`). Case
 *      insensitive substring match catches typos in casing.
 *
 *   3. Quote-data email match — the customer email lives in the
 *      `policy.quoteData` JSON. This is the gap that PR-1C closes:
 *      newly bound public-flow policies that the verify-email sweep
 *      has not yet linked may carry the email exclusively on
 *      `quoteData.proposer.email` (canonical). Without this, a freshly paid policy would never
 *      surface in the customer's `/client/policies` listing until the
 *      next verify-email sweep ran.
 *
 * If neither account nor email is available, return a never-match
 * clause so we don't leak other customers' policies.
 */
export function buildCustomerPolicyEmailMatchOr(rawEmail: string): Prisma.PolicyWhereInput[] {
  const email = String(rawEmail || '').trim();
  if (!email) return [];

  const or: Prisma.PolicyWhereInput[] = [
    { policyHolder: { contact: { contains: email, mode: 'insensitive' } } },
  ];

  // Prisma JSON-path predicates are case-sensitive. Most write
  // paths normalize email to its as-typed casing, so we match
  // both as-typed and lowercase variants to cover the realistic
  // mismatch surface (user signs in with `Effie@…` after the
  // public quote stored `effie@…`).
  const emailVariants = Array.from(new Set([email, email.toLowerCase()]));
  for (const variant of emailVariants) {
    or.push({ quoteData: { path: ['proposer', 'email'], equals: variant } });
  }

  return or;
}

export function buildCustomerPolicyScopeOr(actor: ListPoliciesActor | null | undefined): Prisma.PolicyWhereInput[] {
  const primaryAccountId = actor?.primaryAccountId ? String(actor.primaryAccountId).trim() : '';
  const rawEmail = String(actor?.email || '').trim();
  const or: Prisma.PolicyWhereInput[] = [];

  if (primaryAccountId) {
    or.push({ accountId: primaryAccountId });
  }

  if (rawEmail) {
    or.push(...buildCustomerPolicyEmailMatchOr(rawEmail));
  }

  return or.length ? or : [{ id: '__no_access__' }];
}

type ParsedFilters = {
  errors: unknown[];
  whereClauses: Prisma.PolicyListIndexWhereInput[];
};

type ListPoliciesInput = {
  query: Record<string, unknown>;
  actor: ListPoliciesActor | null | undefined;
  startedAtMs: number;
  /** Operating tenant id from the authenticated request. Used as the key for the
   *  per-tenant index-coverage TTL cache (debug-only path). */
  tenantId?: string;
};

type IndexCoverageEntry = { indexedPolicies: number; totalPolicies: number };

export type ListPoliciesUseCaseDeps = {
  helpers: {
    parseRecord(value: unknown): Record<string, unknown>;
    normalizeSortRules(input: {
      sortField?: unknown;
      sortDir?: unknown;
      sortField2?: unknown;
      sortDir2?: unknown;
      sortField3?: unknown;
      sortDir3?: unknown;
    }): SortRule[];
    buildOrderBy(sortRules: SortRule[]): Prisma.PolicyListIndexOrderByWithRelationInput[];
    buildPolicySearchOrClauses(qs: string): Prisma.PolicyListIndexWhereInput[];
    listFiltersFromQuery(q: Record<string, unknown>): Record<string, string>;
    shortHash(value: unknown): string;
    decodeCursor(token: unknown): { policyId?: string; rules?: Array<{ field?: string; direction?: string; value?: unknown }> } | null;
    encodeCursor(payload: unknown): string;
    policySortType(field: string): 'date' | 'string' | 'number';
    normalizeCursorValue(type: 'date' | 'string' | 'number', raw: unknown): unknown;
    eqClause(field: string, value: unknown): Prisma.PolicyListIndexWhereInput;
    cmpClause(field: string, op: 'gt' | 'lt', value: unknown): Prisma.PolicyListIndexWhereInput;
    valueFromPolicy(item: Record<string, unknown>, field: string): unknown;
    readHotViewCache(key: string): { payload: unknown } | null;
    setHotViewCache(key: string, payload: unknown): void;
    hotViewCacheHitRatePct(): number;
    readIndexCoverageCache(tenantId: string): IndexCoverageEntry | null;
    setIndexCoverageCache(tenantId: string, payload: IndexCoverageEntry): void;
    stripVehicleSearchFromWhere(input: Prisma.PolicyListIndexWhereInput): Prisma.PolicyListIndexWhereInput;
    isVehicleSearchUnknownArgError(error: unknown): boolean;
    USE_POLICY_STATE: boolean;
  };
  filtering: {
    buildPolicyListWhereFromQuery(query: Record<string, unknown>): ParsedFilters;
  };
  repo: {
    findPolicyListIndexRows(args: {
      where: Prisma.PolicyListIndexWhereInput;
      take?: number;
      skip?: number;
      orderBy: Prisma.PolicyListIndexOrderByWithRelationInput[];
      isCompact: boolean;
    }): Promise<Array<Record<string, unknown>>>;
    countPolicyListIndex(where?: Prisma.PolicyListIndexWhereInput): Promise<number>;
    countPoliciesAutoInsurance(): Promise<number>;
  };
  logger: {
    info(meta: Record<string, unknown>, message: string): void;
    warn(meta: Record<string, unknown>, message: string): void;
  };
};

function toUpper(value: unknown): string {
  return String(value || '').toUpperCase();
}

export async function listPoliciesUseCase(
  input: ListPoliciesInput,
  deps: ListPoliciesUseCaseDeps
): Promise<UseCaseResult> {
  const {
    q,
    page = '1',
    pageSize = '100',
    projection,
    paging,
    cursor,
    limit,
    includeTotal,
    sortField,
    sortDir,
    sortField2,
    sortDir2,
    sortField3,
    sortDir3,
  } = deps.helpers.parseRecord(input.query);
  const actor = input.actor;
  const role = toUpper(actor?.role || 'ANON');
  const queryRecord = deps.helpers.parseRecord(input.query);
  const includeHistoricalTerms = String(queryRecord.includeHistoricalTerms || '').trim().toLowerCase() === 'true';
  const viewId = String(queryRecord.viewId || '').trim() || 'adhoc';
  const sortRules = deps.helpers.normalizeSortRules({ sortField, sortDir, sortField2, sortDir2, sortField3, sortDir3 });

  const maxPageSize = 100;
  const requestedPageSize = Math.max(1, Math.min(Number(pageSize) || 1, maxPageSize));
  const pageNumber = Math.max(1, Number(page) || 1);
  const skip = (pageNumber - 1) * requestedPageSize;
  const take = requestedPageSize;

  const where: Prisma.PolicyListIndexWhereInput = {};
  if (q) {
    const qs = String(q || '').trim();
    if (qs) {
      where.OR = deps.helpers.buildPolicySearchOrClauses(qs);
    }
  }

  const productTypeFilter = String(queryRecord.productType || '').trim().toUpperCase();
  const basePolicyWhere: Prisma.PolicyWhereInput = productTypeFilter
    ? { productType: productTypeFilter }
    : {};
  const policyWhere: Prisma.PolicyWhereInput = termScopedPolicyWhere(
    basePolicyWhere,
    { includeHistoricalTerms }
  );
  if (toUpper(actor?.role) === 'CUSTOMER') {
    policyWhere.OR = buildCustomerPolicyScopeOr(actor);
  }
  where.policy = policyWhere;

  const parsedFilters = deps.filtering.buildPolicyListWhereFromQuery(input.query);
  const filtersHash = deps.helpers.shortHash({ q: String(q || '').trim(), filters: deps.helpers.listFiltersFromQuery(queryRecord) });
  deps.logger.info(
    {
      viewId,
      role,
      sort: sortRules,
      filtersHash,
      cursorDepth: 0,
    },
    'policy_list.query'
  );

  if (parsedFilters.errors.length > 0) {
    deps.logger.warn(
      {
        viewId,
        role,
        filtersHash,
        errors: parsedFilters.errors,
      },
      'policy_list.query_invalid'
    );
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'INVALID_FILTER_QUERY',
          message: 'One or more filters are invalid for the current policies list registry.',
          details: parsedFilters.errors,
        },
      },
    };
  }

  // Empty, stale, contactless quote-starts are hidden from the BO list by
  // default so the workspace stays tidy (ADR-0069). The rows stay in the
  // database — pass includeEmptyLeads=true to surface them again.
  const includeEmptyLeads = shouldIncludeEmptyLeads(queryRecord.includeEmptyLeads);
  const andClauses: Prisma.PolicyListIndexWhereInput[] = [where];
  if (!includeEmptyLeads) {
    // Day-bucketed cutoff keeps the exclusion stable across the hot-view cache
    // lifetime — a raw ms timestamp would poison the semantic cache key and
    // force every list request to the database (see stableEmptyLeadNow).
    andClauses.push(buildEmptyLeadExclusionWhere(stableEmptyLeadNow()));
  }
  andClauses.push(...parsedFilters.whereClauses);
  const effectiveWhere = andClauses.length > 1 ? { AND: andClauses } : where;

  const proj = String(projection || '').trim().toLowerCase();
  const isCompact = proj === 'compact' || proj === 'list' || proj === 'light';
  const pagingMode = String(paging || '').trim().toLowerCase();
  const wantsCursor = pagingMode === 'cursor' || Boolean(cursor) || Boolean(limit);
  const orderBy = deps.helpers.buildOrderBy(sortRules);

  // PR2: index-coverage metric is ops/debug only; gate behind ?debug=1 so the
  // hot list path no longer pays for two unfiltered counts on every request.
  const debugRaw = String(queryRecord.debug || '').trim().toLowerCase();
  const wantsCoverageMeta = debugRaw === '1' || debugRaw === 'true';
  const tenantId = String(input.tenantId || '').trim();
  const fetchIndexCoverage = async (): Promise<IndexCoverageEntry | null> => {
    if (!wantsCoverageMeta) return null;
    if (tenantId) {
      const cached = deps.helpers.readIndexCoverageCache(tenantId);
      if (cached) return cached;
    }
    const [indexedPolicies, totalPolicies] = await Promise.all([
      deps.repo.countPolicyListIndex(),
      deps.repo.countPoliciesAutoInsurance(),
    ]);
    const payload: IndexCoverageEntry = { indexedPolicies, totalPolicies };
    if (tenantId) deps.helpers.setIndexCoverageCache(tenantId, payload);
    return payload;
  };
  const buildBaseMeta = (coverage: IndexCoverageEntry | null) => {
    const baseMeta: Record<string, unknown> = {
      cacheHit: false,
      cacheHitRatePct: deps.helpers.hotViewCacheHitRatePct(),
    };
    if (coverage) {
      baseMeta.indexCoveragePct = coverage.totalPolicies > 0
        ? Number(((coverage.indexedPolicies / coverage.totalPolicies) * 100).toFixed(2))
        : 100;
      baseMeta.partialResults = coverage.totalPolicies > 0 && coverage.indexedPolicies < coverage.totalPolicies;
    }
    return baseMeta;
  };

  if (wantsCursor) {
    const maxLimit = 100;
    const requestedLimit = Math.max(1, Math.min(Number(limit) || 12, maxLimit));
    const shouldIncludeTotal = String(includeTotal || '').trim() === '1' || String(includeTotal || '').toLowerCase() === 'true';
    const decoded = deps.helpers.decodeCursor(cursor);
    const cursorDepth = Array.isArray(decoded?.rules) ? decoded.rules.length : 0;
    const cursorPolicyId = String(decoded?.policyId || '').trim();
    const cursorRules = Array.isArray(decoded?.rules) ? decoded.rules : [];
    const cursorMatchesSort = JSON.stringify(cursorRules.map((r) => [String(r.field || ''), String(r.direction || '')])) ===
      JSON.stringify(sortRules.map((r) => [r.field, r.direction]));
    const cursorValues = cursorRules.map((r) => {
      const field = String(r.field || '');
      return deps.helpers.normalizeCursorValue(deps.helpers.policySortType(field), r.value);
    });

    const cursorWhere =
      cursorMatchesSort && cursorPolicyId && cursorValues.length === sortRules.length && cursorValues.every((v: unknown) => v !== null)
        ? {
          OR: [
            ...sortRules.map((rule, idx) => {
              const op = rule.direction === 'asc' ? 'gt' : 'lt';
              const andClauses: Prisma.PolicyListIndexWhereInput[] = [];
              for (let j = 0; j < idx; j += 1) andClauses.push(deps.helpers.eqClause(sortRules[j].field, cursorValues[j]));
              andClauses.push(deps.helpers.cmpClause(rule.field, op, cursorValues[idx]));
              return andClauses.length === 1 ? andClauses[0] : { AND: andClauses };
            }),
            {
              AND: [
                ...sortRules.map((rule, idx) => deps.helpers.eqClause(rule.field, cursorValues[idx])),
                { policyId: { [sortRules[0].direction === 'asc' ? 'gt' : 'lt']: cursorPolicyId } },
              ],
            },
          ],
        }
        : null;

    const cursorScopedWhere = cursorWhere ? { AND: [effectiveWhere, cursorWhere] } : effectiveWhere;
    const cacheEligible = role !== 'CUSTOMER' && !cursorPolicyId && !shouldIncludeTotal;
    const cacheKey = deps.helpers.shortHash({
      viewId,
      role,
      requestedLimit,
      projection: proj,
      sortRules,
      filtersHash,
      where: cursorScopedWhere,
    });
    if (cacheEligible) {
      const cached = deps.helpers.readHotViewCache(cacheKey);
      if (cached) {
        const cachedPayload = deps.helpers.parseRecord(cached.payload);
        const cachedMeta = deps.helpers.parseRecord(cachedPayload.meta);
        const cachedData = cachedPayload.data;
        const payload = {
          ...cachedPayload,
          meta: {
            ...cachedMeta,
            cacheHit: true,
            cacheHitRatePct: deps.helpers.hotViewCacheHitRatePct(),
          },
        };
        deps.logger.info({
          policyNumber: {
            viewId,
            role,
            filtersHash,
            cursorDepth,
            rowsReturned: Array.isArray(cachedData) ? cachedData.length : 0,
            rowsScannedEstimate: 0,
            durationMs: Date.now() - input.startedAtMs,
            cacheHit: true,
          },
        }, 'policy_list.result');
        return { status: 200, body: payload };
      }
    }

    const runCursorQuery = async (whereForRows: Prisma.PolicyListIndexWhereInput, whereForCount: Prisma.PolicyListIndexWhereInput) =>
      Promise.all([
        deps.repo.findPolicyListIndexRows({
          where: whereForRows,
          take: requestedLimit + 1,
          orderBy,
          isCompact,
        }),
        shouldIncludeTotal ? deps.repo.countPolicyListIndex(whereForCount) : Promise.resolve(null),
        fetchIndexCoverage(),
      ]);

    let policiesPlus: Array<Record<string, unknown>>;
    let total: number | null;
    let coverage: IndexCoverageEntry | null;
    try {
      [policiesPlus, total, coverage] = await runCursorQuery(cursorScopedWhere, effectiveWhere);
    } catch (error) {
      if (!deps.helpers.isVehicleSearchUnknownArgError(error)) throw error;
      const fallbackRowsWhere = deps.helpers.stripVehicleSearchFromWhere(cursorScopedWhere);
      const fallbackCountWhere = deps.helpers.stripVehicleSearchFromWhere(effectiveWhere);
      [policiesPlus, total, coverage] = await runCursorQuery(fallbackRowsWhere, fallbackCountWhere);
    }

    const hasMore = policiesPlus.length > requestedLimit;
    const policies = hasMore ? policiesPlus.slice(0, requestedLimit) : policiesPlus;
    const flatPolicies = mapPolicyListRows({
      rows: policies,
      isCompact,
      parseRecord: deps.helpers.parseRecord,
      usePolicyState: deps.helpers.USE_POLICY_STATE,
    });

    const last = policies[policies.length - 1];
    const nextCursor = last
      ? deps.helpers.encodeCursor({
        rules: sortRules.map((rule) => {
          const v = deps.helpers.valueFromPolicy(last, rule.field);
          return {
            field: rule.field,
            direction: rule.direction,
            value: v instanceof Date ? v.toISOString() : v,
          };
        }),
        policyId: last.policyId,
      })
      : null;

    const payload = {
      success: true,
      data: flatPolicies,
      meta: buildBaseMeta(coverage),
      pagination: {
        mode: 'cursor',
        limit: requestedLimit,
        hasMore,
        nextCursor,
        total: typeof total === 'number' ? total : undefined,
      },
    };
    if (cacheEligible) {
      deps.helpers.setHotViewCache(cacheKey, payload);
    }
    deps.logger.info({
      policyNumber: {
        viewId,
        role,
        filtersHash,
        cursorDepth,
        rowsReturned: flatPolicies.length,
        rowsScannedEstimate: policiesPlus.length,
        durationMs: Date.now() - input.startedAtMs,
        cacheHit: false,
      },
    }, 'policy_list.result');
    return { status: 200, body: payload };
  }

  const runPageQuery = async (whereForRows: Prisma.PolicyListIndexWhereInput) =>
    Promise.all([
      deps.repo.findPolicyListIndexRows({
        where: whereForRows,
        skip,
        take,
        orderBy,
        isCompact,
      }),
      deps.repo.countPolicyListIndex(whereForRows),
      fetchIndexCoverage(),
    ]);

  let policies: Array<Record<string, unknown>>;
  let total: number;
  let coverage: IndexCoverageEntry | null;
  try {
    [policies, total, coverage] = await runPageQuery(effectiveWhere);
  } catch (error) {
    if (!deps.helpers.isVehicleSearchUnknownArgError(error)) throw error;
    [policies, total, coverage] = await runPageQuery(deps.helpers.stripVehicleSearchFromWhere(effectiveWhere));
  }

  const flatPolicies = mapPolicyListRows({
    rows: policies,
    isCompact,
    parseRecord: deps.helpers.parseRecord,
    usePolicyState: deps.helpers.USE_POLICY_STATE,
  });
  const payload = {
    success: true,
    data: flatPolicies,
    meta: buildBaseMeta(coverage),
    pagination: {
      page: pageNumber,
      pageSize: requestedPageSize,
      total,
      totalPages: Math.ceil(total / requestedPageSize),
    },
  };
  deps.logger.info({
    policyNumber: {
      viewId,
      role,
      filtersHash,
      cursorDepth: 0,
      rowsReturned: flatPolicies.length,
      rowsScannedEstimate: policies.length,
      durationMs: Date.now() - input.startedAtMs,
      cacheHit: false,
    },
  }, 'policy_list.result');
  return { status: 200, body: payload };
}
