import React from 'react';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';
import { WizardSearchableSelect as SearchableSelect } from '@/src/shared/ui';
import { AmountCell } from './AmountCell';
import { PremiumBreakdownHeader } from './PremiumBreakdownHeader';
import { PremiumTotalsRows } from './PremiumTotalsRows';
import { asRecord, type UnknownRecord } from '@/src/shared/lib/record';
import { retainedMonetaryBreakdownLines } from '../model/retainedBreakdownLines';
import {
  getNextAdjustmentName,
  makeAdjustmentId,
  normalizeAdjustment,
  normalizeAdjustments,
  parseAdjustments,
  pricingScopeLabel,
  type Adjustment,
} from '../domain/adjustments';
import { buildCoverageScopeOptions, buildEndorsementOptions, type EndorsementOption } from '../domain/adjustmentOptions';

type PricingStep = { id?: string; name?: string; notes?: string; amount?: number };

type PremiumPricingBreakdownProps = {
  primary?: { calculationTrace?: { steps?: PricingStep[] } };
  breakdown?: Record<string, unknown>;
  qd?: UnknownRecord;
  cost?: UnknownRecord;
  currency: string;
  fmt: (n: number) => string;
  premiumLocked: boolean;
  patchQuoteData: (nextQuoteData: UnknownRecord) => void | Promise<void>;
  excessImpactLoading?: boolean;
  excessImpact?: number | null;
  feeSteps: PricingStep[];
  coverageDirty: boolean;
  needsUwReason: boolean;
  setShowPricingSteps: (open: boolean) => void;
  getLimitText: (code: string) => string;
  onRecalculate?: (nextQuoteData?: UnknownRecord) => void | Promise<void>;
  isReRating?: boolean;
};

