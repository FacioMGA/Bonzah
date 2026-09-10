import React, { useEffect, useRef, useState } from 'react';
import { policiesClient as api } from '@/src/modules/policies/api/policiesClient';
import { policyCrudApiClient } from '@/src/modules/policies/api/policyCrudApiClient';
import { ConfigureModal, type ConfigureTemplate } from './ConfigureModal';
import { Button, Input } from '@/src/shared/ui';
import {
    EligibilityFailureModal,
    normalizeFailureMessage,
    type EligibilityFailure,
} from './EligibilityFailureModal';
import { logger } from '@/src/shared/lib/logger';
import { asRecord } from '@/src/shared/lib/record';
import {
    applySelectionOptimistically,
    type ParamMap,
    type SelectionMap,
} from './coverageSelectionMerge';

type JsonMap = Record<string, unknown>;

type CoverageOptionsViewItem = {
    code: string;
    label: string;
    summary?: string;
    selected: boolean;
    params: JsonMap;
    premiumImpact: number | null;
    status: 'active' | 'pending' | 'included' | 'available';
    configurable: boolean;
    scope: string;
    targetOptions: Array<{ id: string; label: string }>;
    helpText?: string;
    legalText?: string;
    formFields?: Array<{ name: string; label: string; type: string; required: boolean; options?: string[] }>;
    defaultParams?: JsonMap;
    disallowedWith?: string[];
};

type CoverageOptionsViewSection = {
    id: string;
    title: string;
    items: CoverageOptionsViewItem[];
};

type CoverageSelection = {
    schemaVersion?: number;
    programId?: string | null;
    programCode?: string | null;
    selected?: SelectionMap;
    params?: ParamMap;
    source?: string;
    updatedAt?: string;
};

type CoverageOptionsView = {
    sections: CoverageOptionsViewSection[];
    savedSelection: CoverageSelection;
    resolvedCoverageSet?: {
        productType?: string;
        programCode?: string;
        selectedCodes?: string[];
        items?: Array<{
            code?: string;
            enabled?: boolean;
            selected?: boolean;
            params?: JsonMap;
            targetId?: string;
            type?: string;
            scope?: string;
            group?: string;
        }>;
        applied?: Array<{ code?: string; params?: JsonMap; targetId?: string }>;
    };
};

interface CoveragesAndOptionsProps {
    policyId: string;
    policySnapshot: JsonMap;
    programId?: string;
    onRefreshPolicy: () => void;
    riskTransactionId?: string | null;
    readOnly?: boolean;
}

