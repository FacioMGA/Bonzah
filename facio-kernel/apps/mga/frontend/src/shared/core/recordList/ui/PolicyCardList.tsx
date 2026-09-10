import React from 'react';
import { PolicyCard, type PolicyCardRow } from './PolicyCard';
import { PolicyCardListSkeleton } from './PolicyCardListSkeleton';

type PolicyCardListProps = {
  rows: PolicyCardRow[];
  hasMore: boolean;
  isFetching: boolean;
  isFetchingMore: boolean;
  loadMore: () => Promise<void>;
};

export function PolicyCardList({ rows, hasMore, isFetching, isFetchingMore, loadMore }: PolicyCardListProps) {
  if (rows.length === 0 && isFetching) {
    return <PolicyCardListSkeleton cardCount={6} />;
  }

  return (
    <div className="flex flex-col gap-3 lg:hidden">
      {rows.map((policy, i) => (
        <PolicyCard key={String(policy.id)} policy={policy} index={i} />
      ))}

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={isFetchingMore}
          className="w-full py-3 text-sm font-bold text-brand-primary bg-brand-primary-50 rounded-xl hover:bg-blue-100 active:bg-blue-200 transition-colors disabled:opacity-50"
        >
          {isFetchingMore ? 'Loading…' : 'Load more'}
        </button>
      )}

      {rows.length === 0 && (
        <div className="text-center py-12 text-sm text-slate-400">
          No policies found
        </div>
      )}
    </div>
  );
}
