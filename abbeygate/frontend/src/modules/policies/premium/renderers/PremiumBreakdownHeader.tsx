import React from 'react';
import { Button } from '@/src/shared/ui';

type PremiumBreakdownHeaderProps = {
  coverageDirty: boolean;
  needsUwReason: boolean;
  onOpenPricingSteps: () => void;
};

export function PremiumBreakdownHeader({
  coverageDirty,
  needsUwReason,
  onOpenPricingSteps,
}: PremiumBreakdownHeaderProps) {
  return (
    <div className="px-10 py-6 bg-slate-50/60 border-b border-slate-200/60 flex items-center justify-between gap-4 flex-wrap">
      <div className="text-[11px] font-black text-slate-600 uppercase tracking-widest">Pricing breakdown</div>
      <div className="flex items-center gap-3">
        {coverageDirty && (
          <div className="px-3 py-2 rounded-2xl bg-amber-100/70 text-amber-900 text-[10px] font-black uppercase tracking-widest">
            Recalculate required
          </div>
        )}
        {needsUwReason && (
          <div className="px-3 py-2 rounded-2xl bg-rose-100/70 text-rose-900 text-[10px] font-black uppercase tracking-widest">
            Reason required
          </div>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onOpenPricingSteps}
          title="View rating steps & inputs used"
          className="opacity-60 hover:opacity-100 transition text-slate-500 hover:text-slate-900 bg-transparent !p-0"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Z" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
        </Button>
      </div>
    </div>
  );
}
