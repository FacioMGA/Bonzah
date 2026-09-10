import React from 'react';
import { BinderCard } from './BinderCard';
import type { BinderIndexRow } from '../model/readModels';
import type { MobileCardSlotOpts } from '@/src/shared/core/recordList/types';

type BinderCardListProps = {
  rows: BinderIndexRow[];
} & MobileCardSlotOpts;

export function BinderCardList({ rows, hasMore, isFetchingMore, loadMore }: BinderCardListProps) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((binder, i) => (
        <BinderCard key={String(binder.id)} binder={binder} index={i} />
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
          No binders found
        </div>
      )}
    </div>
  );
}
