import React from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Button, Select } from '@/src/shared/ui';
import { useRecordListController } from '@/src/shared/core/recordList/useRecordListController';
import { RecordListView } from '@/src/shared/core/recordList/ui/RecordListView';
import { policiesAdapter, type PolicyListItem } from '../policiesAdapter';
import { createPoliciesListConfig } from '../policiesListConfig';
import { usePolicyFilterOptions } from '../hooks/usePolicyFilterOptions';
import type { RecordListConfig } from '@/src/shared/core/recordList/types';
import { writeListQueryStateToUrl } from '@/src/shared/core/recordList/urlState';
import {
  applySavedViewToFilters,
  applyFeedToFilters,
  feedConflictsWithFilters,
  parsePolicyListFeed,
  POLICY_LIST_FEED_OPTIONS,
  POLICY_LIST_FEED_PARAM,
  POLICY_LIST_FEEDS,
  POLICY_LIST_VIEW_PARAM,
  RENEWAL_QUEUE_VIEW_ID,
  resolvePolicyListSavedView,
  type PolicyListFeed,
} from '../policyListFeeds';
import { policyListRegistry } from '../policyListRegistry';

export type PolicyListViewProps = {
  onRequestDeletePolicy?: (e: React.MouseEvent, id: string) => void;
  onCreateNewPolicy?: () => void;
};

export function PolicyListView(props: PolicyListViewProps) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const savedView = React.useMemo(
    () => resolvePolicyListSavedView(
      searchParams.get(POLICY_LIST_VIEW_PARAM),
      policyListRegistry.defaultSavedViews,
    ),
    [searchParams],
  );

  // Resolve the stable renewal route into the canonical saved-view query
  // before the record-list controller mounts.  The controller fetches from
  // its initial URL state, so an effect after mount would first request the
  // unfiltered Policies feed and briefly render its retained rows.
  const isFreshSavedViewRoute = savedView
    && Array.from(searchParams.keys()).every((key) => key === POLICY_LIST_VIEW_PARAM);
  if (isFreshSavedViewRoute && savedView) {
    const config = createPoliciesListConfig({});
    const nextParams = writeListQueryStateToUrl(config, {
      search: savedView.query.search,
      filters: applySavedViewToFilters(savedView, {}),
      sorts: savedView.query.sorts,
      sort: savedView.query.sorts[0] || null,
    }, searchParams);
    return <Navigate to={{ pathname: location.pathname, search: `?${nextParams.toString()}` }} replace />;
  }

  return <PolicyListWorkspace {...props} />;
}

function PolicyListWorkspace(props: PolicyListViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const feed = parsePolicyListFeed(searchParams.get(POLICY_LIST_FEED_PARAM));
  const savedView = React.useMemo(
    () => resolvePolicyListSavedView(
      searchParams.get(POLICY_LIST_VIEW_PARAM),
      policyListRegistry.defaultSavedViews,
    ),
    [searchParams],
  );
  const { programOptions, binderOptions } = usePolicyFilterOptions();

  const baseConfig = React.useMemo<RecordListConfig<PolicyListItem>>(
    () => createPoliciesListConfig({
      onRequestDeletePolicy: props.onRequestDeletePolicy,
      programOptions,
      binderOptions,
    }),
    [props.onRequestDeletePolicy, programOptions, binderOptions]
  );

  const config = React.useMemo<RecordListConfig<PolicyListItem>>(
    () => ({
      ...baseConfig,
      entityLabel: savedView ? 'Renewals' : POLICY_LIST_FEEDS[feed].entityLabel,
      searchHint: savedView
        ? 'Active policies ordered by renewal date, ready for renewal work.'
        : POLICY_LIST_FEEDS[feed].searchHint,
    }),
    [baseConfig, feed, savedView]
  );

  const controller = useRecordListController<PolicyListItem>({ adapter: policiesAdapter, config, limit: 25 });

  const setFeed = React.useCallback((nextFeed: PolicyListFeed) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextFeed === 'all') nextParams.delete(POLICY_LIST_FEED_PARAM);
    else nextParams.set(POLICY_LIST_FEED_PARAM, nextFeed);
    setSearchParams(nextParams, { replace: true });
    controller.setFilters(applyFeedToFilters(nextFeed, controller.filters));
  }, [controller, searchParams, setSearchParams]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(
      'recordList.activeView.policies',
      savedView ? RENEWAL_QUEUE_VIEW_ID : POLICY_LIST_FEEDS[feed].viewId,
    );
  }, [feed, savedView]);

  React.useEffect(() => {
    if (feedConflictsWithFilters(feed, controller.filters)) {
      const nextParams = writeListQueryStateToUrl(config, {
        search: controller.searchInput,
        filters: controller.filters,
        sorts: controller.sorts,
        sort: controller.sort,
      }, searchParams);
      nextParams.delete(POLICY_LIST_FEED_PARAM);
      setSearchParams(nextParams, { replace: true });
      return;
    }
    const expected = applyFeedToFilters(feed, controller.filters);
    const currentStatusIn = String(controller.filters?.status_in || '');
    const expectedStatusIn = String(expected.status_in || '');
    const currentStatus = String(controller.filters?.status || '');
    const expectedStatus = String(expected.status || '');
    const needsSync =
      currentStatusIn !== expectedStatusIn
      || (feed !== 'all' && currentStatus !== expectedStatus);
    if (needsSync) controller.setFilters(expected);
  }, [config, controller, controller.filters, feed, searchParams, setSearchParams]);

  return (
    <div className="ui-page max-w-none pt-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {savedView && (
            <div className="mb-3">
              <h1 className="text-xl font-black text-slate-900">{savedView.name}</h1>
              <p className="mt-1 text-sm font-medium text-slate-500">
                Your operational renewal worklist uses the existing Policies workspace, with active policies sorted by the next renewal date.
              </p>
            </div>
          )}
          <label htmlFor="policy-list-feed" className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
            Feed
          </label>
          <Select
            id="policy-list-feed"
            className="ui-select py-3 text-sm font-semibold min-w-[220px]"
            value={feed}
            onChange={(e) => setFeed(parsePolicyListFeed(e.target.value))}
            data-testid="policy-list-feed-select"
          >
            {POLICY_LIST_FEED_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </div>
      </div>
      <RecordListView<PolicyListItem>
        controller={controller}
        actions={(
          <Button onClick={() => props.onCreateNewPolicy?.()} size="lg">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New policy
          </Button>
        )}
      />
    </div>
  );
}
