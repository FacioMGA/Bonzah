import { policiesClient as api } from '@/src/modules/policies/api/policiesClient';
import {
  mapPolicyListResponse,
  type PolicyListRecord,
  type PolicyReferralSummary,
} from '@/src/modules/policies/api/mappers/policyListMapper';
import type { RecordListAdapter } from '@/src/shared/core/recordList/types';
import { policyListRegistry } from './policyListRegistry';
import {
  parsePolicyListFeed,
  POLICY_LIST_FEED_PARAM,
  POLICY_LIST_VIEW_PARAM,
  resolvePolicyListSavedView,
} from './policyListFeeds';
import { USE_POLICY_STATE } from '../model/policyStateFlag';

export type PolicyListItem = {
  id: string;
  policyId?: string;
  policyNumber?: string;
  productType?: string;
  segment?: string;
  name?: string;
  insuredName?: string;
  status?: string;
  bo_status?: string | null;
  statusSortRank?: number | null;
  bo_statusSortRank?: number | null;
  start?: string;
  end?: string;
  createdAt?: string;
  updatedAt?: string;
  premium?: number;
  currency?: string;
  totalPremium?: number;
  renewalDate?: string;
  quoteExpiryDate?: string;
  cancellationPending?: boolean;
  customerActionRequired?: boolean;
  uwActionRequired?: boolean;
  quoteData?: PolicyQuoteData;
  vehicleDisplay?: string;
  policyholderEmail?: string | null;
  policyholderPhone?: string | null;
  referralSummary?: PolicyReferralSummary | null;
};

const BO_POLICY_PAGE_SIZE_DEFAULT = 12;

// `spine/v2` Wave 5: dropped the `VehicleInfo` shape. Pre-Wave-5 the
// policies list rendered a parallel `vehicleInfo` payload alongside
// `quoteData`; the read API now only sends `quoteData` and the
// adapter's `vehicleDisplay` reads `quoteData.{year,make,model}`
// directly. Motor consumers needing the same shape downstream should
// derive it from `quoteData`.
export type PolicyQuoteData = {
  year?: string | number;
  make?: string;
  model?: string;
  fuelType?: string;
  engineSize?: string | number;
  vehicleValue?: number;
  coverRequired?: string;
  [k: string]: unknown;
};

type PolicyHolderContact = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
};

type CursorPagination = {
  mode: 'cursor';
  hasMore: boolean;
  nextCursor?: string | null;
  total?: number;
};

const safeJson = <T,>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
};

