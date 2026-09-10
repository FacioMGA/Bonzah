import React, { useEffect, useRef, useState } from 'react';
import { Button, DateInput, Select } from '@/src/shared/ui';
import { http } from '@/src/shared/api/http';
import type { RecordListFilterDef } from '@/src/shared/core/recordList/types';

type FilterOption = { value: string; label: string };

type PoliciesFiltersModalProps = {
  open: boolean;
  onClose: () => void;
  configFilters: Array<RecordListFilterDef>;
  statusFilterDef: RecordListFilterDef | null;
  recommendationFilters: Array<RecordListFilterDef>;
  recommendationIconById: Record<string, string>;
  recommendedPulseId: string;
  setRecommendedPulseId: React.Dispatch<React.SetStateAction<string>>;
  draftFilters: Record<string, unknown>;
  setDraftFilters: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  premiumFilterDef: RecordListFilterDef | null;
  premiumMinBound: number;
  premiumMaxBound: number;
  premiumBins: number[];
  activePremiumBound: 'min' | 'max' | null;
  setActivePremiumBound: (side: 'min' | 'max' | null) => void;
  setDraftNumberRangeFilter: (id: string, side: 'start' | 'end', nextValue: string) => void;
  orderedDateFilters: Array<RecordListFilterDef>;
  applyDraftFilters: () => void;
  countFilters: (filters: Record<string, unknown>, search: string, signal?: AbortSignal) => Promise<number | null>;
  searchInput: string;
  normalizeDraftFilters: (source: Record<string, unknown>) => Record<string, unknown>;
  draftPoliciesCount: number | null;
  setDraftPoliciesCount: React.Dispatch<React.SetStateAction<number | null>>;
  total: number | undefined;
  rowsLength: number;
};

