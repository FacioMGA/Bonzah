import React from 'react';
import type { Worksheet } from '@/src/modules/claims/model/worksheetTypes';

type Props = {
  loading: boolean;
  worksheet: Worksheet | null;
  children: React.ReactNode;
};

export function ClaimsDeskDetail({ loading, worksheet, children }: Props) {
  return (
    <main className="ui-page max-w-none space-y-6 lg:space-y-8 min-w-0 pb-24">
      {loading ? <div className="text-sm font-semibold text-slate-500">Loading claim…</div> : null}
      {!worksheet ? (
        <div className="p-6 text-sm font-semibold text-slate-500">
          Claim not found.
        </div>
      ) : children}
    </main>
  );
}

