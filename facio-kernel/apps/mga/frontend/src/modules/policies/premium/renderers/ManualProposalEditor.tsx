import React from 'react';
import { Button, Input } from '@/src/shared/ui';
import { asRecord, type UnknownRecord } from '@/src/shared/lib/record';
import {
  EMPTY_MANUAL_PROPOSAL_ROW,
  manualProposalCompleteness,
  mergeManualProposalRowsFromQuestionnaire,
  normalizeManualProposalRow,
  prepareManualProposalRows,
  seedManualProposalRows,
  totalManualPremium,
  type ManualProposalRow,
} from '../model/manualProposal';
import {
  getNextAdjustmentName,
  normalizeAdjustments,
  parseAdjustments,
  type Adjustment,
} from '../domain/adjustments';

type ManualProposalDraft = {
  marketName: string;
  termsNotes: string;
  subjectivities: string;
  coverageRows: ManualProposalRow[];
  uwAdjustments: Adjustment[];
};

type ManualProposalEditorProps = {
  qd: UnknownRecord;
  productType?: string;
  coverageSelection?: unknown;
  lockedMarketName?: string;
  currency: string;
  premiumLocked: boolean;
  patchQuoteData: (nextQuoteData: UnknownRecord) => void | Promise<void>;
  onRecalculate?: (nextQuoteData?: UnknownRecord) => void | Promise<void>;
  isReRating?: boolean;
  onSendToClient?: () => void | Promise<void>;
  isSendingToClient?: boolean;
};

function formatNumberText(value: string): string {
  const original = String(value || '');
  const normalized = original.replace(/,/g, '').trim();
  if (!normalized) return '';
  if (!/^\d*\.?\d*$/.test(normalized)) return original;
  const [wholePart = '', decimalPart] = normalized.split('.');
  const whole = wholePart.replace(/^0+(?=\d)/, '');
  const formattedWhole = whole ? Number(whole).toLocaleString('en-US') : '0';
  if (normalized.endsWith('.')) return `${formattedWhole}.`;
  return decimalPart === undefined ? formattedWhole : `${formattedWhole}.${decimalPart}`;
}

