import React from 'react';
import { ClaimCard } from './ClaimCard';
import type { BoClaimListItem } from './claimsAdapter';
import type { MobileCardSlotOpts } from '../../../../shared/core/recordList/types';

type ClaimCardListProps = {
  rows: BoClaimListItem[];
} & MobileCardSlotOpts;

export function ClaimCardList({ rows, hasMore, isFetchingMore, loadMore }: ClaimCardListProps) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((claim, i) => (
        <ClaimCard key={String(claim.id)} claim={claim} index={i} />
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
          No claims found
        </div>
      )}
    </div>
  );
}