export function PoliciesFiltersModal(props: PoliciesFiltersModalProps) {
  const {
    open,
    onClose,
    configFilters,
    statusFilterDef,
    recommendationFilters,
    recommendationIconById,
    recommendedPulseId,
    setRecommendedPulseId,
    draftFilters,
    setDraftFilters,
    premiumFilterDef,
    premiumMinBound,
    premiumMaxBound,
    premiumBins,
    activePremiumBound,
    setActivePremiumBound,
    setDraftNumberRangeFilter,
    orderedDateFilters,
    applyDraftFilters,
    countFilters,
    searchInput,
    normalizeDraftFilters,
    draftPoliciesCount,
    setDraftPoliciesCount,
    total,
    rowsLength,
  } = props;

  const [programOptions, setProgramOptions] = useState<FilterOption[]>([]);
  const [binderOptions, setBinderOptions] = useState<FilterOption[]>([]);

  // Load programs and binders once when the modal first opens.
  const optionsLoadedRef = useRef(false);
  useEffect(() => {
    if (!open || optionsLoadedRef.current) return;
    optionsLoadedRef.current = true;
    void (async () => {
      try {
        const [progResp, bindResp] = await Promise.all([
          http.request<{ id: string; name: string; status?: string }[]>('programs'),
          http.request<{ id: string; umr?: string; coverholderName?: string; agreementNumber?: string }[]>('binders'),
        ]);
        const progData = Array.isArray((progResp as { data?: unknown }).data) ? (progResp as { data: { id: string; name: string; status?: string }[] }).data : [];
        const bindData = Array.isArray((bindResp as { data?: unknown }).data) ? (bindResp as { data: { id: string; umr?: string; coverholderName?: string }[] }).data : [];
        setProgramOptions(
          progData
            .filter((p) => p.status !== 'ARCHIVED')
            .map((p) => ({ value: p.id, label: p.name || p.id }))
        );
        setBinderOptions(
          bindData.map((b) => ({
            value: b.id,
            label: b.umr ? `${b.umr}${b.coverholderName ? ` – ${b.coverholderName}` : ''}` : (b.coverholderName || b.id),
          }))
        );
      } catch {
        // ignore — the selects will just be empty
      }
    })();
  }, [open]);

  // Debounced live count: re-query with current draft filters to show accurate button count.
  const countAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      countAbortRef.current?.abort();
      const ctrl = new AbortController();
      countAbortRef.current = ctrl;
      const normalized = normalizeDraftFilters(draftFilters);
      const count = await countFilters(normalized, searchInput, ctrl.signal);
      if (count !== null) setDraftPoliciesCount(count);
    }, 450);
    return () => {
      clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftFilters, open]);

  const programFilterDef = configFilters.find((f) => f.id === 'program') ?? null;
  const binderFilterDef = configFilters.find((f) => f.id === 'binder') ?? null;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[220] !mt-0 !mb-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bo-filters-modal w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
          <div className="relative">
            <div className="text-xl font-bold text-slate-900 text-center">Filters</div>
            <button
              type="button"
              className="absolute right-0 top-1/2 -translate-y-1/2 text-2xl leading-none text-slate-500 hover:text-slate-800 transition-colors"
              onClick={onClose}
              aria-label="Close filters"
            >
              ×
            </button>
          </div>
        </div>
        <div className="space-y-6 px-6 py-5">
          {statusFilterDef ? (
            <div className="space-y-2">
              <label className="block text-[11px] font-black uppercase tracking-widest text-slate-400">Status</label>
              <Select
                className="ui-select py-3 text-sm font-semibold"
                value={String(draftFilters?.[statusFilterDef.id] || '')}
                onChange={(e) => setDraftFilters((prev) => ({ ...(prev || {}), [statusFilterDef.id]: e.target.value }))}
              >
                <option value="">{statusFilterDef.placeholder || 'All statuses'}</option>
                {(statusFilterDef.options || []).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </div>
          ) : null}

          {(programFilterDef || binderFilterDef) ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 pt-5">
              {programFilterDef && programOptions.length > 0 ? (
                <div className="space-y-2">
                  <label className="block text-[11px] font-black uppercase tracking-widest text-slate-400">Program</label>
                  <Select
                    className="ui-select py-3 text-sm font-semibold"
                    value={String(draftFilters?.[programFilterDef.id] || '')}
                    onChange={(e) => setDraftFilters((prev) => ({ ...(prev || {}), [programFilterDef.id]: e.target.value }))}
                  >
                    <option value="">All programs</option>
                    {programOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                </div>
              ) : null}
              {binderFilterDef && binderOptions.length > 0 ? (
                <div className="space-y-2">
                  <label className="block text-[11px] font-black uppercase tracking-widest text-slate-400">Binder</label>
                  <Select
                    className="ui-select py-3 text-sm font-semibold"
                    value={String(draftFilters?.[binderFilterDef.id] || '')}
                    onChange={(e) => setDraftFilters((prev) => ({ ...(prev || {}), [binderFilterDef.id]: e.target.value }))}
                  >
                    <option value="">All binders</option>
                    {binderOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                </div>
              ) : null}
            </div>
          ) : null}

          {recommendationFilters.length ? (
            <div className="space-y-3">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">Recommended for you</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {recommendationFilters.map((f) => {
                  const selected = String(draftFilters?.[f.id] || '') === 'yes';
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setDraftFilters((prev) => ({ ...(prev || {}), [f.id]: selected ? '' : 'yes' }));
                        setRecommendedPulseId(f.id);
                        window.setTimeout(() => setRecommendedPulseId((curr) => (curr === f.id ? '' : curr)), 260);
                      }}
                      className={`rounded-2xl border-2 px-3 py-4 text-left transition ${selected ? 'border-slate-900 bg-white text-slate-900' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'} ${recommendedPulseId === f.id ? 'bo-reco-bounce' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl flex items-center justify-center text-lg bg-slate-100">
                          {recommendationIconById[f.id] || '•'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold leading-tight">{f.label}</div>
                        </div>
                        <div className={`h-2.5 w-2.5 rounded-full ${selected ? 'bg-slate-900' : 'bg-slate-200'}`} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {premiumFilterDef ? (
            <div className="space-y-3 border-t border-slate-100 pt-5">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">Premium range</div>
              {(() => {
                const val = String(draftFilters?.[premiumFilterDef.id] || '');
                const [start, end] = val.includes('..') ? val.split('..') : ['', ''];
                const lower = Number(start || premiumMinBound || 0);
                const upper = Number(end || premiumMaxBound || premiumMinBound || 0);
                const safeMin = Number.isFinite(lower) ? lower : (premiumMinBound || 0);
                const safeMax = Number.isFinite(upper) ? upper : (premiumMaxBound || safeMin);
                const sliderMin = premiumMinBound || 0;
                const sliderMax = premiumMaxBound > sliderMin ? premiumMaxBound : sliderMin + 1;
                const leftPct = ((safeMin - sliderMin) / Math.max(1, sliderMax - sliderMin)) * 100;
                const rightPct = ((safeMax - sliderMin) / Math.max(1, sliderMax - sliderMin)) * 100;
                const bars = premiumBins.length ? premiumBins : Array.from({ length: 28 }, () => 0);
                return (
                  <div className="space-y-3">
                    <div className="h-16 w-full rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 flex items-end gap-1">
                      {bars.map((bin, idx) => {
                        const maxBin = Math.max(1, ...bars);
                        const h = premiumBins.length ? Math.max(8, Math.round((bin / maxBin) * 44)) : 8;
                        const binStartPct = (idx / Math.max(1, bars.length)) * 100;
                        const binEndPct = ((idx + 1) / Math.max(1, bars.length)) * 100;
                        const inSelectedRange = binEndPct >= leftPct && binStartPct <= rightPct;
                        return (
                          <div
                            key={`premium-bin-${idx}`}
                            className={`flex-1 rounded-t ${inSelectedRange ? 'bg-brand-primary' : 'bg-brand-primary/35'}`}
                            style={{ height: `${h}px` }}
                          />
                        );
                      })}
                    </div>
                    <div className="relative h-6">
                      <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-slate-200" />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-brand-primary"
                        style={{ left: `${Math.max(0, Math.min(100, leftPct))}%`, width: `${Math.max(0, Math.min(100, rightPct - leftPct))}%` }}
                      />
                      {/* When both thumbs are at the same position the max thumb must sit
                          above the min thumb so the user can drag it rightward. */}
                      <input
                        type="range"
                        min={sliderMin}
                        max={sliderMax}
                        value={Math.min(safeMin, safeMax)}
                        onPointerDown={() => setActivePremiumBound('min')}
                        onChange={(e) => {
                          setActivePremiumBound('min');
                          const nextStartNum = Math.min(Number(e.target.value), safeMax);
                          const nextEndNum = Number(end || safeMax);
                          setDraftFilters((prev) => ({
                            ...(prev || {}),
                            [premiumFilterDef.id]: `${nextStartNum}..${nextEndNum}`,
                          }));
                        }}
                        className={`bo-range-input bo-range-input--min absolute inset-0 w-full ${safeMin >= safeMax ? 'z-10' : 'z-20'}`}
                      />
                      <input
                        type="range"
                        min={sliderMin}
                        max={sliderMax}
                        value={Math.max(safeMin, safeMax)}
                        onPointerDown={() => setActivePremiumBound('max')}
                        onChange={(e) => {
                          setActivePremiumBound('max');
                          const nextEndNum = Math.max(Number(e.target.value), safeMin);
                          const nextStartNum = Number(start || safeMin);
                          setDraftFilters((prev) => ({
                            ...(prev || {}),
                            [premiumFilterDef.id]: `${nextStartNum}..${nextEndNum}`,
                          }));
                        }}
                        className={`bo-range-input bo-range-input--max absolute inset-0 w-full ${safeMin >= safeMax ? 'z-20' : 'z-10'}`}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className={`space-y-1 rounded-xl px-2 py-1 transition ${activePremiumBound === 'min' ? 'bg-brand-primary/10' : ''}`}>
                        <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">Min</div>
                        <input
                          type="number"
                          className="ui-input rounded-[0.6rem] text-sm font-semibold w-full"
                          value={start || ''}
                          min={premiumMinBound}
                          max={premiumMaxBound || undefined}
                          placeholder={premiumMinBound ? String(premiumMinBound) : '0'}
                          onFocus={() => setActivePremiumBound('min')}
                          onChange={(e) => setDraftNumberRangeFilter(premiumFilterDef.id, 'start', e.target.value)}
                        />
                      </div>
                      <div className={`space-y-1 text-right rounded-xl px-2 py-1 transition ${activePremiumBound === 'max' ? 'bg-brand-primary/10' : ''}`}>
                        <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">Max</div>
                        <input
                          type="number"
                          className="ui-input rounded-[0.6rem] text-sm font-semibold w-full text-right"
                          value={end || ''}
                          min={premiumMinBound || 0}
                          max={premiumMaxBound || undefined}
                          placeholder={premiumMaxBound ? String(premiumMaxBound) : '0'}
                          onFocus={() => setActivePremiumBound('max')}
                          onChange={(e) => setDraftNumberRangeFilter(premiumFilterDef.id, 'end', e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : null}

          {orderedDateFilters.length ? (
            <div className="space-y-4 border-t border-slate-100 pt-5">
              {orderedDateFilters.map((f) => {
                const raw = String(draftFilters?.[f.id] || '');
                const [start, end] = raw.includes('..') ? raw.split('..') : ['', ''];
                const setDateRangeSide = (side: 'start' | 'end', nextDate: string) => {
                  const nextStart = side === 'start' ? nextDate : start;
                  const nextEnd = side === 'end' ? nextDate : end;
                  setDraftFilters((prev) => ({ ...(prev || {}), [f.id]: (nextStart || nextEnd) ? `${nextStart}..${nextEnd}` : '' }));
                };

                return (
                  <div key={f.id}>
                    <label className="block text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">{f.label}</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">From</div>
                        <DateInput
                          value={start}
                          onChange={(nextDate) => setDateRangeSide('start', nextDate)}
                          aria-label={`${f.label} from`}
                          variant="ui"
                          className="bg-slate-50/50"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">To</div>
                        <DateInput
                          value={end}
                          onChange={(nextDate) => setDateRangeSide('end', nextDate)}
                          aria-label={`${f.label} to`}
                          variant="ui"
                          className="bg-slate-50/50"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-4">
          <Button
            variant="ghost"
            size="md"
            className="px-0 hover:bg-transparent text-slate-500 hover:text-slate-800"
            onClick={() => {
              const next: Record<string, unknown> = {};
              for (const f of configFilters) next[f.id] = String(f.defaultValue || '');
              if (premiumFilterDef?.id && premiumMaxBound > premiumMinBound) {
                next[premiumFilterDef.id] = `${premiumMinBound}..${premiumMaxBound}`;
              }
              setDraftFilters(next);
              setDraftPoliciesCount(typeof total === 'number' ? total : rowsLength);
            }}
          >
            Clear all
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              applyDraftFilters();
              onClose();
            }}
          >
            Show {typeof draftPoliciesCount === 'number' ? draftPoliciesCount : (typeof total === 'number' ? total : rowsLength)} Policies
          </Button>
        </div>
      </div>
    </div>
  );
}
