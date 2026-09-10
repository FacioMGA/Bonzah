import React, { useState } from 'react';
import { Button } from '@/src/shared/ui';
import {
    configurationApi,
    type DraftSummaryResult,
} from '@/src/modules/configuration/api/configurationApi';

interface Props {
    summary: DraftSummaryResult | null;
    onRefresh: () => void;
}

type ValidationState = {
    status: 'passed' | 'failed';
    issues: Array<{ code: string; severity: 'info' | 'warning' | 'error'; message: string }>;
    summary: string;
};

type SimulationState = {
    scenariosRun: number;
    passed: number;
    failed: number;
    results: Array<{ scenarioName: string; outcome: 'passed' | 'failed'; summary: string }>;
};

export const LaunchReadinessPanel: React.FC<Props> = ({ summary, onRefresh }) => {
    const [validation, setValidation] = useState<ValidationState | null>(null);
    const [simulation, setSimulation] = useState<SimulationState | null>(null);
    const [busy, setBusy] = useState(false);

    async function runValidation() {
        if (!summary) return;
        setBusy(true);
        try {
            const envelope = await configurationApi.validateDraft(summary.draftId);
            if (envelope.success) {
                setValidation({
                    status: envelope.result.status,
                    issues: envelope.result.issues,
                    summary: envelope.result.summary,
                });
            } else {
                setValidation({ status: 'failed', issues: [], summary: envelope.error.message });
            }
            onRefresh();
        } finally {
            setBusy(false);
        }
    }

    async function runSimulation() {
        if (!summary) return;
        setBusy(true);
        try {
            const envelope = await configurationApi.runDemoScenarioPack(summary.draftId);
            if (envelope.success) {
                setSimulation(envelope.result);
            }
            onRefresh();
        } finally {
            setBusy(false);
        }
    }

    if (!summary) {
        return <div className="p-4 text-xs text-slate-400 italic">No draft selected.</div>;
    }

    return (
        <div className="p-4 space-y-4 text-xs">
            <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Validation</h3>
                <Button onClick={runValidation} disabled={busy} className="text-xs w-full">
                    Validate draft
                </Button>
                {validation && (
                    <div
                        className={`rounded p-2 ${validation.status === 'passed' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}
                    >
                        <div className="font-semibold">{validation.summary}</div>
                        <ul className="mt-1 space-y-1">
                            {validation.issues.map((i, idx) => (
                                <li key={idx} className="text-[11px]">
                                    <span className="font-mono">[{i.severity}]</span> {i.code}: {i.message}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </section>

            <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Simulation</h3>
                <Button onClick={runSimulation} disabled={busy} className="text-xs w-full">
                    Run Classic Car scenario pack
                </Button>
                {simulation && (
                    <div className="rounded p-2 bg-slate-50 text-slate-800 space-y-1">
                        <div className="font-semibold">
                            {simulation.passed}/{simulation.scenariosRun} passed
                            {simulation.failed > 0 && <span className="text-red-700"> ({simulation.failed} failed)</span>}
                        </div>
                        {simulation.results.map((r) => (
                            <div
                                key={r.scenarioName}
                                className={`text-[11px] ${r.outcome === 'passed' ? 'text-emerald-700' : 'text-red-700'}`}
                            >
                                {r.summary}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section className="space-y-2 pt-3 border-t border-slate-200">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Publish path</h3>
                <p className="text-[11px] text-slate-500">
                    Config MCP’s former metadata-overlay publisher is retired. Publish only through BO Runtime Settings,
                    where the complete programme definition and its explicit binder-product authority are validated together.
                </p>
            </section>
        </div>
    );
};
