import React from 'react';

interface Props {
    delta: Record<string, unknown> | null;
}

/**
 * Phase 0 diff viewer — renders the composed draft delta as a pretty
 * JSON block grouped by canonical-owner section. Phase 1 will switch
 * this to a side-by-side diff against the template baseline.
 */
export const ConfigDiffViewer: React.FC<Props> = ({ delta }) => {
    if (!delta || Object.keys(delta).length === 0) {
        return (
            <div className="p-4 text-xs text-slate-400 italic">
                No delta yet. Use the conversation panel to add referral rules, documents, or commercial terms.
            </div>
        );
    }
    return (
        <div className="p-4 space-y-3">
            {Object.entries(delta).map(([section, value]) => (
                <details key={section} className="border border-slate-200 rounded">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 bg-slate-50">
                        {section}
                    </summary>
                    <pre className="text-xs p-3 overflow-auto bg-white text-slate-700">
                        {JSON.stringify(value, null, 2)}
                    </pre>
                </details>
            ))}
        </div>
    );
};