function parseNumberText(value: unknown): number {
  const n = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function pricingAdjustmentImpact(adjustment: Adjustment, subtotal: number): number {
  const value = parseNumberText(adjustment.value);
  if (!value) return 0;
  const rawAmount = String(adjustment.mode || '').toLowerCase() === 'pct'
    ? subtotal * (value / 100)
    : value;
  return String(adjustment.type || '').toLowerCase() === 'loading' ? rawAmount : -rawAmount;
}

function totalAdjustmentAmount(adjustments: Adjustment[], subtotal: number): number {
  return normalizeAdjustments(adjustments)
    .filter((adjustment) => adjustment.lineType !== 'schedule_note')
    .reduce((sum, adjustment) => sum + pricingAdjustmentImpact(adjustment, subtotal), 0);
}

function hasAdjustmentMissingReason(adjustments: Adjustment[]): boolean {
  return normalizeAdjustments(adjustments).some((adjustment) => {
    if (adjustment.lineType === 'schedule_note') return false;
    const value = parseNumberText(adjustment.value);
    return value !== 0 && !String(adjustment.reasonText || adjustment.reason || '').trim();
  });
}

function normalizeDraft(qd: UnknownRecord, productType?: string, coverageSelection?: unknown, lockedMarketName?: string): ManualProposalDraft {
  const proposal = asRecord(qd.proposal);
  const rowsRaw = Array.isArray(proposal.coverageRows) ? proposal.coverageRows : [];
  const savedRows = rowsRaw.map(normalizeManualProposalRow);
  const seedRows = seedManualProposalRows(qd, productType, coverageSelection);
  const coverageRows = seedRows.length > 0
    ? mergeManualProposalRowsFromQuestionnaire(savedRows, seedRows)
    : savedRows.length > 0
      ? savedRows
      : [{ ...EMPTY_MANUAL_PROPOSAL_ROW }];
  return {
    marketName: String(lockedMarketName || proposal.marketName || ''),
    termsNotes: String(proposal.termsNotes || ''),
    subjectivities: String(proposal.subjectivities || ''),
    uwAdjustments: normalizeAdjustments(parseAdjustments(qd)),
    coverageRows: coverageRows.map((row) => ({
      ...row,
      limit: formatNumberText(row.limit),
      excess: formatNumberText(row.excess),
      premium: formatNumberText(row.premium),
    })),
  };
}

export function ManualProposalEditor(props: ManualProposalEditorProps) {
  const { qd, productType, coverageSelection, lockedMarketName, currency, premiumLocked, patchQuoteData, onRecalculate, isReRating, onSendToClient, isSendingToClient } = props;
  const [draft, setDraft] = React.useState<ManualProposalDraft>(() => normalizeDraft(qd, productType, coverageSelection, lockedMarketName));
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    setDraft(normalizeDraft(qd, productType, coverageSelection, lockedMarketName));
    setSaved(false);
  }, [coverageSelection, lockedMarketName, productType, qd]);

  const updateRow = (index: number, patch: Partial<ManualProposalRow>) => {
    setDraft((prev) => ({
      ...prev,
      coverageRows: prev.coverageRows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
    setSaved(false);
  };

  const addRow = () => {
    setDraft((prev) => ({ ...prev, coverageRows: [...prev.coverageRows, { ...EMPTY_MANUAL_PROPOSAL_ROW }] }));
    setSaved(false);
  };

  const removeRow = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      coverageRows: prev.coverageRows.length === 1
        ? [{ ...EMPTY_MANUAL_PROPOSAL_ROW }]
        : prev.coverageRows.filter((_, i) => i !== index),
    }));
    setSaved(false);
  };

  const addAdjustment = () => {
    setDraft((prev) => ({
      ...prev,
      uwAdjustments: [
        ...prev.uwAdjustments,
        {
          lineType: 'pricing',
          name: getNextAdjustmentName({ uwAdjustments: prev.uwAdjustments }),
          type: 'discount',
          mode: 'amount',
          value: 0,
          reason: '',
          reasonText: '',
          scopeType: 'policy',
          schedulePresentation: 'inherent',
          endorsementId: null,
        },
      ],
    }));
    setSaved(false);
  };

  const updateAdjustment = (index: number, patch: Partial<Adjustment>) => {
    setDraft((prev) => ({
      ...prev,
      uwAdjustments: prev.uwAdjustments.map((adjustment, i) => (i === index ? { ...adjustment, ...patch } : adjustment)),
    }));
    setSaved(false);
  };

  const removeAdjustment = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      uwAdjustments: prev.uwAdjustments.filter((_, i) => i !== index),
    }));
    setSaved(false);
  };

  const save = React.useCallback(async (): Promise<UnknownRecord> => {
    const coverageRows = prepareManualProposalRows(draft.coverageRows);
    const rowPremium = totalManualPremium(draft.coverageRows);
    const adjustments = normalizeAdjustments(draft.uwAdjustments);
    const premium = rowPremium + totalAdjustmentAmount(adjustments, rowPremium);
    const marketName = String(lockedMarketName || draft.marketName || '').trim();
    const proposalStatus = manualProposalCompleteness(
      { ...qd, proposal: { ...asRecord(qd.proposal), marketName } },
      draft.coverageRows,
    ).readyToSend
      ? 'ready_to_send'
      : 'draft';
    const proposalBase = { ...asRecord(qd.proposal) };
    const nextQuoteData = {
      ...qd,
      manualPremium: premium,
      uwAdjustments: adjustments,
      uwAdjustment: null,
      proposal: {
        ...proposalBase,
        marketName,
        status: proposalStatus,
        coverageRows,
        termsNotes: draft.termsNotes.trim(),
        subjectivities: draft.subjectivities.trim(),
      },
    };
    await patchQuoteData(nextQuoteData);
    setSaved(true);
    return nextQuoteData;
  }, [draft, lockedMarketName, patchQuoteData, qd]);

  const saveAndRecalculate = async () => {
    const nextQuoteData = await save();
    await onRecalculate?.(nextQuoteData);
  };

  const saveAndSendToClient = async () => {
    await save();
    await onSendToClient?.();
  };

  const rowSubtotal = totalManualPremium(draft.coverageRows);
  const adjustmentTotal = totalAdjustmentAmount(draft.uwAdjustments, rowSubtotal);
  const total = rowSubtotal + adjustmentTotal;
  const marketName = String(lockedMarketName || draft.marketName || '').trim();
  const completeness = manualProposalCompleteness({ ...qd, proposal: { ...asRecord(qd.proposal), marketName } }, draft.coverageRows);
  const adjustmentsNeedReason = hasAdjustmentMissingReason(draft.uwAdjustments);
  const readyToSend = completeness.readyToSend && !adjustmentsNeedReason;
  const missingHint = readyToSend
    ? ''
    : adjustmentsNeedReason
      ? 'Add reason for UW adjustment'
      : completeness.missing.slice(0, 2).join(' • ');
  const proposalStatusLabel = readyToSend ? 'Ready to send' : 'Needs details';
  const disabled = premiumLocked;
  const marketLocked = Boolean(String(lockedMarketName || '').trim());
  const isIncludedLimit = (value: string) => String(value || '').trim().toLowerCase() === 'included';
  const pricingAdjustments = normalizeAdjustments(draft.uwAdjustments).filter((adjustment) => adjustment.lineType !== 'schedule_note');

  return (
    <div className="ui-card ui-card-pad space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Manual proposal</div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight mt-1">Coverage and pricing rows</h2>
          <div className="mt-1 text-sm text-slate-500 font-semibold">
            Rows are seeded from the customer request. Premiums are entered by the underwriter and totaled from the rows.
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total premium</div>
          <div className="mt-1 text-2xl font-black text-brand-primary tabular-nums">
            {currency} {total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-400">Rows plus UW adjustments</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="relative group/field md:col-span-2">
          <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">
            Market / insurer
          </label>
          <Input
            variant="ui"
            aria-label="Market / insurer"
            value={marketName}
            disabled={disabled || marketLocked}
            onChange={(event) => {
              if (marketLocked) return;
              setDraft((prev) => ({ ...prev, marketName: event.target.value }));
              setSaved(false);
            }}
          />
          {marketLocked && (
            <div className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
              Selected in Underwriting
            </div>
          )}
        </div>
        <div className="relative group/field">
          <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">
            Proposal status
          </label>
          <div
            className="ui-input flex min-h-[56px] items-center font-bold"
            aria-label="Proposal status"
          >
            {proposalStatusLabel}
          </div>
        </div>
      </div>

      {disabled && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
          This proposal is locked because the client has approved it or payment is in progress.
        </div>
      )}

      <div className="ui-table-wrap">
        <div className="overflow-auto">
          <table className="ui-table min-w-tableWide">
            <thead className="ui-thead">
              <tr>
                <th className="px-6 py-4">Coverage</th>
                <th className="px-6 py-4">Limit</th>
                <th className="px-6 py-4">Excess</th>
                <th className="px-6 py-4 text-right">Premium</th>
                <th className="px-6 py-4">Notes</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="ui-tbody text-sm">
              {draft.coverageRows.map((row, index) => (
                <tr key={index} className="ui-row bg-white">
                  <td className="px-6 py-4">
                    <Input
                      variant="ui"
                      aria-label={`Coverage ${index + 1}`}
                      value={row.coverage}
                      disabled={disabled}
                      placeholder="Public liability"
                      onChange={(event) => updateRow(index, { coverage: event.target.value })}
                    />
                  </td>
                  <td className="px-6 py-4">
                    {isIncludedLimit(row.limit) ? (
                      <div
                        aria-label={`Limit ${index + 1}`}
                        className="inline-flex min-h-[44px] items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-black text-slate-600"
                      >
                        Included
                      </div>
                    ) : (
                      <Input
                        variant="ui"
                        aria-label={`Limit ${index + 1}`}
                        value={row.limit}
                        disabled={disabled}
                        placeholder="1,000,000"
                        onChange={(event) => updateRow(index, { limit: formatNumberText(event.target.value) })}
                      />
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <Input
                      variant="ui"
                      aria-label={`Excess ${index + 1}`}
                      value={row.excess}
                      disabled={disabled}
                      placeholder="500"
                      inputMode="decimal"
                      onChange={(event) => updateRow(index, { excess: formatNumberText(event.target.value) })}
                    />
                  </td>
                  <td className="px-6 py-4">
                    <Input
                      variant="ui"
                      aria-label={`Premium ${index + 1}`}
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      value={row.premium}
                      disabled={disabled}
                      placeholder="0.00"
                      onChange={(event) => updateRow(index, { premium: formatNumberText(event.target.value) })}
                    />
                  </td>
                  <td className="px-6 py-4">
                    <Input
                      variant="ui"
                      aria-label={`Notes ${index + 1}`}
                      value={row.notes}
                      disabled={disabled}
                      placeholder="Subject to terms"
                      onChange={(event) => updateRow(index, { notes: event.target.value })}
                    />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button size="sm" variant="ghost" disabled={disabled} onClick={() => removeRow(index)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ui-table-wrap">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">UW adjustments</div>
            <div className="mt-1 text-sm font-semibold text-slate-500">Apply manual loadings or discounts to the proposal total.</div>
          </div>
          <Button size="sm" variant="outline" disabled={disabled} onClick={addAdjustment}>
            + Add adjustment
          </Button>
        </div>
        <div className="overflow-auto">
          <table className="ui-table min-w-tableWide">
            <thead className="ui-thead">
              <tr>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Mode</th>
                <th className="px-6 py-4">Value</th>
                <th className="px-6 py-4">Reason</th>
                <th className="px-6 py-4 text-right">Amount</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="ui-tbody text-sm">
              {pricingAdjustments.length === 0 ? (
                <tr className="ui-row bg-white">
                  <td colSpan={6} className="px-6 py-8 text-center text-sm font-semibold text-slate-400">
                    No UW adjustments.
                  </td>
                </tr>
              ) : pricingAdjustments.map((adjustment, index) => {
                const amount = pricingAdjustmentImpact(adjustment, rowSubtotal);
                return (
                  <tr key={adjustment.id || index} className="ui-row bg-white">
                    <td className="px-6 py-4">
                      <select
                        aria-label={`Adjustment type ${index + 1}`}
                        className="ui-input font-semibold"
                        disabled={disabled}
                        value={String(adjustment.type || 'discount')}
                        onChange={(event) => updateAdjustment(index, { type: event.target.value })}
                      >
                        <option value="discount">Discount</option>
                        <option value="loading">Loading</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <select
                        aria-label={`Adjustment mode ${index + 1}`}
                        className="ui-input font-semibold"
                        disabled={disabled}
                        value={String(adjustment.mode || 'amount')}
                        onChange={(event) => updateAdjustment(index, { mode: event.target.value })}
                      >
                        <option value="amount">Amount</option>
                        <option value="pct">Percent</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <Input
                        variant="ui"
                        aria-label={`Adjustment value ${index + 1}`}
                        inputMode="decimal"
                        value={formatNumberText(String(adjustment.value || ''))}
                        disabled={disabled}
                        placeholder="0.00"
                        onChange={(event) => updateAdjustment(index, { value: formatNumberText(event.target.value) })}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <Input
                        variant="ui"
                        aria-label={`Adjustment reason ${index + 1}`}
                        value={String(adjustment.reasonText || adjustment.reason || '')}
                        disabled={disabled}
                        placeholder="Required if non-zero"
                        onChange={(event) => updateAdjustment(index, { reason: event.target.value, reasonText: event.target.value })}
                      />
                    </td>
                    <td className="px-6 py-4 text-right font-black tabular-nums text-slate-900">
                      {currency} {amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => removeAdjustment(index)}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50">
                <td className="px-6 py-4 text-xs font-black uppercase tracking-widest text-slate-500" colSpan={4}>
                  Total UW adjustment
                </td>
                <td className="px-6 py-4 text-right font-black tabular-nums text-slate-900">
                  {currency} {adjustmentTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="block mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Terms notes</span>
          <textarea
            className="ui-input min-h-[96px] w-full font-semibold"
            aria-label="Terms notes"
            value={draft.termsNotes}
            disabled={disabled}
            onChange={(event) => {
              setDraft((prev) => ({ ...prev, termsNotes: event.target.value }));
              setSaved(false);
            }}
          />
        </label>
        <label className="block">
          <span className="block mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Subjectivities</span>
          <textarea
            className="ui-input min-h-[96px] w-full font-semibold"
            aria-label="Subjectivities"
            value={draft.subjectivities}
            disabled={disabled}
            onChange={(event) => {
              setDraft((prev) => ({ ...prev, subjectivities: event.target.value }));
              setSaved(false);
            }}
          />
        </label>
      </div>

      {!disabled && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="secondary" onClick={addRow}>
            Add row
          </Button>
          <div className="flex items-center gap-3">
            {missingHint && <span className="max-w-xs text-right text-xs font-semibold text-slate-400">{missingHint}</span>}
            {saved && <span className="text-xs font-black text-emerald-700">Saved</span>}
            <Button disabled={isReRating} onClick={saveAndRecalculate}>
              {isReRating ? 'Recalculating...' : 'Save and recalculate'}
            </Button>
            {onSendToClient && (
              <Button
                variant="secondary"
                disabled={isSendingToClient || !readyToSend}
                title={missingHint || undefined}
                onClick={saveAndSendToClient}
              >
                {isSendingToClient ? 'Sending...' : 'Send to client'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