export const CoveragesAndOptions: React.FC<CoveragesAndOptionsProps> = ({
    policyId, policySnapshot, programId, onRefreshPolicy, riskTransactionId = null, readOnly = false
}) => {
    const [loading, setLoading] = useState(true);
    const [coverageView, setCoverageView] = useState<CoverageOptionsView | null>(null);
    const selectionSaveSeqRef = useRef(0);
    const coverageViewFetchSeqRef = useRef(0);
    const localSelectionWriteAtRef = useRef(0);
    const coverageViewRef = useRef<CoverageOptionsView | null>(null);
    const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const persistQueuedRef = useRef<{ selected: SelectionMap; params: ParamMap } | null>(null);
    const [busyCodes, setBusyCodes] = useState<Record<string, boolean>>({});
    const rerateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [eligibilityQueue, setEligibilityQueue] = useState<EligibilityFailure[]>([]);
    const [activeEligibilityFailure, setActiveEligibilityFailure] = useState<EligibilityFailure | null>(null);
    const shownEligibilityCodesRef = useRef<Set<string>>(new Set());
    const [accordionOpen, setAccordionOpen] = useState<Record<string, boolean>>({});
    const [configureItem, setConfigureItem] = useState<CoverageOptionsViewItem | null>(null);
    const isLocked = Boolean(readOnly);

    const enqueueEligibilityFailure = (failure: EligibilityFailure) => {
        const code = String(failure?.code || '').trim();
        if (!code) return;
        if (shownEligibilityCodesRef.current.has(code)) return;
        shownEligibilityCodesRef.current.add(code);
        setEligibilityQueue((prev) => [...prev, failure]);
    };

    useEffect(() => {
        if (activeEligibilityFailure) return;
        if (!eligibilityQueue.length) return;
        setActiveEligibilityFailure(eligibilityQueue[0]);
        setEligibilityQueue((prev) => prev.slice(1));
    }, [activeEligibilityFailure, eligibilityQueue]);

    useEffect(() => {
        coverageViewRef.current = coverageView;
    }, [coverageView]);

    const fetchCoverageOptionsView = async () => {
        if (!policyId) {
            setCoverageView(null);
            return;
        }
        const seq = ++coverageViewFetchSeqRef.current;
        try {
            const res = await policyCrudApiClient.getCoverageOptionsView(policyId);
            if (seq !== coverageViewFetchSeqRef.current) return;
            if (!res?.success) {
                setCoverageView(null);
                return;
            }
            const incoming = res.data as CoverageOptionsView;
            const shouldSkipFreshLocalWrite = Date.now() - localSelectionWriteAtRef.current < 1200 && coverageViewRef.current;
            if (shouldSkipFreshLocalWrite) return;
            setCoverageView(incoming);
        } catch {
            if (seq !== coverageViewFetchSeqRef.current) return;
            if (!coverageViewRef.current) setCoverageView(null);
        }
    };

    useEffect(() => {
        let mounted = true;
        (async () => {
            setLoading(true);
            try {
                await fetchCoverageOptionsView();
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [policyId, riskTransactionId, policySnapshot?.updatedAt]);

    useEffect(() => {
        const defaults: Record<string, boolean> = {};
        for (const g of coverageView?.sections || []) defaults[String(g.id)] = true;
        setAccordionOpen(defaults);
    }, [coverageView?.sections]);

    const toggleAccordion = (id: string) => setAccordionOpen((p) => ({ ...p, [id]: !p[id] }));

    const queueRerate = (quoteDataArg?: JsonMap) => {
        if (rerateTimerRef.current) clearTimeout(rerateTimerRef.current);
        rerateTimerRef.current = setTimeout(async () => {
            try {
                const qd = quoteDataArg ?? policySnapshot?.quoteData ?? {};
                if (riskTransactionId) {
                    await api.rateEndorsementDraft(policyId, String(riskTransactionId));
                } else {
                    const productType = String(asRecord(policySnapshot).productType || '').trim().toUpperCase();
                    await policyCrudApiClient.rateQuote(productType, encodeURIComponent(policyId), { quoteData: qd });
                }
            } catch {
                // best-effort; UI will still show selections and the next manual refresh will re-rate
            } finally {
                onRefreshPolicy();
                void fetchCoverageOptionsView();
            }
        }, 450);
    };

    const queuePersistCoverageSelection = (next: { selected: SelectionMap; params: ParamMap }) => {
        if (isLocked) return;
        localSelectionWriteAtRef.current = Date.now();
        setCoverageView((prev) => applySelectionOptimistically(prev, next));
        persistQueuedRef.current = next;

        if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
        persistTimerRef.current = setTimeout(async () => {
            const queued = persistQueuedRef.current;
            if (!queued) return;
            const seq = ++selectionSaveSeqRef.current;
            try {
                const res = await policyCrudApiClient.saveCoverageSelection(policyId, { ...(queued as Record<string, unknown>), riskTransactionId: riskTransactionId || undefined });
                if (seq !== selectionSaveSeqRef.current) return;
                if (res?.success) await fetchCoverageOptionsView();
            } catch {
                // best-effort; UI is still correct locally and will self-heal on next load
            }
        }, 350);
    };

    useEffect(() => {
        return () => {
            if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
            if (rerateTimerRef.current) clearTimeout(rerateTimerRef.current);
        };
    }, []);

    useEffect(() => {
        if (!policyId || isLocked) return;
        if (Date.now() - localSelectionWriteAtRef.current < 1200) return;
        const timer = setTimeout(() => {
            void fetchCoverageOptionsView();
        }, 200);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [policyId, riskTransactionId, policySnapshot?.updatedAt]);

    const isSelected = (code: string) => {
        const sections = coverageViewRef.current?.sections || [];
        return sections.some((section) => section.items.some((item) => item.code === code && item.selected));
    };

    const setBusy = (code: string, v: boolean) => {
        setBusyCodes((prev) => ({ ...prev, [code]: v }));
    };

    const renderStatusChip = (label: string, tone: 'green' | 'amber') => {
        const styles =
            tone === 'green'
                ? 'bg-brand-primary/10 text-brand-primary'
                : 'bg-slate-100 text-slate-700';
        return (
            <span className={`px-3 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${styles}`}>
                {label}
            </span>
        );
    };

    const renderItemRow = (item: CoverageOptionsViewItem) => {
        const busy = Boolean(busyCodes[item.code]);
        const disabled = busy || isLocked;
        const summaryText = String(item.summary || item.helpText || '').trim();
        const isPending = item.status === 'pending';
        const isActive = item.status === 'active';

        return (
            <div
                key={item.code}
                className={`ui-row flex items-center justify-between bg-white px-8 py-6 ${item.configurable && !disabled ? 'cursor-pointer' : ''} ${disabled ? 'opacity-70' : ''}`}
                onClick={() => {
                    if (disabled) return;
                    if (item.configurable) setConfigureItem(item);
                }}
            >
                <div className="flex items-start gap-4 min-w-0 flex-1">
                    <Input
                        type="checkbox"
                        checked={item.selected}
                        disabled={disabled}
                        onChange={async () => {
                            if (disabled) return;
                            setBusy(item.code, true);
                            try {
                                if (item.selected) {
                                    const curr = coverageViewRef.current?.savedSelection;
                                    const nextSelected = { ...(curr?.selected || {}) };
                                    nextSelected[item.code] = false;
                                    queuePersistCoverageSelection({ selected: nextSelected, params: { ...(curr?.params || {}) } });
                                    queueRerate();
                                    return;
                                }
                                const disallowedWith = Array.isArray(item.disallowedWith) ? item.disallowedWith : [];
                                const conflicts = disallowedWith.filter((c) => isSelected(String(c)));
                                if (conflicts.length > 0) {
                                    const ok = window.confirm(
                                        `“${item.label}” cannot be combined with: ${conflicts.join(', ')}.\n\nRemove the conflicting selections and continue?`
                                    );
                                    if (!ok) return;
                                    const curr = coverageViewRef.current?.savedSelection;
                                    const nextSelected = { ...(curr?.selected || {}) };
                                    for (const c of conflicts) nextSelected[String(c)] = false;
                                    queuePersistCoverageSelection({ selected: nextSelected, params: { ...(curr?.params || {}) } });
                                }

                                if (item.configurable) {
                                    setConfigureItem(item);
                                    return;
                                }
                                const curr = coverageViewRef.current?.savedSelection;
                                const params = { ...(curr?.params?.[item.code] || {}), ...(item.defaultParams || {}) };
                                const nextSelected = { ...(curr?.selected || {}) };
                                nextSelected[item.code] = true;
                                const nextParams = { ...(curr?.params || {}) };
                                nextParams[item.code] = params;
                                queuePersistCoverageSelection({ selected: nextSelected, params: nextParams });
                                queueRerate();
                            } catch (e) {
                                enqueueEligibilityFailure({
                                    code: item.code,
                                    title: item.label || item.code,
                                    message: normalizeFailureMessage(e, `Cannot apply ${item.code} for current quote state.`),
                                });
                            } finally {
                                setBusy(item.code, false);
                            }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5 h-5 w-5 rounded border-slate-300 text-brand-primary focus:ring-brand-primary cursor-pointer accent-brand-primary disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-base font-bold text-slate-800">{item.label}</span>
                            {asRecord(item.defaultParams).refundable === false && (
                                <span
                                    className="text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded"
                                    title="This add-on is outside insurer premium and is non-refundable."
                                >
                                    Non-refundable
                                </span>
                            )}
                        </div>
                        {summaryText && (
                            <div className="text-sm text-slate-500 mt-1 pr-6">
                                {summaryText}
                            </div>
                        )}
                        {item.configurable && (
                            <Button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (disabled) return;
                                    setConfigureItem(item);
                                }}
                                disabled={disabled}
                                variant="ghost"
                                size="sm"
                                className="mt-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                Configure
                            </Button>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {(isActive || isPending) && renderStatusChip(isPending ? 'Pending' : 'Active', isPending ? 'amber' : 'green')}
                </div>
            </div>
        );
    };

    if (loading) return <div className="p-8 text-center text-slate-400">Loading Configuration...</div>;

    return (
        <div className="w-full max-w-7xl mx-auto py-8">
            {!programId && (
                <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                    Select a Program in Underwriting to load the correct coverage catalog.
                </div>
            )}

            <div className="space-y-4">
                {(coverageView?.sections || []).map((cat) => {
                    const isOpen = Boolean(accordionOpen[cat.id]);
                    const total = cat.items.length;
                    const selected = cat.items.filter((item) => item.selected).length;

                    return (
                        <div key={cat.id} className="ui-table-wrap">
                            <Button
                                onClick={() => toggleAccordion(cat.id)}
                                variant="ghost"
                                size="sm"
                                className="w-full px-10 py-6 flex items-center justify-between gap-6 text-left bg-slate-50/60 border-b border-slate-200/60 hover:bg-slate-50/80 transition-colors"
                                type="button"
                                aria-expanded={isOpen}
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <span className="text-base font-black text-slate-800 tracking-tight truncate">{cat.title}</span>
                                </div>

                                <div className="flex items-center gap-3 shrink-0">
                                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                                        {selected}/{total} selected
                                    </span>
                                    <svg
                                        className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </div>
                            </Button>

                            <div
                                className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                                style={{ willChange: 'grid-template-rows' }}
                            >
                                <div className="min-h-0 overflow-hidden">
                                    <div className="bg-white">
                                        <div className="divide-y divide-slate-200/60">
                                            {cat.items.map(renderItemRow)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {configureItem && (
                <ConfigureModal
                    template={{
                        code: configureItem.code,
                        title: configureItem.label,
                        summary: configureItem.summary,
                        scope: configureItem.scope,
                        default_params: configureItem.defaultParams,
                        legal_text: configureItem.legalText,
                        document_template: undefined,
                        disallowed_with: configureItem.disallowedWith,
                        ui: {
                            help_text: configureItem.helpText,
                            form_fields: configureItem.formFields || [],
                        },
                    } satisfies ConfigureTemplate}
                    isOpen={true}
                    mode="overlay"
                    onClose={() => setConfigureItem(null)}
                    onApply={async (p) => {
                        if (isLocked) return;
                        setBusy(configureItem.code, true);
                        try {
                            const curr = coverageViewRef.current?.savedSelection;
                            const nextSelected = { ...(curr?.selected || {}) };
                            nextSelected[configureItem.code] = true;
                            const nextParams = { ...(curr?.params || {}) };
                            nextParams[configureItem.code] = p;
                            queuePersistCoverageSelection({ selected: nextSelected, params: nextParams });
                            queueRerate();
                        } catch (e) {
                            enqueueEligibilityFailure({
                                code: configureItem.code,
                                title: configureItem.label || configureItem.code,
                                message: normalizeFailureMessage(e, `Cannot apply ${configureItem.code} for current quote state.`),
                            });
                            logger.error({ err: e, policyId, code: configureItem.code }, '[CoveragesAndOptions] apply from modal failed');
                            throw e;
                        } finally {
                            setBusy(configureItem.code, false);
                        }
                    }}
                    onRemove={async () => {
                        if (isLocked) return;
                        setBusy(configureItem.code, true);
                        try {
                            const curr = coverageViewRef.current?.savedSelection;
                            const nextSelected = { ...(curr?.selected || {}) };
                            nextSelected[configureItem.code] = false;
                            queuePersistCoverageSelection({ selected: nextSelected, params: { ...(curr?.params || {}) } });
                            queueRerate();
                        } finally {
                            setBusy(configureItem.code, false);
                        }
                    }}
                    isActive={configureItem.status === 'active' || configureItem.status === 'pending'}
                    initialParams={coverageView?.savedSelection?.params?.[configureItem.code] || configureItem.params}
                    policyId={policyId}
                    policySnapshot={policySnapshot}
                    targetOptions={configureItem.targetOptions}
                />
            )}

            <EligibilityFailureModal
                failure={activeEligibilityFailure}
                onClose={() => setActiveEligibilityFailure(null)}
            />
        </div>
    );
};
