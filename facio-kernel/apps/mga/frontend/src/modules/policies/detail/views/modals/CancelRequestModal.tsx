import React from 'react';
import { Calendar } from 'lucide-react';
import { Modal } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { Textarea } from '@/src/shared/ui';
import { parseDateLoose } from '../../../model/policyPageHelpers';
import { asRecord, type UnknownRecord } from '@/src/shared/lib/record';

type DateInputElement = HTMLInputElement & { showPicker?: () => void };

interface CancelRequestModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedPortfolio: UnknownRecord | null;
    cancelReason: string;
    setCancelReason: (v: string) => void;
    cancelEffectiveDate: string;
    setCancelEffectiveDate: (v: string) => void;
    isRequestingCancellation: boolean;
    onSubmit: () => Promise<void>;
}

export function CancelRequestModal({
    isOpen,
    onClose,
    selectedPortfolio,
    cancelReason,
    setCancelReason,
    cancelEffectiveDate,
    setCancelEffectiveDate,
    isRequestingCancellation,
    onSubmit,
}: CancelRequestModalProps) {
    // Cancellation date validation (derived state)
    const policyEndForCancellation = parseDateLoose(
        asRecord(selectedPortfolio).expiryDate || asRecord(selectedPortfolio).end
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxIn45Days = new Date(today);
    maxIn45Days.setDate(maxIn45Days.getDate() + 45);
    const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);
    const cancelMinDate = toDateOnly(today);
    const cancelMaxDate = toDateOnly(
        policyEndForCancellation && !Number.isNaN(policyEndForCancellation.getTime()) && policyEndForCancellation < maxIn45Days
            ? policyEndForCancellation
            : maxIn45Days
    );
    const cancelDateValue = String(cancelEffectiveDate || '').trim();
    const parsedCancelDate = cancelDateValue ? parseDateLoose(cancelDateValue) : undefined;
    const isCancelDateValid =
        Boolean(parsedCancelDate)
        && !Number.isNaN(parsedCancelDate!.getTime())
        && cancelDateValue >= cancelMinDate
        && cancelDateValue <= cancelMaxDate
        && (!policyEndForCancellation || cancelDateValue <= toDateOnly(policyEndForCancellation));
    const cancelDateError = (() => {
        if (!cancelDateValue) return 'Cancellation effective date is required.';
        if (!isCancelDateValid) {
            return `Date must be between ${cancelMinDate} and ${cancelMaxDate}.`;
        }
        return '';
    })();
    const canSubmitCancelRequest = Boolean(selectedPortfolio?.id) && !isRequestingCancellation && !cancelDateError;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Record cancellation request"
            actions={(
                <>
                    <Button
                        type="button"
                        variant="ghost"
                        size="md"
                        onClick={onClose}
                        className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition bg-transparent"
                        disabled={isRequestingCancellation}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        size="md"
                        onClick={onSubmit}
                        className="bg-brand-primary text-white px-6 py-3 rounded-xl font-black shadow-lg hover:bg-brand-secondary transition disabled:opacity-60"
                        disabled={!canSubmitCancelRequest}
                    >
                        {isRequestingCancellation ? 'Saving…' : 'Record request'}
                    </Button>
                </>
            )}
        >
            <div className="space-y-4">
                <div className="text-sm text-slate-600">
                    This moves the lifecycle to <span className="font-black">CANCELLATION REQUESTED</span> and creates an ops/UW queue item.
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Requested effective date</label>
                        <div className="relative group/field">
                            <Input
                                type="date"
                                value={cancelEffectiveDate}
                                min={cancelMinDate}
                                max={cancelMaxDate}
                                onValueChange={(next) => setCancelEffectiveDate(next)}
                                variant="ui"
                                className="font-bold pr-16"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition-colors"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const el = e.currentTarget.parentElement?.querySelector('input[type="date"]') as DateInputElement | null;
                                    if (typeof el?.showPicker === 'function') el.showPicker();
                                    else {
                                        el?.focus?.();
                                        el?.click?.();
                                    }
                                }}
                                aria-label="Open date picker"
                                tabIndex={-1}
                            >
                                <Calendar className="w-4 h-4" />
                            </Button>
                        </div>
                        {cancelDateError && <div className="mt-1 text-xs font-semibold text-red-600">{cancelDateError}</div>}
                    </div>
                    <div>
                        <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Policy number</label>
                        <div className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-extrabold text-slate-800">
                            {String(asRecord(selectedPortfolio).policyNumber || '—')}
                        </div>
                    </div>
                </div>

                <div>
                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Reason</label>
                    <Textarea
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        placeholder="Customer requested cancellation due to vehicle sold."
                        className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-bold text-slate-800 focus:border-brand-primary outline-none transition-all min-h-panelSm"
                    />
                </div>
            </div>
        </Modal>
    );
}
