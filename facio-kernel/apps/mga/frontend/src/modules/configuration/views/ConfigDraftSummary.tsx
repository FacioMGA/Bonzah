import React from 'react';
import type { DraftSummaryResult } from '@/src/modules/configuration/api/configurationApi';

interface Props {
    summary: DraftSummaryResult | null;
    isLoading?: boolean;
}

const STATUS_STYLES: Record<DraftSummaryResult['status'], string> = {
    draft: 'bg-slate-100 text-slate-700',
    validation_failed: 'bg-red-100 text-red-700',
    validated: 'bg-amber-100 text-amber-700',
    simulated: 'bg-blue-100 text-blue-700',
    sandbox_published: 'bg-emerald-100 text-emerald-700',
    archived: 'bg-slate-100 text-slate-500',
};

export const ConfigDraftSummary: React.FC<Props> = ({ summary, isLoading }) => {
    if (isLoading) {
        return (
            <div className="p-6 text-sm text-slate-500">Loading draft summary…</div>
        );
    }
    if (!summary) {
        return (
            <div className="p-6 text-sm text-slate-500">
                No draft selected. Clone a template from the conversation panel to begin.
            </div>
        );
    }
    return (
        <div className="p-6 space-y-4">
            <div>
                <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-slate-900">{summary.productName}</h2>
                    <span
                        className={`text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded ${STATUS_STYLES[summary.status]}`}
                    >
                        {summary.status.replace(/_/g, ' ')}
                    </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                    Draft <code>{summary.draftId}</code> · {summary.productCode} · template{' '}
                    <code>{summary.baseTemplateId}</code>
                </p>
            </div>

            <SummarySection title="Configured capabilities" items={summary.configuredCapabilities} empty="Nothing configured yet." />
            <SummarySection title="Missing decisions" items={summary.missingDecisions} empty="All template capabilities configured." />

            {summary.publishedProgramId && (
                <div className="text-xs text-emerald-700 bg-emerald-50 rounded p-3">
                    Published to sandbox as program <code>{summary.publishedProgramId}</code>
                    {summary.publishedBinderId && (
                        <>
                            {' '}with binder <code>{summary.publishedBinderId}</code>
                        </>
                    )}.
                </div>
            )}
        </div>
    );
};

const SummarySection: React.FC<{ title: string; items: string[]; empty: string }> = ({
    title,
    items,
    empty,
}) => (
    <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{title}</h3>
        {items.length === 0 ? (
            <p className="text-sm text-slate-400 italic">{empty}</p>
        ) : (
            <ul className="space-y-1">
                {items.map((item) => (
                    <li key={item} className="text-sm text-slate-700">
                        • {item.replace(/-/g, ' ')}
                    </li>
                ))}
            </ul>
        )}
    </div>
);
