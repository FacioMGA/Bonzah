import React, { useCallback, useEffect, useState } from 'react';
import {
    configurationApi,
    type DraftSummaryResult,
} from '@/src/modules/configuration/api/configurationApi';
import { AgentConversationPanel } from './AgentConversationPanel';
import { ConfigDiffViewer } from './ConfigDiffViewer';
import { ConfigDraftSummary } from './ConfigDraftSummary';
import { LaunchReadinessPanel } from './LaunchReadinessPanel';

/**
 * Three-pane Product Architect demo view (spec §17).
 *   Left   — Manager conversation / tool calls
 *   Middle — Draft summary + delta diff
 *   Right  — Validation + simulation + launch checklist (Phase 2+)
 *
 * Phase 0 wires the left pane to listTemplates + cloneTemplate +
 * getDraftSummary. The middle pane renders the live draft.
 */
export const ProductArchitectView: React.FC = () => {
    const [draftId, setDraftId] = useState<string | null>(null);
    const [summary, setSummary] = useState<DraftSummaryResult | null>(null);
    const [loadingSummary, setLoadingSummary] = useState(false);

    const refreshSummary = useCallback(async () => {
        if (!draftId) return;
        setLoadingSummary(true);
        try {
            const next = await configurationApi.getDraftSummary(draftId);
            setSummary(next);
        } catch {
            setSummary(null);
        } finally {
            setLoadingSummary(false);
        }
    }, [draftId]);

    useEffect(() => {
        void refreshSummary();
    }, [refreshSummary]);

    return (
        <div className="grid grid-cols-12 gap-4 h-[calc(100vh-180px)] min-h-[600px]">
            <section className="col-span-4 border border-slate-200 rounded-lg bg-white flex flex-col overflow-hidden">
                <header className="border-b border-slate-200 px-4 py-3">
                    <h2 className="text-sm font-bold text-slate-900">Conversation</h2>
                    <p className="text-xs text-slate-500">Tool calls execute through Config MCP</p>
                </header>
                <AgentConversationPanel
                    onDraftCreated={setDraftId}
                    selectedDraftId={draftId}
                    onRefreshSummary={() => void refreshSummary()}
                />
            </section>

            <section className="col-span-5 border border-slate-200 rounded-lg bg-white flex flex-col overflow-hidden">
                <header className="border-b border-slate-200 px-4 py-3">
                    <h2 className="text-sm font-bold text-slate-900">Draft</h2>
                    <p className="text-xs text-slate-500">Summary + delta against canonical template</p>
                </header>
                <div className="flex-1 overflow-y-auto">
                    <ConfigDraftSummary summary={summary} isLoading={loadingSummary} />
                    <div className="border-t border-slate-200 mt-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 pt-3">
                            Delta (composed)
                        </h3>
                        <ConfigDiffViewer delta={summary?.delta ?? null} />
                    </div>
                </div>
            </section>

            <section className="col-span-3 border border-slate-200 rounded-lg bg-white flex flex-col overflow-hidden">
                <header className="border-b border-slate-200 px-4 py-3">
                    <h2 className="text-sm font-bold text-slate-900">Launch readiness</h2>
                    <p className="text-xs text-slate-500">Validation, simulation, publish</p>
                </header>
                <div className="flex-1 overflow-y-auto">
                    <LaunchReadinessPanel summary={summary} onRefresh={() => void refreshSummary()} />
                </div>
            </section>
        </div>
    );
};