export function PremiumPricingBreakdown(props: PremiumPricingBreakdownProps) {
  const {
    primary,
    breakdown,
    qd,
    cost,
    currency,
    fmt,
    premiumLocked,
    patchQuoteData,
    feeSteps,
    coverageDirty,
    needsUwReason,
    setShowPricingSteps,
    getLimitText,
    onRecalculate,
    isReRating,
  } = props;
  const addOnTotal = feeSteps.reduce((sum, s) => sum + Number(s.amount || 0), 0);

  const [draftAdjustment, setDraftAdjustment] = React.useState<Adjustment>({
    lineType: 'pricing',
    name: getNextAdjustmentName(qd),
    type: 'discount',
    mode: 'pct',
    value: 0,
    reason: '',
    reasonText: '',
    scopeType: 'policy',
    scopeRef: '',
    schedulePresentation: 'inherent',
    endorsementId: null,
  });
  const [draftScheduleNote, setDraftScheduleNote] = React.useState<Adjustment>({
    lineType: 'schedule_note',
    category: 'OTHER',
    text: '',
    endorsementId: null,
  });
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [drawerTab, setDrawerTab] = React.useState<'pricing' | 'schedule_note'>('pricing');
  const [editingAdjustmentId, setEditingAdjustmentId] = React.useState<string | null>(null);
  const [editingAdjustmentDraft, setEditingAdjustmentDraft] = React.useState<Adjustment | null>(null);
  const coverageScopeOptions = React.useMemo(
    () => buildCoverageScopeOptions(qd?.coverRequired),
    [qd?.coverRequired]
  );
  const endorsementOptions = React.useMemo<EndorsementOption[]>(
    () => buildEndorsementOptions(feeSteps),
    [feeSteps]
  );

  return (
    <div className="ui-table-wrap">
      <PremiumBreakdownHeader
        coverageDirty={coverageDirty}
        needsUwReason={needsUwReason}
        onOpenPricingSteps={() => setShowPricingSteps(true)}
      />

      <div className="overflow-auto">
        <table className="ui-table min-w-tableWide">
          <thead className="ui-thead">
            <tr>
              <th className="px-10 py-6 w-[33%]">Item</th>
              <th className="px-10 py-6 w-[29%]">Basis / Notes</th>
              <th className="px-10 py-6 w-[18%]">Value</th>
              <th className="px-10 py-6 w-[20%] text-right whitespace-nowrap">Amount ({currency})</th>
            </tr>
          </thead>
          <tbody className="ui-tbody text-sm">
            {!primary ? (
              <tr>
                <td colSpan={4} className="px-10 py-16 text-center text-slate-400 font-semibold">
                  No premium yet. Click <span className="font-black text-slate-600">Recalculate premium</span>.
                </td>
              </tr>
            ) : (
              <>
                {/* Data-driven breakdown lines from quoteResponse */}
                {(() => {
                  const bd = (breakdown || {}) as Record<string, unknown>;

                  // ABY-264 — when the rate engine emits the canonical
                  // `breakdown.lines` (today: travel; motor/home to follow),
                  // render those lines verbatim: base → addons (in catalogue
                  // order) → tax → admin fee. The `total` line is rendered
                  // separately by `PremiumTotalsRows` below. This is the
                  // SAME shape the wizard sidebar, payment-step summary and
                  // PDF schedule render, so the operator sees the customer's
                  // exact breakdown — no more "BO has no extras breakdown"
                  // (the original ABY-264 complaint).
                  // Narrow each line through the shared `asRecord` helper
                  // rather than casting the array to a broad map at the
                  // boundary — the `no-new-any` diff ratchet enforces
                  // a single narrowing entry point at boundaries.
                  const rawLines = Array.isArray(bd.lines) ? bd.lines : [];
                  const canonicalLines = rawLines
                    .map((entry) => asRecord(entry))
                    .map((entry) => ({
                      code: String(entry.code || ''),
                      label: String(entry.label || ''),
                      amount: Number(entry.amount),
                      kind: String(entry.kind || ''),
                    }))
                    .filter((line) => line.code && line.label && Number.isFinite(line.amount));

                  if (canonicalLines.length > 0) {
                    return canonicalLines
                      .filter((line) => line.kind !== 'total')
                      .map((line) => (
                        <tr key={line.code} className="ui-row bg-white/0">
                          <td className="px-10 py-6 font-black text-slate-900">{line.label}</td>
                          <td className="px-10 py-6 text-slate-600 font-semibold">—</td>
                          <td className="px-10 py-6 text-slate-500 font-semibold">—</td>
                          <td className="px-10 py-6"><AmountCell n={line.amount} currency={currency} /></td>
                        </tr>
                      ));
                  }

                  const bdLines = retainedMonetaryBreakdownLines(bd);

                  const costRecord = asRecord(cost);
                  const gp = Number(costRecord.grossPremium || 0);
                  const ncd = Number(costRecord.ncdAmount || 0);
                  const od = Number(costRecord.onlineDiscount || 0);
                  const costLines: Array<{key: string; label: string; amount: number}> = [];
                  if (gp > 0) costLines.push({ key: 'gross', label: 'Base insurance gross premium', amount: gp });
                  if (ncd > 0) costLines.push({ key: 'ncd', label: 'No Claims Discount', amount: -ncd });
                  if (od > 0) costLines.push({ key: 'online', label: 'Online Discount', amount: -od });

                  return [...bdLines, ...costLines].map(line => (
                    <tr key={line.key} className="ui-row bg-white/0">
                      <td className="px-10 py-6 font-black text-slate-900">{line.label}</td>
                      <td className="px-10 py-6 text-slate-600 font-semibold">—</td>
                      <td className="px-10 py-6 text-slate-500 font-semibold">—</td>
                      <td className="px-10 py-6"><AmountCell n={line.amount} currency={currency} /></td>
                    </tr>
                  ));
                })()}

                {(() => {
                  const qdRecord = asRecord(qd);
                  const adjustments = normalizeAdjustments(parseAdjustments(qdRecord));
                  const steps = primary?.calculationTrace?.steps || [];

                  const buildQuoteDataWithAdjustments = (newAdj: Adjustment[]) => ({
                    ...(qd || {}),
                    uwAdjustments: normalizeAdjustments(newAdj),
                    uwAdjustment: null,
                  });
                  const persistAdjustmentsAndReRate = async (newAdj: Adjustment[], rerate: boolean) => {
                    const nextQuoteData = buildQuoteDataWithAdjustments(newAdj);
                    await patchQuoteData(nextQuoteData);
                    if (rerate && onRecalculate) {
                      await onRecalculate(nextQuoteData);
                    }
                  };

                  const pricingValue = Number(draftAdjustment.value ?? 0);
                  const pricingIsNonZero = Number.isFinite(pricingValue) && pricingValue !== 0;
                  const pricingHasReason = String(draftAdjustment.reasonText || draftAdjustment.reason || '').trim().length > 0;
                  const pricingNeedsCoverageRef =
                    String(draftAdjustment.scopeType || 'policy') === 'coverage' &&
                    String(draftAdjustment.scopeRef || '').trim().length === 0;
                  const canAddPricing =
                    String(draftAdjustment.name || '').trim().length > 0 &&
                    (String(draftAdjustment.type || '') === 'discount' || String(draftAdjustment.type || '') === 'loading') &&
                    (String(draftAdjustment.mode || '') === 'pct' || String(draftAdjustment.mode || '') === 'amount') &&
                    Number.isFinite(pricingValue) &&
                    (!pricingIsNonZero || pricingHasReason) &&
                    !pricingNeedsCoverageRef;
                  const canAddScheduleNote =
                    String(draftScheduleNote.category || '').trim().length > 0 &&
                    String(draftScheduleNote.text || '').trim().length > 0;

                  const resetPricingDraft = () => {
                    setDraftAdjustment({
                      lineType: 'pricing',
                      name: getNextAdjustmentName(qd),
                      type: 'discount',
                      mode: 'pct',
                      value: 0,
                      reason: '',
                      reasonText: '',
                      scopeType: 'policy',
                      scopeRef: '',
                      schedulePresentation: 'inherent',
                      endorsementId: null,
                    });
                  };
                  const resetNoteDraft = () => {
                    setDraftScheduleNote({
                      lineType: 'schedule_note',
                      category: 'OTHER',
                      text: '',
                      endorsementId: null,
                    });
                  };

                  return (
                    <>
                      <tr className="ui-row bg-white/0">
                        <td className="px-10 py-6 font-black text-slate-900">UW adjustments</td>
                        <td className="px-10 py-6 text-slate-500 font-semibold">—</td>
                        <td className="px-10 py-6 text-slate-500 font-semibold">—</td>
                        <td className="px-10 py-6 text-right">
                          {!premiumLocked && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (!drawerOpen) {
                                  setDraftAdjustment((prev) => ({
                                    ...prev,
                                    name: String(prev.name || '').trim() || getNextAdjustmentName(qd),
                                  }));
                                }
                                setDrawerOpen((prev) => !prev);
                              }}
                              className={`inline-flex items-center justify-center min-w-[190px] whitespace-nowrap text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl transition-colors ${
                                drawerOpen
                                  ? 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                                  : 'bg-white border border-brand-primary text-brand-primary hover:bg-brand-primary/5'
                              }`}
                            >
                              {drawerOpen ? 'Close' : '+ Add adjustment'}
                            </Button>
                          )}
                        </td>
                      </tr>

                      {drawerOpen && !premiumLocked && (
                        <tr className="ui-row bg-slate-50/50">
                          <td colSpan={4} className="px-10 py-6">
                            <div className="flex items-center gap-2 mb-4">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setDrawerTab('pricing')}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${drawerTab === 'pricing' ? 'bg-brand-primary text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
                              >
                                Pricing adjustment
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setDrawerTab('schedule_note')}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${drawerTab === 'schedule_note' ? 'bg-brand-primary text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
                              >
                                Schedule note
                              </Button>
                            </div>
                            {drawerTab === 'pricing' ? (
                              <div className="space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                  <Input
                                    type="text"
                                    variant="ui"
                                    className="py-2 rounded-xl"
                                    value={String(draftAdjustment.name || '')}
                                    onChange={(e) => setDraftAdjustment((prev) => ({ ...prev, name: e.target.value }))}
                                    placeholder="Adjustment name"
                                  />
                                  <Select
                                    variant="ui"
                                    className="py-2 text-sm font-black rounded-xl"
                                    value={String(draftAdjustment.type || 'discount')}
                                    onChange={(e) => setDraftAdjustment((prev) => ({ ...prev, type: e.target.value }))}
                                  >
                                    <option value="discount">Discount</option>
                                    <option value="loading">Loading</option>
                                  </Select>
                                  <Select
                                    variant="ui"
                                    className="py-2 text-sm font-black rounded-xl"
                                    value={String(draftAdjustment.mode || 'pct')}
                                    onChange={(e) => setDraftAdjustment((prev) => ({ ...prev, mode: e.target.value }))}
                                  >
                                    <option value="pct">%</option>
                                    <option value="amount">€</option>
                                  </Select>
                                  <Input
                                    type="number"
                                    variant="ui"
                                    className="py-2 rounded-xl"
                                    value={String(draftAdjustment.value ?? 0)}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      const v = raw === '' ? '' : Number(raw);
                                      setDraftAdjustment((prev) => ({ ...prev, value: v }));
                                    }}
                                    placeholder="Amount"
                                  />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                  <Select
                                    variant="ui"
                                    className="py-2 text-sm font-black rounded-xl"
                                    value={String(draftAdjustment.scopeType || 'policy')}
                                    onChange={(e) => setDraftAdjustment((prev) => ({ ...prev, scopeType: e.target.value, scopeRef: e.target.value === 'coverage' ? prev.scopeRef : '' }))}
                                  >
                                    <option value="policy">Apply to: Policy total</option>
                                    <option value="coverage">Apply to: Coverage section</option>
                                  </Select>
                                  {String(draftAdjustment.scopeType || 'policy') === 'coverage' && (
                                    <Select
                                      variant="ui"
                                      className="py-2 text-sm font-black rounded-xl"
                                      value={String(draftAdjustment.scopeRef || '')}
                                      onChange={(e) => setDraftAdjustment((prev) => ({ ...prev, scopeRef: e.target.value }))}
                                    >
                                      <option value="">Select coverage</option>
                                      {coverageScopeOptions.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </Select>
                                  )}
                                  <Input
                                    type="text"
                                    variant="ui"
                                    className="py-2 rounded-xl md:col-span-2"
                                    value={String(draftAdjustment.reasonText || draftAdjustment.reason || '')}
                                    onChange={(e) => {
                                      const reason = e.target.value;
                                      setDraftAdjustment((prev) => ({ ...prev, reason, reasonText: reason }));
                                    }}
                                    placeholder="Reason (required if non-zero)"
                                  />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-center">
                                  <div className="text-[11px] font-semibold text-slate-500">
                                    Applies to: {pricingScopeLabel(draftAdjustment)}
                                  </div>
                                  <div>
                                    <SearchableSelect
                                      value={String(draftAdjustment.endorsementId || '')}
                                      onChange={(nextValue) => {
                                        const raw = String(nextValue || '').trim();
                                        setDraftAdjustment((prev) => ({ ...prev, endorsementId: raw || null }));
                                      }}
                                      options={endorsementOptions.map((opt) => ({ value: opt.id, label: opt.label }))}
                                      placeholder="Link active endorsement (optional)"
                                      searchPlaceholder="Search active endorsements..."
                                      clearSelectionOnOpen
                                    />
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="primary"
                                    size="sm"
                                    onClick={() => {
                                      if (!canAddPricing) return;
                                      const next: Adjustment[] = [
                                        ...adjustments,
                                        normalizeAdjustment(
                                          {
                                            ...draftAdjustment,
                                            lineType: 'pricing',
                                            id: makeAdjustmentId(),
                                          },
                                          adjustments.length
                                        ),
                                      ];
                                      persistAdjustmentsAndReRate(next, true);
                                      setEditingAdjustmentId(null);
                                      setEditingAdjustmentDraft(null);
                                      resetPricingDraft();
                                      setDrawerOpen(false);
                                    }}
                                    disabled={!canAddPricing || Boolean(isReRating)}
                                    className="inline-flex items-center gap-2 text-[10px] font-black text-white uppercase tracking-widest bg-brand-primary hover:bg-brand-primary-dark disabled:opacity-60 disabled:cursor-not-allowed transition-colors px-3 py-2 rounded-xl"
                                  >
                                    {isReRating ? 'Applying…' : 'Add to table'}
                                  </Button>
                                  {pricingIsNonZero && !pricingHasReason && (
                                    <span className="text-[11px] font-semibold text-rose-700">Reason is required for non-zero amount.</span>
                                  )}
                                  {pricingNeedsCoverageRef && (
                                    <span className="text-[11px] font-semibold text-rose-700">Select a coverage section.</span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                  <Select
                                    variant="ui"
                                    className="py-2 text-sm font-black rounded-xl"
                                    value={String(draftScheduleNote.category || 'OTHER')}
                                    onChange={(e) => setDraftScheduleNote((prev) => ({ ...prev, category: e.target.value }))}
                                  >
                                    <option value="EXCLUSION">Exclusion</option>
                                    <option value="SUB_LIMIT">Sub-limit</option>
                                    <option value="CONDITION_WARRANTY">Condition/Warranty</option>
                                    <option value="OTHER">Other</option>
                                  </Select>
                                  <Input
                                    type="text"
                                    variant="ui"
                                    className="py-2 rounded-xl md:col-span-2"
                                    value={String(draftScheduleNote.text || '')}
                                    onChange={(e) => setDraftScheduleNote((prev) => ({ ...prev, text: e.target.value }))}
                                    placeholder="Schedule note text"
                                  />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-1 gap-2 items-center">
                                  <SearchableSelect
                                    value={String(draftScheduleNote.endorsementId || '')}
                                    onChange={(nextValue) => setDraftScheduleNote((prev) => ({ ...prev, endorsementId: String(nextValue || '').trim() || null }))}
                                    options={endorsementOptions.map((opt) => ({ value: opt.id, label: opt.label }))}
                                    placeholder="Link active endorsement (optional)"
                                    searchPlaceholder="Search active endorsements..."
                                    clearSelectionOnOpen
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="primary"
                                    size="sm"
                                    onClick={() => {
                                      if (!canAddScheduleNote) return;
                                      const next: Adjustment[] = [
                                        ...adjustments,
                                        normalizeAdjustment(
                                          {
                                            ...draftScheduleNote,
                                            lineType: 'schedule_note',
                                            id: makeAdjustmentId(),
                                          },
                                          adjustments.length
                                        ),
                                      ];
                                      persistAdjustmentsAndReRate(next, false);
                                      setEditingAdjustmentId(null);
                                      setEditingAdjustmentDraft(null);
                                      resetNoteDraft();
                                      setDrawerOpen(false);
                                    }}
                                    disabled={!canAddScheduleNote}
                                    className="inline-flex items-center gap-2 text-[10px] font-black text-white uppercase tracking-widest bg-brand-primary hover:bg-brand-primary-dark disabled:opacity-60 disabled:cursor-not-allowed transition-colors px-3 py-2 rounded-xl"
                                  >
                                    Add to table
                                  </Button>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}

                      {adjustments.map((adj, idx: number) => {
                        const adjId = String(adj.id || '').trim() || `idx-${idx}`;
                        const isPricing = String(adj.lineType || 'pricing') !== 'schedule_note';
                        const isEditing = !premiumLocked && editingAdjustmentId === adjId;
                        const rowName = String(adj.name || (isPricing ? `Adjustment ${idx + 1}` : `Schedule note ${idx + 1}`));
                        const rowReason = isPricing
                          ? String(adj.reasonText || adj.reason || '').trim()
                          : String(adj.text || '').trim();
                        const rowType = isPricing
                          ? (String(adj.type || '').toLowerCase() === 'loading' ? 'Loading' : 'Discount')
                          : 'Schedule';
                        const rowMode = String(adj.mode || 'pct') === 'amount' ? '€' : '%';
                        const step = isPricing ? steps.find((s) => s.id === `uw.adjustment.${idx}`) : undefined;
                        const amount = isPricing ? step?.amount : undefined;

                        const beginEdit = () => {
                          if (premiumLocked) return;
                          setEditingAdjustmentId(adjId);
                          setEditingAdjustmentDraft({
                            ...adj,
                            id: adjId,
                            lineType: isPricing ? 'pricing' : 'schedule_note',
                            name: rowName,
                            type: String(adj.type || 'discount'),
                            mode: String(adj.mode || 'pct'),
                            value: Number(adj.value ?? 0),
                            reason: String(adj.reasonText || adj.reason || ''),
                            reasonText: String(adj.reasonText || adj.reason || ''),
                            scopeType: String(adj.scopeType || 'policy'),
                            scopeRef: String(adj.scopeRef || ''),
                            schedulePresentation: String(adj.schedulePresentation || 'inherent'),
                            endorsementId: adj.endorsementId ? String(adj.endorsementId) : null,
                            category: String(adj.category || 'OTHER'),
                            text: String(adj.text || ''),
                          });
                        };

                        const cancelEdit = () => {
                          setEditingAdjustmentId(null);
                          setEditingAdjustmentDraft(null);
                        };

                        const saveEdit = () => {
                          if (!editingAdjustmentDraft) return;
                          const draftIsPricing = String(editingAdjustmentDraft.lineType || 'pricing') !== 'schedule_note';
                          if (draftIsPricing) {
                            const hasName = String(editingAdjustmentDraft.name || '').trim().length > 0;
                            const valueNum = Number(editingAdjustmentDraft.value ?? 0);
                            const hasReason = String(editingAdjustmentDraft.reasonText || editingAdjustmentDraft.reason || '').trim().length > 0;
                            const requiresScopeRef =
                              String(editingAdjustmentDraft.scopeType || 'policy') === 'coverage' &&
                              String(editingAdjustmentDraft.scopeRef || '').trim().length === 0;
                            if (!hasName || (Number.isFinite(valueNum) && valueNum !== 0 && !hasReason) || requiresScopeRef) return;
                          } else {
                            if (!String(editingAdjustmentDraft.text || '').trim()) return;
                          }
                          const next = [...adjustments];
                          next[idx] = {
                            ...normalizeAdjustment(editingAdjustmentDraft, idx),
                            id: adjId,
                          };
                          setEditingAdjustmentId(null);
                          setEditingAdjustmentDraft(null);
                          persistAdjustmentsAndReRate(next, draftIsPricing);
                        };

                        return (
                          <tr key={adjId} className="ui-row bg-white/0 group/adj">
                            <td className="px-10 py-6 font-black text-slate-900 align-top" colSpan={isEditing ? 4 : 1}>
                              {isEditing ? (
                                <div className="space-y-2">
                                  <Input
                                    type="text"
                                    variant="ui"
                                    className="py-2 rounded-xl w-full max-w-col260"
                                    value={String(editingAdjustmentDraft?.name || '')}
                                    onChange={(e) => setEditingAdjustmentDraft((prev) => ({ ...(prev || {}), name: e.target.value }))}
                                    placeholder={String(editingAdjustmentDraft?.lineType || 'pricing') === 'schedule_note' ? 'Schedule note title' : 'Adjustment name'}
                                  />
                                  {String(editingAdjustmentDraft?.lineType || 'pricing') === 'schedule_note' ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                      <Select
                                        variant="ui"
                                        className="py-2 text-sm font-black rounded-xl"
                                        value={String(editingAdjustmentDraft?.category || 'OTHER')}
                                        onChange={(e) => setEditingAdjustmentDraft((prev) => ({ ...(prev || {}), category: e.target.value }))}
                                      >
                                        <option value="EXCLUSION">Exclusion</option>
                                        <option value="SUB_LIMIT">Sub-limit</option>
                                        <option value="CONDITION_WARRANTY">Condition/Warranty</option>
                                        <option value="OTHER">Other</option>
                                      </Select>
                                      <Input
                                        type="text"
                                        variant="ui"
                                        className="py-2 rounded-xl"
                                        value={String(editingAdjustmentDraft?.text || '')}
                                        onChange={(e) => setEditingAdjustmentDraft((prev) => ({ ...(prev || {}), text: e.target.value }))}
                                        placeholder="Schedule note text"
                                      />
                                    </div>
                                  ) : (
                                    <>
                                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                        <Select
                                          variant="ui"
                                          className="py-2 text-sm font-black rounded-xl"
                                          value={String(editingAdjustmentDraft?.type || 'discount')}
                                          onChange={(e) => setEditingAdjustmentDraft((prev) => ({ ...(prev || {}), type: e.target.value }))}
                                        >
                                          <option value="discount">Discount</option>
                                          <option value="loading">Loading</option>
                                        </Select>
                                        <Select
                                          variant="ui"
                                          className="py-2 text-sm font-black rounded-xl"
                                          value={String(editingAdjustmentDraft?.mode || 'pct')}
                                          onChange={(e) => setEditingAdjustmentDraft((prev) => ({ ...(prev || {}), mode: e.target.value }))}
                                        >
                                          <option value="pct">%</option>
                                          <option value="amount">€</option>
                                        </Select>
                                        <Input
                                          type="number"
                                          variant="ui"
                                          className="py-2 rounded-xl"
                                          value={String(editingAdjustmentDraft?.value ?? 0)}
                                          onChange={(e) => {
                                            const raw = e.target.value;
                                            const v = raw === '' ? '' : Number(raw);
                                            setEditingAdjustmentDraft((prev) => ({ ...(prev || {}), value: v }));
                                          }}
                                          placeholder="Amount"
                                        />
                                        <Select
                                          variant="ui"
                                          className="py-2 text-sm font-black rounded-xl"
                                          value={String(editingAdjustmentDraft?.scopeType || 'policy')}
                                          onChange={(e) => setEditingAdjustmentDraft((prev) => ({ ...(prev || {}), scopeType: e.target.value, scopeRef: e.target.value === 'coverage' ? prev?.scopeRef : '' }))}
                                        >
                                          <option value="policy">Policy total</option>
                                          <option value="coverage">Coverage section</option>
                                        </Select>
                                      </div>
                                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                        {String(editingAdjustmentDraft?.scopeType || 'policy') === 'coverage' && (
                                          <Select
                                            variant="ui"
                                            className="py-2 text-sm font-black rounded-xl"
                                            value={String(editingAdjustmentDraft?.scopeRef || '')}
                                            onChange={(e) => setEditingAdjustmentDraft((prev) => ({ ...(prev || {}), scopeRef: e.target.value }))}
                                          >
                                            <option value="">Select coverage</option>
                                            {coverageScopeOptions.map((opt) => (
                                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                          </Select>
                                        )}
                                        <Input
                                          type="text"
                                          variant="ui"
                                          className="py-2 rounded-xl md:col-span-2"
                                          value={String(editingAdjustmentDraft?.reasonText || editingAdjustmentDraft?.reason || '')}
                                          onChange={(e) => {
                                            const reason = e.target.value;
                                            setEditingAdjustmentDraft((prev) => ({ ...(prev || {}), reason, reasonText: reason }));
                                          }}
                                          placeholder="Reason (required if non-zero)"
                                        />
                                      </div>
                                    </>
                                  )}
                                  <SearchableSelect
                                    value={String(editingAdjustmentDraft?.endorsementId || '')}
                                    onChange={(nextValue) => {
                                      const raw = String(nextValue || '').trim();
                                      setEditingAdjustmentDraft((prev) => ({ ...(prev || {}), endorsementId: raw || null }));
                                    }}
                                    options={endorsementOptions.map((opt) => ({ value: opt.id, label: opt.label }))}
                                    placeholder="Link active endorsement (optional)"
                                    searchPlaceholder="Search active endorsements..."
                                    clearSelectionOnOpen
                                  />
                                  <div className="flex items-center gap-2">
                                    <Button
                                      type="button"
                                      variant="primary"
                                      size="sm"
                                      onClick={saveEdit}
                                      className="inline-flex items-center px-3 py-1.5 rounded-lg bg-brand-primary text-white text-[10px] font-black uppercase tracking-widest hover:bg-brand-primary-dark transition-colors disabled:opacity-60"
                                      disabled={Boolean(isReRating)}
                                    >
                                      Save
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={cancelEdit}
                                      className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-colors bg-transparent"
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span>{rowName}</span>
                                  {!premiumLocked && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={beginEdit}
                                      className="text-slate-400 hover:text-brand-primary transition-all p-1 bg-transparent"
                                      title="Edit adjustment"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536M9 11l7.768-7.768a2.5 2.5 0 113.536 3.536L12.536 14.536A4 4 0 0110.172 15.66L7 16l.34-3.172a4 4 0 011.124-2.364z" />
                                      </svg>
                                    </Button>
                                  )}
                                  {!premiumLocked && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        const next = adjustments.filter((_, i: number) => i !== idx);
                                        setEditingAdjustmentId(null);
                                        setEditingAdjustmentDraft(null);
                                        persistAdjustmentsAndReRate(next, isPricing);
                                      }}
                                      className="opacity-0 group-hover/adj:opacity-100 text-slate-400 hover:text-rose-500 transition-all p-1 bg-transparent"
                                      title="Remove adjustment"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </Button>
                                  )}
                                </div>
                              )}
                            </td>
                            {!isEditing && (
                              <>
                                <td className="px-10 py-6 text-slate-600 font-semibold align-top text-xs">
                                  {isPricing
                                    ? `Reason: ${rowReason || '—'}`
                                    : `Category: ${String(adj.category || 'OTHER')}`}
                                </td>
                                <td className="px-10 py-6 text-slate-600 font-semibold align-top text-xs">
                                  {isPricing
                                    ? `${rowType} · ${rowMode === '%' ? `${Number(adj.value || 0)}%` : `€${Number(adj.value || 0)}`}`
                                    : (rowReason || '—')}
                                  {String(adj.endorsementId || '').trim() && (
                                    <div className="mt-2 text-[11px] font-semibold text-slate-500">Endorsement: {String(adj.endorsementId)}</div>
                                  )}
                                </td>
                                <td className="px-10 py-6 align-top">
                                  {amount !== undefined ? (
                                    <AmountCell n={amount} currency={currency} />
                                  ) : (
                                    <div className="text-right text-slate-400 font-bold">—</div>
                                  )}
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </>
                  );
                })()}

                <PremiumTotalsRows
                  cost={cost}
                  totalPremium={breakdown?.grossPremium ?? cost?.totalPremium ?? asRecord(primary).annualPremium ?? asRecord(primary).totalPremium}
                  feeSteps={feeSteps}
                  addOnTotal={addOnTotal}
                  getLimitText={getLimitText}
                  fmt={fmt}
                  currency={currency}
                />
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