export const policiesAdapter: RecordListAdapter<PolicyListItem> = {
  capabilities: { totalCount: true, serverSort: true },
  fetchPage: async ({ query, cursor, limit, signal, wantsTotal }) => {
    void signal; // api.listPolicies does not accept AbortSignal yet

    const statusRaw = query.filters?.status;
    const status = typeof statusRaw === 'string' && statusRaw.trim() ? statusRaw.trim() : undefined;
    const filterOps: Record<string, string> = {};
    for (const [id, rawValue] of Object.entries(query.filters || {})) {
      let key = id;
      let op: string = 'eq';
      const lastUnderscore = id.lastIndexOf('_');
      if (lastUnderscore > 0) {
        const maybeOp = id.slice(lastUnderscore + 1);
        if (['eq', 'in', 'gte', 'lte', 'between', 'contains', 'prefix'].includes(maybeOp)) {
          key = id.slice(0, lastUnderscore);
          op = maybeOp;
        }
      }
      const def = policyListRegistry.filters[key];
      if (!def) continue;
      const value = String(rawValue || '').trim().toLowerCase();
      if (!value) continue;
      if (def.type === 'boolean' && op === 'eq') {
        const bool = value === 'yes' ? 'true' : value === 'no' ? 'false' : '';
        if (bool) filterOps[`f.${key}.${op}`] = bool;
      } else if (def.type === 'enum' && (op === 'eq' || op === 'in')) {
        filterOps[`f.${key}.${op}`] = String(rawValue || '').trim();
      } else if (['number', 'date', 'string'].includes(def.type) && ['eq', 'in', 'gte', 'lte', 'between', 'contains', 'prefix'].includes(op)) {
        filterOps[`f.${key}.${op}`] = String(rawValue || '').trim();
      }
    }
    const queryWithSorts = query as typeof query & {
      sorts?: Array<{ field?: string; direction?: 'asc' | 'desc' }>;
    };
    const sorts = (Array.isArray(queryWithSorts.sorts) && queryWithSorts.sorts.length
      ? queryWithSorts.sorts
      : query.sort
        ? [query.sort]
        : []
    ).slice(0, 3);
    const primary = sorts[0];
    const secondary = sorts[1];
    const tertiary = sorts[2];
    const sortField = primary?.field ? String(primary.field) : undefined;
    const sortDir = primary?.direction === 'asc' ? 'asc' : primary?.direction === 'desc' ? 'desc' : undefined;
    const sortField2 = secondary?.field ? String(secondary.field) : undefined;
    const sortDir2 = secondary?.direction === 'asc' ? 'asc' : secondary?.direction === 'desc' ? 'desc' : undefined;
    const sortField3 = tertiary?.field ? String(tertiary.field) : undefined;
    const sortDir3 = tertiary?.direction === 'asc' ? 'asc' : tertiary?.direction === 'desc' ? 'desc' : undefined;
    const viewId = typeof window !== 'undefined'
      ? (() => {
          const params = new URLSearchParams(window.location.search);
          const savedView = resolvePolicyListSavedView(
            params.get(POLICY_LIST_VIEW_PARAM),
            policyListRegistry.defaultSavedViews,
          );
          if (savedView) return params.get(POLICY_LIST_VIEW_PARAM) || undefined;
          const feed = parsePolicyListFeed(params.get(POLICY_LIST_FEED_PARAM));
          if (feed !== 'all') return feed;
          return String(window.localStorage.getItem('recordList.activeView.policies') || '').trim() || undefined;
        })()
      : undefined;

    const rawResp = await api.listPolicies({
      paging: 'cursor',
      limit: Number(limit || BO_POLICY_PAGE_SIZE_DEFAULT),
      productType: undefined,
      q: query.search ? String(query.search) : undefined,
      status,
      projection: 'compact',
      cursor,
      includeTotal: Boolean(wantsTotal),
      sortField,
      sortDir,
      sortField2,
      sortDir2,
      sortField3,
      sortDir3,
      viewId,
      filterOps,
    });
    const resp = mapPolicyListResponse(rawResp);
    if (!resp?.success) {
      const code = String(resp?.error?.code || '').trim();
      const message = String(resp?.error?.message || 'Failed to load policies').trim();
      if (code === 'INVALID_FILTER_QUERY') {
        throw new Error('This view uses outdated or invalid filters. Please reset filters or update the saved view.');
      }
      throw new Error(message || 'Failed to load policies');
    }

    const policies: PolicyListRecord[] = Array.isArray(resp?.data) ? resp.data : [];

    const mapped: PolicyListItem[] = policies.map((p) => {
      const quoteData: PolicyQuoteData = safeJson<PolicyQuoteData>(p.quoteData, {});
      const holder = p.policyHolder ?? {};
      const holderContact = safeJson<PolicyHolderContact>(holder.contact, {});
      const insuredName =
        p.policyholderDisplay ||
        holder.name ||
        p.insuredName ||
        p.insuredDisplay ||
        p.name ||
        [holderContact?.firstName, holderContact?.lastName].filter(Boolean).join(' ').trim() ||
        'Unknown';

      const premium = Number(p.totalPremium ?? p.premium ?? 0) || 0;
      const policyId = String(p.policyId || p.id || '').trim();
      const id = policyId || String(p.id || p.policyId || '').trim();

      return {
        ...p,
        id,
        policyId: id,
        policyNumber: p.policyNumber || id,
        name: insuredName,
        productType: p.productType || undefined,
        segment: p.segment,
        quoteData,
        vehicleDisplay:
          p.vehicleDisplay
            ? String(p.vehicleDisplay)
            : quoteData.make && quoteData.model
            ? `${quoteData.year || ''} ${quoteData.make} ${quoteData.model}`.trim()
            : 'Vehicle Info',
        start: p.coverageStart || p.startDate || p.inceptionDate || 'N/A',
        end: p.coverageEnd || p.endDate || p.expiryDate || 'N/A',
        renewalDate: p.renewalDate,
        quoteExpiryDate: p.quoteExpiryDate,
        status: USE_POLICY_STATE ? (p.bo_status || p.status || 'DRAFT') : (p.status || 'DRAFT'),
        bo_status: p.bo_status || null,
        statusSortRank: p.statusSortRank ?? null,
        bo_statusSortRank: p.bo_statusSortRank ?? null,
        customerActionRequired: Boolean(p.customerActionRequired),
        uwActionRequired: Boolean(p.uwActionRequired),
        premium,
        currency: 'EUR',
        policyholderEmail: p.policyholderEmail || holderContact?.email || null,
        policyholderPhone: p.policyholderPhone || holderContact?.phone || null,
        referralSummary: p.referralSummary || null,
      };
    });

    const pagination = resp?.pagination;
    const limitNum = Number(limit || BO_POLICY_PAGE_SIZE_DEFAULT);
    const isCursorPagination =
      Boolean(pagination) &&
      typeof pagination === 'object' &&
      pagination !== null &&
      'mode' in pagination &&
      (pagination as { mode?: string }).mode === 'cursor';

    const hasMore = Boolean(isCursorPagination ? (pagination as CursorPagination).hasMore : (mapped.length >= limitNum));
    const nextCursor =
      isCursorPagination && (pagination as CursorPagination).nextCursor
        ? String((pagination as CursorPagination).nextCursor)
        : null;
    const total = (pagination && typeof (pagination as { total?: unknown }).total === 'number')
      ? Number((pagination as { total: number }).total)
      : undefined;

    return { items: mapped, hasMore, nextCursor, total };
  },
};
