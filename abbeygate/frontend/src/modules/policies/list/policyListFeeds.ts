/**
 * BO Policies list feed presets — separate quotations from issued policies (ABY-474).
 *
 * Status sets align with the quote/bind stage split used across BO surfaces
 * (`policyPageHelpers`, `underwritingState`, operator search tools).
 */
export type PolicyListFeed = 'all' | 'quotations' | 'issued';

export const POLICY_LIST_FEED_PARAM = 'feed';
/**
 * Named worklist route used by the BO navigation.  The list registry remains
 * the source of truth for the actual filters and sort order; this is only the
 * stable, human-facing route key.
 */
export const POLICY_LIST_VIEW_PARAM = 'viewId';
export const RENEWAL_QUEUE_VIEW_ID = 'renewal_queue';

/** Pre-bind / quote-stage lifecycle statuses. */
export const QUOTATION_FEED_STATUSES = [
  'DRAFT',
  'INTAKE',
  'QUOTED',
  'REFERRAL',
  'INFO_REQUIRED',
  'AWAITING_PAYMENT',
  'DECLINED',
] as const;

/** Post-bind / issued-policy lifecycle statuses. */
export const ISSUED_FEED_STATUSES = [
  'ISSUED',
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
  'BOUND',
  'BOUND_DRAFT_ISSUED',
  'CANCELLATION_REQUESTED',
] as const;

export type PolicyListFeedDefinition = {
  label: string;
  entityLabel: string;
  searchHint: string;
  statusIn?: readonly string[];
  viewId: string;
};

export const POLICY_LIST_FEEDS: Record<PolicyListFeed, PolicyListFeedDefinition> = {
  all: {
    label: 'All policies',
    entityLabel: 'Policies',
    searchHint: 'Create, review, and manage policies and submissions.',
    viewId: 'all',
  },
  quotations: {
    label: 'Quotations',
    entityLabel: 'Quotations',
    searchHint: 'Draft and in-flight quotes awaiting bind or payment.',
    statusIn: QUOTATION_FEED_STATUSES,
    viewId: 'quotations',
  },
  issued: {
    label: 'Issued policies',
    entityLabel: 'Issued policies',
    searchHint: 'Bound and in-force policies, including active, expired, and cancelled.',
    statusIn: ISSUED_FEED_STATUSES,
    viewId: 'issued',
  },
};

export const POLICY_LIST_FEED_OPTIONS: Array<{ value: PolicyListFeed; label: string }> = (
  Object.entries(POLICY_LIST_FEEDS) as Array<[PolicyListFeed, PolicyListFeedDefinition]>
).map(([value, def]) => ({ value, label: def.label }));

export type PolicyListSavedView = {
  id: string;
  name: string;
  query: {
    search: string;
    filters: Record<string, string>;
    sorts: Array<{ field: string; direction: 'asc' | 'desc' }>;
  };
};

/**
 * Resolve a public route key to the canonical saved view in registry.json.
 * A bad key intentionally resolves to null: we must not silently substitute
 * another operational worklist.
 */
export function resolvePolicyListSavedView(
  rawViewId: string | null | undefined,
  savedViews: readonly PolicyListSavedView[],
): PolicyListSavedView | null {
  const viewId = String(rawViewId || '').trim().toLowerCase();
  if (viewId !== RENEWAL_QUEUE_VIEW_ID) return null;
  return savedViews.find((view) => view.id === 'default_policies_renewal_queue') || null;
}

/** Apply a saved view's owned filters without retaining a conflicting feed preset. */
export function applySavedViewToFilters(
  savedView: PolicyListSavedView,
  filters: UnknownRecord,
): UnknownRecord {
  const next: UnknownRecord = { ...(filters || {}) };
  if (savedView.query.filters.status) delete next.status_in;
  return { ...next, ...savedView.query.filters };
}

export function parsePolicyListFeed(raw: string | null | undefined): PolicyListFeed {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'quotations' || normalized === 'quotes' || normalized === 'quote') return 'quotations';
  if (normalized === 'issued' || normalized === 'policies' || normalized === 'issued_policies') return 'issued';
  return 'all';
}

export function buildFeedStatusInValue(feed: PolicyListFeed): string {
  const statuses = POLICY_LIST_FEEDS[feed].statusIn;
  return statuses?.length ? statuses.join(',') : '';
}

/** Apply/remove the feed-owned `status_in` preset without touching unrelated filters. */
export function applyFeedToFilters(
  feed: PolicyListFeed,
  filters: UnknownRecord,
): UnknownRecord {
  const next: UnknownRecord = { ...(filters || {}) };
  delete next.status_in;
  if (feed === 'all') return next;
  delete next.status;
  const statusIn = buildFeedStatusInValue(feed);
  if (statusIn) next.status_in = statusIn;
  return next;
}

/** True when a manual status filter overrides the feed preset. */
export function feedConflictsWithFilters(feed: PolicyListFeed, filters: UnknownRecord): boolean {
  if (feed === 'all') return false;
  const statusEq = String(filters?.status || '').trim();
  if (statusEq) return true;
  const statusIn = String(filters?.status_in || '').trim();
  if (!statusIn) return false;
  return statusIn !== buildFeedStatusInValue(feed);
}
import type { UnknownRecord } from '@/src/shared/lib/record';
