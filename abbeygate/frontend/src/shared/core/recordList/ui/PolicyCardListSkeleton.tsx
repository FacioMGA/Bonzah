import React from 'react';

type PolicyCardListSkeletonProps = {
  cardCount?: number;
};

export function PolicyCardListSkeleton({ cardCount = 6 }: PolicyCardListSkeletonProps) {
  const cards = Array.from({ length: Math.max(1, cardCount) }, (_, i) => i);
  return (
    <div className="flex flex-col gap-3 lg:hidden" aria-hidden="true">
      {cards.map((i) => (
        <div
          key={`policy-card-skeleton-${i}`}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          data-testid="policy-card-skeleton"
        >
          <div className="flex items-center justify-between">
            <div className="h-4 w-32 rounded-md bg-slate-100 animate-pulse" />
            <div className="h-5 w-20 rounded-full bg-slate-100 animate-pulse" />
          </div>
          <div className="mt-4 h-3 w-48 rounded-md bg-slate-100 animate-pulse" />
          <div className="mt-2 h-3 w-40 rounded-md bg-slate-100 animate-pulse" />
          <div className="mt-5 flex items-center justify-between">
            <div className="h-3 w-24 rounded-md bg-slate-100 animate-pulse" />
            <div className="h-5 w-16 rounded-md bg-slate-100 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
