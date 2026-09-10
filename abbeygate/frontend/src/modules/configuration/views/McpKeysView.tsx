import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/src/shared/ui';
import {
    mcpKeysApi,
    type IssuedMcpKey,
    type McpApiKeyListEntry,
    type McpKeyFamily,
} from '@/src/modules/configuration/api/mcpKeysApi';

/**
 * BO view to issue / list / revoke remote-agent Config MCP API keys
 * (ADR-0036 amendment). Customers paste the URL + token into Claude
 * Desktop / ChatGPT Connectors / Cursor MCP settings.
 *
 * The raw token is returned ONCE from the issue API and shown inline
 * with a copy-to-clipboard button. Closing the modal clears it from
 * memory — there is no recovery flow (matches the canonical
 * `ApiKeyService.createApiKey` contract).
 */
export const McpKeysView: React.FC = () => {
    const [keys, setKeys] = useState<McpApiKeyListEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [name, setName] = useState('');
    const [family, setFamily] = useState<McpKeyFamily>('config');
    const [includePublishSandbox, setIncludePublishSandbox] = useState(false);
    const [includeOperatorMutate, setIncludeOperatorMutate] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [issued, setIssued] = useState<IssuedMcpKey | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const next = await mcpKeysApi.list();
            setKeys(next);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    async function issue() {
        setError(null);
        if (!name.trim()) {
            setError('Name is required.');
            return;
        }
        // Family-scoped opt-ins: only relevant for the matching family.
        const effectivePublishSandbox = family === 'config' ? includePublishSandbox : false;
        const effectiveOperatorMutate = family === 'operator' ? includeOperatorMutate : false;
        setBusy(true);
        try {
            const result = await mcpKeysApi.issue({
                name: name.trim(),
                family,
                includePublishSandbox: effectivePublishSandbox,
                includeOperatorMutate: effectiveOperatorMutate,
            });
            setIssued(result);
            setName('');
            setIncludePublishSandbox(false);
            setIncludeOperatorMutate(false);
            await reload();
        } catch (err) {
            setError(String(err instanceof Error ? err.message : err));
        } finally {
            setBusy(false);
        }
    }

    async function revoke(id: string) {
        if (!confirm('Revoke this key? Remote MCP clients using it will be cut off immediately.')) return;
        setBusy(true);
        try {
            await mcpKeysApi.revoke(id);
            await reload();
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-6">
            <section className="border border-slate-200 rounded-lg p-4 bg-white space-y-3">
                <h2 className="text-sm font-bold text-slate-900">Issue a new MCP key</h2>
                <p className="text-xs text-slate-500">
                    Customers paste the endpoint URL + this token into Claude Desktop / ChatGPT Connectors / Cursor MCP
                    settings. The raw token appears once below — store it immediately.
                </p>
                <div className="grid grid-cols-12 gap-3 items-end">
                    <label className="col-span-3 text-xs text-slate-700 flex flex-col gap-1">
                        <span className="font-semibold">Family</span>
                        <select
                            value={family}
                            onChange={(e) => setFamily(e.target.value as McpKeyFamily)}
                            className="border border-slate-300 rounded px-2 py-1 text-sm"
                        >
                            <option value="config">Config (product configuration)</option>
                            <option value="operator">Operator (admin / sales / service)</option>
                        </select>
                    </label>
                    <label className="col-span-5 text-xs text-slate-700 flex flex-col gap-1">
                        <span className="font-semibold">Key name (operator label)</span>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Customer X — ChatGPT Connector"
                            className="border border-slate-300 rounded px-2 py-1 text-sm"
                        />
                    </label>
                    <label className={`col-span-2 text-xs text-slate-700 flex items-center gap-2 pb-1 ${family !== 'config' ? 'opacity-40' : ''}`}>
                        <input
                            type="checkbox"
                            checked={family === 'config' && includePublishSandbox}
                            disabled={family !== 'config'}
                            onChange={(e) => setIncludePublishSandbox(e.target.checked)}
                        />
                        <span>Allow sandbox publish</span>
                    </label>
                    <div className="col-span-2">
                        <Button onClick={issue} disabled={busy} className="text-xs w-full">
                            Issue key
                        </Button>
                    </div>
                </div>
                {family === 'operator' && (
                    <div className="space-y-2 border-l-2 border-purple-200 pl-3 text-xs">
                        <label className="flex items-center gap-2 text-slate-700">
                            <input
                                type="checkbox"
                                checked={includeOperatorMutate}
                                onChange={(e) => setIncludeOperatorMutate(e.target.checked)}
                            />
                            <span>
                                <strong>Allow quote / endorsement mutation</strong>
                                <span className="text-slate-500 ml-1">(operator.mutate, V2)</span>
                            </span>
                        </label>
                        <p className="text-[11px] text-slate-500">
                            Without this opt-in the key gets read + safe-comm + analytics only (V1 baseline). With
                            it, the agent can fork / patch / rate / preview / send quote revisions and create
                            endorsement drafts \u2014 each mutation flows through a preview \u2192 confirmation pipeline.
                        </p>
                    </div>
                )}
                {error && <p className="text-xs text-red-700">{error}</p>}
                {issued && <IssuedKeyCallout issued={issued} onClose={() => setIssued(null)} />}
            </section>

            <section className="border border-slate-200 rounded-lg bg-white">
                <header className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-900">Active keys</h2>
                    <Button onClick={() => void reload()} disabled={loading} className="text-xs">
                        Refresh
                    </Button>
                </header>
                <div className="divide-y divide-slate-100">
                    {keys.length === 0 && !loading && (
                        <p className="px-4 py-6 text-xs text-slate-400 italic">No MCP keys issued yet.</p>
                    )}
                    {keys.map((k) => (
                        <div key={k.id} className="px-4 py-3 flex items-center justify-between">
                            <div className="text-xs">
                                <div className="font-semibold text-slate-900 flex items-center gap-2">
                                    <span>{k.name}</span>
                                    <span
                                        className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                                            k.family === 'operator'
                                                ? 'bg-purple-100 text-purple-700'
                                                : k.family === 'config'
                                                  ? 'bg-blue-100 text-blue-700'
                                                  : 'bg-slate-200 text-slate-600'
                                        }`}
                                    >
                                        {k.family}
                                    </span>
                                    {!k.isActive && <span className="text-red-700">(revoked)</span>}
                                </div>
                                <div className="text-slate-500 mt-0.5">
                                    Created {new Date(k.createdAt).toLocaleString()}
                                    {k.lastUsedAt && ` · Last used ${new Date(k.lastUsedAt).toLocaleString()}`}
                                </div>
                                <div className="text-slate-500 mt-0.5">
                                    Permissions: <code>{k.permissions.join(', ')}</code>
                                </div>
                            </div>
                            {k.isActive && (
                                <Button onClick={() => void revoke(k.id)} disabled={busy} className="text-xs">
                                    Revoke
                                </Button>
                            )}
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
};

const IssuedKeyCallout: React.FC<{ issued: IssuedMcpKey; onClose: () => void }> = ({ issued, onClose }) => {
    const endpoint = `${window.location.origin}${issued.mountPath}`;
    const serverName = issued.family === 'operator' ? 'facio-operator' : 'facio-config';
    const claudeSnippet = JSON.stringify(
        {
            mcpServers: {
                [serverName]: {
                    type: 'http',
                    url: endpoint,
                    headers: { Authorization: `Bearer ${issued.rawKey}` },
                },
            },
        },
        null,
        2,
    );
    return (
        <div className="border border-emerald-300 bg-emerald-50 rounded p-3 text-xs space-y-2">
            <div className="flex items-center justify-between">
                <span className="font-semibold text-emerald-900">
                    Key issued — copy now, it will not be shown again
                </span>
                <button onClick={onClose} className="text-emerald-800 underline">
                    Dismiss
                </button>
            </div>
            <CopyableValue label="Endpoint URL" value={endpoint} />
            <CopyableValue label="Token (Bearer)" value={issued.rawKey} secret />
            <details className="pt-1">
                <summary className="cursor-pointer text-emerald-800 underline">
                    Claude Desktop / Cursor config snippet
                </summary>
                <pre className="bg-white border border-emerald-200 rounded p-2 mt-1 overflow-auto whitespace-pre-wrap text-[11px]">
                    {claudeSnippet}
                </pre>
            </details>
            <p className="text-emerald-900">
                Permissions: <code>{issued.permissions.join(', ')}</code>
            </p>
        </div>
    );
};

const CopyableValue: React.FC<{ label: string; value: string; secret?: boolean }> = ({ label, value, secret }) => {
    const [revealed, setRevealed] = useState(!secret);
    const display = revealed ? value : value.slice(0, 8) + '••••••••••••';
    return (
        <div className="flex items-center gap-2">
            <span className="font-semibold w-28">{label}:</span>
            <code className="flex-1 bg-white border border-emerald-200 rounded px-2 py-1 font-mono">{display}</code>
            {secret && (
                <button onClick={() => setRevealed((r) => !r)} className="text-emerald-800 underline">
                    {revealed ? 'Hide' : 'Reveal'}
                </button>
            )}
            <button
                onClick={() => void navigator.clipboard?.writeText(value)}
                className="text-emerald-800 underline"
            >
                Copy
            </button>
        </div>
    );
};
