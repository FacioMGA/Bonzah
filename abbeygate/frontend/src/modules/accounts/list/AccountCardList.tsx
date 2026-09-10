import React from 'react';
import { AccountCard } from './AccountCard';
import type { BoAccountListItem } from './accountsAdapter';
import type { MobileCardSlotOpts } from '@/src/shared/core/recordList/types';

type AccountCardListProps = {
  rows: BoAccountListItem[];
} & MobileCardSlotOpts;

export function AccountCardList({ rows, hasMore, isFetchingMore, loadMore }: AccountCardListProps) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((account, i) => (
        <AccountCard key={String(account.accountId)} account={account} index={i} />
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
          No accounts found
        </div>
      )}
    </div>
  );
}
