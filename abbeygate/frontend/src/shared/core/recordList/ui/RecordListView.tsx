import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/src/shared/ui';
import { IconButton } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';
import { PoliciesFiltersModal } from '@/src/shared/core/recordList/ui/PoliciesFiltersModal';
import { RecordListDataTable } from '@/src/shared/core/recordList/ui/RecordListDataTable';

import type { RecordListController } from '@/src/shared/core/recordList/useRecordListController';
import { trackFilterUsage, trackRowOpen, trackSortUsage } from '@/src/shared/core/recordList/personalization';
import { asRecord } from '@/src/shared/lib/record';

const RECOMMENDATION_FILTER_IDS = ['needsAttention', 'uwActionRequired', 'customerActionRequired', 'hasOpenClaim', 'invoiceOverdue', 'cancellationPending'];
const DATE_FILTER_ORDER = ['expiryDate_between', 'quoteExpiryDate_between', 'lastActivityAt_between'];

export function RecordListView<TItem>({
  controller,
  actions,
}: {
  controller: RecordListController<TItem>;
  actions?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const {
    config,
    searchInput,
    setSearchInput,
    filters,
    setFilterValue,
    clearFilters,
    sorts,
    setSorts,
    setFilters,
    isDebouncing,
    rows,
    total,
    hasMore,
    isFetching,
    isFetchingMore,
    error,
    loadMore,
    prefetchMore,
    countFilters,
  } = controller;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [activeRowIdx, setActiveRowIdx] = useState<number>(-1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<Record<string, unknown>>({});
  const [draftPoliciesCount, setDraftPoliciesCount] = useState<number | null>(null);
  const [recommendedPulseId, setRecommendedPulseId] = useState<string>('');
  const [sortPulseField, setSortPulseField] = useState<string>('');
  const [activePremiumBound, setActivePremiumBound] = useState<'min' | 'max' | null>(null);
  const filtersRef = useRef<HTMLDivElement | null>(null);

  const columns = config.columns;
  const sortableColumns = useMemo(() => columns.filter((c) => c.sortable && c.sortField), [columns]);
  const hasMobileCards = Boolean(config.mobileCardSlot);
  // Only the policies list uses the dedicated PoliciesFiltersModal — gate by config.id
  const isPoliciesList = config.id === 'policies';
  const recommendationIconById: Record<string, string> = {
    needsAttention: '⚡',
    uwActionRequired: '🧾',
    customerActionRequired: '🔎',
    hasOpenClaim: '🛠️',
    invoiceOverdue: '💳',
    cancellationPending: '🛑',
  };
  const recommendationFilters = useMemo(
    () => (config.filters || []).filter((f) => RECOMMENDATION_FILTER_IDS.includes(f.id)),
    [config.filters]
  );
  const sortIconByField: Record<string, string> = {
    attentionScore: '⚡',
    lastActivityAt: '🕒',
    updatedAt: '🕒',
    createdAt: '🆕',
    inceptionDate: '📅',
    expiryDate: '📆',
    renewalDate: '📆',
    quoteExpiryDate: '⏳',
    status: '🏷️',
    statusSortRank: '🏷️',
    policyNumber: '#',
    totalPremium: '💶',
  };
  const statusFilterDef = useMemo(
    () => (config.filters || []).find((f) => f.id === 'status') || null,
    [config.filters]
  );
  const premiumFilterDef = useMemo(
    () => (config.filters || []).find((f) => f.id === 'totalPremium_between') || null,
    [config.filters]
  );
  const orderedDateFilters = useMemo(
    () => (config.filters || []).filter((f) => DATE_FILTER_ORDER.includes(f.id)).sort((a, b) => DATE_FILTER_ORDER.indexOf(a.id) - DATE_FILTER_ORDER.indexOf(b.id)),
    [config.filters]
  );
  const premiumValues = useMemo(() => rows
    .map((r) => Number(asRecord(r)?.premium || asRecord(r)?.totalPremium || 0))
    .filter((n) => Number.isFinite(n) && n > 0), [rows]);
  const premiumMinBound = useMemo(() => premiumValues.length ? Math.floor(Math.min(...premiumValues)) : 0, [premiumValues]);
  const premiumMaxBound = useMemo(() => premiumValues.length ? Math.ceil(Math.max(...premiumValues)) : 0, [premiumValues]);
  const premiumBins = useMemo(() => {
    if (!premiumValues.length || premiumMinBound >= premiumMaxBound) return [] as number[];
    const binCount = 36;
    const span = premiumMaxBound - premiumMinBound;
    const step = Math.max(1, span / binCount);
    const bins = Array.from({ length: binCount }, () => 0);
    for (const value of premiumValues) {
      const idx = Math.min(binCount - 1, Math.floor((value - premiumMinBound) / step));
      bins[idx] += 1;
    }
    return bins;
  }, [premiumMaxBound, premiumMinBound, premiumValues]);
  const sortLabel = useMemo(() => {
    if (!Array.isArray(sorts) || sorts.length === 0) return 'Smart';
    return sorts
      .map((rule) => {
        const col = sortableColumns.find((c) => String(c.sortField) === String(rule.field));
        const name = col?.header || rule.field;
        return `${name} ${rule.direction}`;
      })
      .join(' > ');
  }, [sorts, sortableColumns]);

  const cycleSort = useCallback((field: string) => {
    if (!field) return;
    const current = (sorts || [])[0];
    if (!current || current.field !== field) {
      setSorts([{ field, direction: 'desc' }]);
      return;
    }
    if (current.direction === 'desc') {
      setSorts([{ field, direction: 'asc' }]);
      return;
    }
    setSorts([]);
  }, [setSorts, sorts]);

  const isInteractiveTarget = (target: EventTarget | null, currentTarget: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    const stopAt = currentTarget instanceof HTMLElement ? currentTarget : null;
    let el: HTMLElement | null = target;
    while (el) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'label') {
        return true;
      }
      if (stopAt && el === stopAt) break;
      el = el.parentElement;
    }
    return false;
  };

  const openRow = useCallback(
    (idx: number, opts?: { newTab?: boolean }) => {
      const item = rows[idx];
      if (!item) return;
      trackRowOpen(config.id, asRecord(item));
      const href = config.rowHref?.(item);
      if (href) {
        if (opts?.newTab) {
          window.open(href, '_blank', 'noopener,noreferrer');
          return;
        }
        const boScroll = document.getElementById('bo-content-scroll');
        if (boScroll && typeof boScroll.scrollTo === 'function') {
          boScroll.scrollTo({ top: 0, behavior: 'auto' });
          boScroll.scrollTop = 0;
        } else {
          window.scrollTo({ top: 0, behavior: 'auto' });
        }
        navigate(href);
        return;
      }
      // Best-effort fallback (no href): call row click if configured
      if (config.onRowClick) {
        // no MouseEvent here; list consumers should prefer rowHref for standard navigation
        config.onRowClick(item, null);
      }
    },
    [config, navigate, rows]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveRowIdx((prev) => Math.min(rows.length - 1, Math.max(-1, prev) + 1));
        return;
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveRowIdx((prev) => Math.max(-1, prev - 1));
        return;
      }
      if (e.key === 'Enter') {
        if (activeRowIdx >= 0) {
          e.preventDefault();
          openRow(activeRowIdx);
        }
      }
    },
    [activeRowIdx, openRow, rows.length]
  );

  useEffect(() => {
    if (!filtersOpen || isPoliciesList) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (filtersRef.current && filtersRef.current.contains(t)) return;
      setFiltersOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [filtersOpen, isPoliciesList]);

  useEffect(() => {
    if (!filtersOpen) return;
    const next: Record<string, unknown> = { ...(filters || {}) };
    if (isPoliciesList && premiumFilterDef?.id) {
      const current = String(next[premiumFilterDef.id] || '').trim();
      if (!current && premiumMaxBound > premiumMinBound) {
        next[premiumFilterDef.id] = `${premiumMinBound}..${premiumMaxBound}`;
      }
    }
    setDraftFilters(next);
    setDraftPoliciesCount(typeof total === 'number' ? total : rows.length);
  }, [filtersOpen, filters, isPoliciesList, orderedDateFilters, premiumFilterDef?.id, premiumMaxBound, premiumMinBound, rows.length, total]);

  useEffect(() => {
    if (Array.isArray(sorts) && sorts.length) trackSortUsage(config.id, sorts);
  }, [config.id, sorts]);

  useEffect(() => {
    trackFilterUsage(config.id, filters || {});
  }, [config.id, filters]);

  const setDraftNumberRangeFilter = useCallback((id: string, side: 'start' | 'end', nextValue: string) => {
    setDraftFilters((prev) => {
      const current = String(prev?.[id] || '');
      const [start, end] = current.includes('..') ? current.split('..') : ['', ''];
      const normalized = nextValue.trim();
      const nextStart = side === 'start' ? normalized : start;
      const nextEnd = side === 'end' ? normalized : end;
      const value = (nextStart || nextEnd) ? `${nextStart || ''}..${nextEnd || ''}` : '';
      return { ...(prev || {}), [id]: value };
    });
  }, []);

  const normalizeDraftFiltersForApply = useCallback((source: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const def of (config.filters || [])) {
      const raw = String(source?.[def.id] || '').trim();
      if (!raw) {
        out[def.id] = '';
        continue;
      }
      if (def.type === 'date-range' || def.type === 'number-range') {
        const [start, end] = raw.includes('..') ? raw.split('..') : ['', ''];
        out[def.id] = start && end ? `${start}..${end}` : '';
        continue;
      }
      out[def.id] = raw;
    }
    return out;
  }, [config.filters]);

  const applyDraftFilters = useCallback((source?: Record<string, unknown>) => {
    const normalized = normalizeDraftFiltersForApply(source || draftFilters || {});
    setFilters(normalized);
  }, [draftFilters, normalizeDraftFiltersForApply, setFilters]);

  useEffect(() => {
    if (!filtersOpen || !isPoliciesList) return;
    // Avoid duplicate count-preview requests while list query is active.
    setDraftPoliciesCount(typeof total === 'number' ? total : rows.length);
  }, [filtersOpen, isPoliciesList, rows.length, total]);

  useEffect(() => {
    if (!activePremiumBound) return;
    const reset = () => setActivePremiumBound(null);
    window.addEventListener('mouseup', reset);
    window.addEventListener('touchend', reset);
    window.addEventListener('pointerup', reset);
    return () => {
      window.removeEventListener('mouseup', reset);
      window.removeEventListener('touchend', reset);
      window.removeEventListener('pointerup', reset);
    };
  }, [activePremiumBound]);

  const activeFilterChips = useMemo(() => {
    const defs = config.filters || [];
    const chips: Array<{ id: string; label: string; value: string; operator: string }> = [];
    for (const f of defs) {
      const raw = String(filters?.[f.id] || '').trim();
      if (!raw) continue;
      const i = f.id.lastIndexOf('_');
      const op = i > 0 ? f.id.slice(i + 1) : 'eq';
      const baseLabel = f.label || f.id;
      let renderedValue = raw;
      if (f.type === 'select') {
        const opt = (f.options || []).find((o) => String(o.value) === raw);
        if (opt?.label) renderedValue = opt.label;
      } else if (f.type === 'date-range' || f.type === 'number-range') {
        const [a, b] = raw.includes('..') ? raw.split('..') : [raw, ''];
        renderedValue = `${a || 'Any'}..${b || 'Any'}`;
      }
      chips.push({ id: f.id, label: baseLabel, value: renderedValue, operator: op.toUpperCase() });
    }
    return chips;
  }, [config.filters, filters]);




  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="min-w-0">
          <div className="text-2xl sm:text-3xl lg:text-[36px] leading-[1.1] font-extrabold text-slate-900 tracking-tight">
            {config.entityLabel}
          </div>
          {config.searchHint ? (
            <div className="mt-2 text-sm text-slate-500">{config.searchHint}</div>
          ) : null}
        </div>
        <div className="shrink-0 flex items-center gap-3 w-full sm:w-auto">
          {actions}
        </div>
      </div>

      <div className={`${hasMobileCards ? 'flex items-stretch gap-3' : 'flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4'}`}>
        <div className={`relative min-w-0 ${hasMobileCards ? 'flex-1' : 'flex-1'}`}>
          <svg className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${hasMobileCards ? 'left-3 w-4 h-4 sm:left-6 sm:w-6 sm:h-6' : 'left-6 w-6 h-6'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            className={`ui-input rounded-3xl pr-12 py-4 font-bold w-full ${hasMobileCards ? 'pl-10 text-sm sm:pl-16 sm:text-base' : 'pl-16 text-base'}`}
            placeholder={config.searchPlaceholder || 'Search…'}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSearchInput('');
            }}
            aria-label="Search records"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label="Clear search"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          {isFetching && rows.length > 0 ? (
            <div
              role="status"
              aria-live="polite"
              data-testid="record-list-updating"
              className="absolute right-12 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-amber-700"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true" />
              Updating…
            </div>
          ) : isDebouncing ? (
            <div className="absolute right-12 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-black" aria-hidden="true">
              …
            </div>
          ) : null}
        </div>

        {(config.filters || []).length > 0 ? (
          <div ref={filtersRef} className="relative shrink-0">
            {hasMobileCards ? (
              <>
                <IconButton
                  title="Filters"
                  variant="neutral"
                  className="flex lg:hidden w-11 h-11 rounded-2xl shrink-0 items-center justify-center"
                  onClick={() => {
                    setSortOpen(false);
                    setFiltersOpen((v) => !v);
                  }}
                >
                  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h6" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 6h6" />
                    <circle cx="12" cy="6" r="2" strokeWidth={2} />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h2" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 12h10" />
                    <circle cx="8" cy="12" r="2" strokeWidth={2} />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 18h10" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 18h2" />
                    <circle cx="16" cy="18" r="2" strokeWidth={2} />
                  </svg>
                </IconButton>
                <IconButton
                  title="Filters"
                  variant="neutral"
                  className="hidden lg:inline-flex"
                  onClick={() => {
                    setSortOpen(false);
                    setFiltersOpen((v) => !v);
                  }}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h6" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 6h6" />
                    <circle cx="12" cy="6" r="2" strokeWidth={2} />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h2" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 12h10" />
                    <circle cx="8" cy="12" r="2" strokeWidth={2} />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 18h10" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 18h2" />
                    <circle cx="16" cy="18" r="2" strokeWidth={2} />
                  </svg>
                </IconButton>
              </>
            ) : (
              <IconButton
                title="Filters"
                variant="neutral"
                onClick={() => {
                  setSortOpen(false);
                  setFiltersOpen((v) => !v);
                }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h6" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 6h6" />
                  <circle cx="12" cy="6" r="2" strokeWidth={2} />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h2" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 12h10" />
                  <circle cx="8" cy="12" r="2" strokeWidth={2} />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 18h10" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 18h2" />
                  <circle cx="16" cy="18" r="2" strokeWidth={2} />
                </svg>
              </IconButton>
            )}
            {filtersOpen && !isPoliciesList ? (
              <div className="absolute right-0 mt-3 w-[360px] bg-white rounded-2xl border border-slate-200/70 shadow-xl shadow-slate-200/40 p-4 z-50">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-xs font-black uppercase tracking-widest text-slate-400">Filters</div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-0 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-transparent"
                    onClick={() => {
                      clearFilters();
                      setFiltersOpen(false);
                    }}
                  >
                    Clear
                  </Button>
                </div>
                <div className="space-y-4">
                  {(config.filters || []).map((f) => {
                    const val = String(filters?.[f.id] || '');
                    if (f.type === 'select') {
                      return (
                        <div key={f.id}>
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{f.label}</label>
                          <Select className="ui-select py-3 text-sm font-semibold" value={val} onChange={(e) => setFilterValue(f.id, e.target.value)}>
                            <option value="">{f.placeholder || 'All'}</option>
                            {(f.options || []).map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </Select>
                        </div>
                      );
                    }
                    return (
                      <div key={f.id}>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{f.label}</label>
                        <input
                          type={f.type === 'number-range' ? 'text' : f.type === 'date-range' ? 'text' : 'text'}
                          className="ui-input py-3 text-sm font-semibold w-full"
                          value={val}
                          placeholder={f.placeholder || ''}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilterValue(f.id, e.target.value)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {sortableColumns.length > 0 ? (
          <div className="relative shrink-0">
            {hasMobileCards ? (
              <>
                <IconButton
                  title={`Sort (${sortLabel})`}
                  variant="neutral"
                  className="flex lg:hidden w-11 h-11 rounded-2xl shrink-0"
                  onClick={() => {
                    setFiltersOpen(false);
                    setSortOpen((v) => !v);
                  }}
                >
                  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12M8 12h8M8 17h4" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6v12m0 0l-2-2m2 2l2-2" />
                  </svg>
                </IconButton>
                <IconButton
                  title={`Sort (${sortLabel})`}
                  variant="neutral"
                  className="hidden lg:inline-flex"
                  onClick={() => {
                    setFiltersOpen(false);
                    setSortOpen((v) => !v);
                  }}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12M8 12h8M8 17h4" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6v12m0 0l-2-2m2 2l2-2" />
                  </svg>
                </IconButton>
              </>
            ) : (
              <IconButton
                title={`Sort (${sortLabel})`}
                variant="neutral"
                onClick={() => {
                  setFiltersOpen(false);
                  setSortOpen((v) => !v);
                }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12M8 12h8M8 17h4" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6v12m0 0l-2-2m2 2l2-2" />
                </svg>
              </IconButton>
            )}
          </div>
        ) : null}
      </div>

      {sortOpen ? (
        <div className="fixed inset-0 z-[220] !mt-0 !mb-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4" onClick={() => setSortOpen(false)}>
          <div className="w-full max-w-2xl max-h-modal overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
              <div className="relative">
                <div className="text-xl font-bold text-slate-900 text-center">Sort</div>
                <button
                  type="button"
                  className="absolute right-0 top-1/2 -translate-y-1/2 text-2xl leading-none text-slate-500 hover:text-slate-800 transition-colors"
                  onClick={() => setSortOpen(false)}
                  aria-label="Close sort"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="space-y-3 px-6 py-5">
              {sortableColumns.map((c) => {
                const sortField = String(c.sortField || '');
                const selectedIdx = (sorts || []).findIndex((s) => String(s.field) === sortField);
                const selected = selectedIdx >= 0;
                const direction = selected ? ((sorts || [])[selectedIdx]?.direction || 'asc') : 'asc';
                const toggleSelected = () => {
                  const next = [...(sorts || [])];
                  if (selected) {
                    next.splice(selectedIdx, 1);
                    setSorts(next.slice(0, 3));
                  } else {
                    const trimmed = next.filter((s) => String(s.field) !== sortField).slice(0, 2);
                    setSorts([...trimmed, { field: sortField, direction: 'asc' }]);
                  }
                  setSortPulseField(sortField);
                  window.setTimeout(() => setSortPulseField((curr) => (curr === sortField ? '' : curr)), 260);
                };
                const flipDirection = () => {
                  const next = [...(sorts || [])];
                  if (selectedIdx < 0 || !next[selectedIdx]) return;
                  next[selectedIdx] = {
                    field: next[selectedIdx].field,
                    direction: next[selectedIdx].direction === 'asc' ? 'desc' : 'asc',
                  };
                  setSorts(next.slice(0, 3));
                };
                // ABY-107 — the previous shape nested a `<button>` (the
                // direction toggle) inside another `<button>` (the row
                // toggle), which is invalid HTML and produced the
                // marker.io report "Can't remove coverage from sort
                // options" on mobile: WebKit collapsed the parent's
                // tap target to whatever wasn't covered by the inner
                // button, and the inner button's `stopPropagation`
                // ate every other tap. We now render the row as a
                // `<div role="group">` with TWO siblings: a primary
                // toggle button that owns the entire row's tap area
                // (with an explicit "X" remove icon when selected),
                // and a separate direction toggle that only shows
                // when selected and lives outside the toggle button.
                // Both actions stay accessible from a single tap, no
                // nested buttons, no event bubbling games.
                return (
                  <div
                    key={c.id}
                    role="group"
                    aria-label={`Sort by ${c.header || c.id}`}
                    className={`w-full rounded-2xl border-2 transition ${selected ? 'border-slate-900 bg-white text-slate-900' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'} ${sortPulseField === sortField ? 'bo-reco-bounce' : ''}`}
                  >
                    <div className="flex items-center gap-3 px-4 py-4">
                      <button
                        type="button"
                        onClick={toggleSelected}
                        aria-pressed={selected}
                        className="flex flex-1 min-w-0 items-center gap-3 text-left"
                      >
                        <div className="h-10 w-10 rounded-xl flex items-center justify-center text-lg bg-slate-100">
                          {sortIconByField[sortField] || '↕'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold leading-tight">{c.header || c.id}</div>
                          {selected ? (
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mt-0.5">
                              #{selectedIdx + 1} {direction === 'asc' ? '· Low to high' : '· High to low'}
                            </div>
                          ) : null}
                        </div>
                        {!selected ? (
                          <span className="text-xs font-semibold text-slate-400">Tap to add</span>
                        ) : null}
                      </button>
                      {selected ? (
                        <>
                          <button
                            type="button"
                            onClick={flipDirection}
                            aria-label={`Flip sort direction (currently ${direction === 'asc' ? 'ascending' : 'descending'})`}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            <span>{direction === 'asc' ? 'A→Z' : 'Z→A'}</span>
                            <svg className={`w-4 h-4 text-brand-primary transition-transform ${direction === 'asc' ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-6 6m6-6l6 6" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={toggleSelected}
                            aria-label={`Remove ${c.header || c.id} from sort`}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-4">
              <Button
                variant="ghost"
                size="md"
                className="px-0 hover:bg-transparent text-slate-500 hover:text-slate-800"
                onClick={() => setSorts([])}
              >
                Clear sort
              </Button>
              <Button
                variant="primary"
                onClick={() => setSortOpen(false)}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <PoliciesFiltersModal
        open={filtersOpen && hasMobileCards && isPoliciesList}
        onClose={() => setFiltersOpen(false)}
        configFilters={config.filters || []}
        statusFilterDef={statusFilterDef}
        recommendationFilters={recommendationFilters}
        recommendationIconById={recommendationIconById}
        recommendedPulseId={recommendedPulseId}
        setRecommendedPulseId={setRecommendedPulseId}
        draftFilters={draftFilters}
        setDraftFilters={setDraftFilters}
        premiumFilterDef={premiumFilterDef}
        premiumMinBound={premiumMinBound}
        premiumMaxBound={premiumMaxBound}
        premiumBins={premiumBins}
        activePremiumBound={activePremiumBound}
        setActivePremiumBound={setActivePremiumBound}
        setDraftNumberRangeFilter={setDraftNumberRangeFilter}
        orderedDateFilters={orderedDateFilters}
        applyDraftFilters={() => applyDraftFilters()}
        countFilters={countFilters}
        searchInput={searchInput}
        normalizeDraftFilters={normalizeDraftFiltersForApply}
        draftPoliciesCount={draftPoliciesCount}
        setDraftPoliciesCount={setDraftPoliciesCount}
        total={total}
        rowsLength={rows.length}
      />

      {activeFilterChips.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-black uppercase tracking-widest text-slate-400">Active filters</div>
            <Button
              variant="ghost"
              size="sm"
              className="p-0 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-transparent"
              onClick={() => clearFilters()}
            >
              Clear all
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {activeFilterChips.map((chip) => (
              <div key={chip.id} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
                <span>{chip.label}</span>
                <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-black text-slate-600">{chip.operator}</span>
                <span className="text-slate-500">{chip.value}</span>
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-700"
                  aria-label={`Clear ${chip.label}`}
                  onClick={() => setFilterValue(chip.id, '')}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="px-6 py-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-900 text-sm font-bold">
          {String(error instanceof Error ? error.message : '').trim() || `Failed to load ${config.entityLabel}. Please try again.`}
        </div>
      ) : null}

      {/* Policies get a dedicated mobile card list. Other lists stay accessible on mobile via the data table. */}
      <div
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className={`${hasMobileCards ? 'hidden lg:block' : 'block'} outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40 rounded-2xl`}
      >
        <RecordListDataTable
          config={config}
          columns={columns}
          rows={rows}
          sorts={sorts || []}
          isFetching={isFetching}
          activeRowIdx={activeRowIdx}
          onCycleSort={cycleSort}
          onOpenRow={openRow}
          isInteractiveTarget={isInteractiveTarget}
        />
      </div>

      {/* Mobile card slot — rendered by domain-specific card list components */}
      {hasMobileCards && (
        <div className="lg:hidden">
          {config.mobileCardSlot!(rows, { hasMore, isFetching, isFetchingMore, loadMore })}
        </div>
      )}

      <div className={`${hasMobileCards ? 'hidden lg:flex' : 'flex'} items-center justify-center pt-2`}>
        {hasMore ? (
          <Button
            variant="secondary"
            size="lg"
            className="min-w-64 px-10"
            onClick={loadMore}
            onMouseEnter={() => void prefetchMore()}
            isLoading={isFetchingMore}
            disabled={isFetchingMore}
          >
            <svg className="w-4 h-4 mr-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Load more
            <svg className="w-4 h-4 ml-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Button>
        ) : (
          <div className="text-xs font-bold text-slate-400">{'\u00A0'}</div>
        )}
      </div>
    </div>
  );
}

