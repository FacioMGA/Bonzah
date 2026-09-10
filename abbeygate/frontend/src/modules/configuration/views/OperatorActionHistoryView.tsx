import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/src/shared/ui';
import {
    mcpActionsApi,
    type OperatorActionListEntry,
} from '@/src/modules/configuration/api/mcpActionsApi';

/**
 * BO view surfacing every operator-MCP audit row for the tenant
 * (ADR-0039 §9). Customers and Lloyd's-style auditors can replay
 * exactly what each agent key did and when.
 *
 * Data source: `GET /api/bo/mcp/actions` — backed by the canonical
 * `AuditAction` rows the shared MCP funnel + V2 tools write
 * (`OPERATOR.*` event names).
 *
 * Mounted as a third tab on the Product Architect page (sibling to
 * "BO architect" and "Remote MCP keys").
 */
type PrefixFilter = 'all' | 'OPERATOR.QUOTE_' | 'OPERATOR.ENDORSEMENT_' | 'OPERATOR.COMM_' | 'OPERATOR.TOOL_CALLED.';

const PREFIX_LABELS: Record<PrefixFilter, string> = {
    all: 'All actions',
    'OPERATOR.QUOTE_': 'Quote mutations',
    'OPERATOR.ENDORSEMENT_': 'Endorsements',
    'OPERATOR.COMM_': 'Customer comms',
    'OPERATOR.TOOL_CALLED.': 'Tool calls (raw)',
};

function fmt(ts: string): string {
    try {
        const d = new Date(ts);
        return Number.isNaN(d.valueOf()) ? ts : `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    } catch {
        return ts;
    }
}

function actionLabel(action: string): string {
    return action.replace('OPERATOR.', '').replace(/_/g, ' ').toLowerCase();
}

function summarizeDiff(diff: unknown): string {
    if (!diff || typeof diff !== 'object') return '';
    const rec = diff as Record<string, unknown>;
    if (Array.isArray(rec.changedFields)) {
        const arr = rec.changedFields as Array<{ field?: unknown }>;
        const fields = arr.map((c) => String(c.field || '')).filter(Boolean);
        if (fields.length === 0) return '';
        return `changed: ${fields.slice(0, 4).join(', ')}${fields.length > 4 ? ` +${fields.length - 4}` : ''}`;
    }
    if (typeof rec.recipient === 'string') return `→ ${rec.recipient}`;
    if (typeof rec.transactionNumber === 'number') return `endorsement #${rec.transactionNumber}`;
    if (typeof rec.reasonCode === 'string') return rec.reasonCode;
    return '';
}

export const OperatorActionHistoryView: React.FC = () => {
    const [rows, setRows] = useState<OperatorActionListEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [prefix, setPrefix] = useState<PrefixFilter>('all');
    const [actorFilter, setActorFilter] = useState('');
    const [entityFilter, setEntityFilter] = useState('');
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const next = await mcpActionsApi.list({
                limit: 100,
                actionPrefix: prefix === 'all' ? undefined : prefix,
                actorId: actorFilter.trim() || undefined,
                entityId: entityFilter.trim() || undefined,
            });
            setRows(next);
        } catch (err) {
            setError(String(err instanceof Error ? err.message : err));
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, [prefix, actorFilter, entityFilter]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const visible = useMemo(() => rows, [rows]);

    return (
        <div className="space-y-3">
            <header>
                <h2 className="text-lg font-semibold">Operator MCP — Action history</h2>
                <p className="text-xs text-slate-500">
                    Every <code>OPERATOR.*</code> audit row for this tenant. Sourced from the canonical AuditAction
                    table; one row per tool call. Use this to demonstrate Lloyd's-style traceability or to investigate
                    a specific key's activity.
                </p>
            </header>

            <div className="flex flex-wrap items-end gap-3 border border-slate-200 rounded p-3 bg-slate-50">
                <label className="text-xs text-slate-700 flex flex-col gap-1">
                    <span>Action type</span>
                    <select
                        className="text-xs border border-slate-300 rounded px-2 py-1 bg-white"
                        value={prefix}
                        onChange={(e) => setPrefix(e.target.value as PrefixFilter)}
                    >
                        {(Object.keys(PREFIX_LABELS) as PrefixFilter[]).map((k) => (
                            <option key={k} value={k}>{PREFIX_LABELS[k]}</option>
                        ))}
                    </select>
                </label>
                <label className="text-xs text-slate-700 flex flex-col gap-1">
                    <span>Actor (apikey:&lt;id&gt;)</span>
                    <input
                        className="text-xs border border-slate-300 rounded px-2 py-1 bg-white w-56"
                        value={actorFilter}
                        placeholder="apikey:..."
                        onChange={(e) => setActorFilter(e.target.value)}
                    />
                </label>
                <label className="text-xs text-slate-700 flex flex-col gap-1">
                    <span>Entity id (policy / risk tx)</span>
                    <input
                        className="text-xs border border-slate-300 rounded px-2 py-1 bg-white w-56"
                        value={entityFilter}
                        placeholder="pol_..."
                        onChange={(e) => setEntityFilter(e.target.value)}
                    />
                </label>
                <Button onClick={reload} disabled={loading} className="text-xs">
                    {loading ? 'Loading…' : 'Refresh'}
                </Button>
            </div>

            {error && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                    {error}
                </div>
            )}

            <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-xs">
                    <thead className="bg-slate-100 text-slate-700">
                        <tr>
                            <th className="text-left px-3 py-2 font-medium">When</th>
                            <th className="text-left px-3 py-2 font-medium">Action</th>
                            <th className="text-left px-3 py-2 font-medium">Actor</th>
                            <th className="text-left px-3 py-2 font-medium">Entity</th>
                            <th className="text-left px-3 py-2 font-medium">Detail</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visible.length === 0 && !loading && (
                            <tr>
                                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                                    No operator actions recorded for these filters.
                                </td>
                            </tr>
                        )}
                        {visible.map((row) => (
                            <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmt(row.occurred_at)}</td>
                                <td className="px-3 py-2 font-mono text-slate-800">{actionLabel(row.action)}</td>
                                <td className="px-3 py-2 font-mono text-slate-700">
                                    <div>{row.actor_name || 'Operator Agent'}</div>
                                    <div className="text-[10px] text-slate-500">{row.actor_id}</div>
                                </td>
                                <td className="px-3 py-2 font-mono text-slate-700">
                                    <div>{row.entity_type}</div>
                                    <div className="text-[10px] text-slate-500">{row.entity_id}</div>
                                </td>
                                <td className="px-3 py-2 text-slate-600">{summarizeDiff(row.diff)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
