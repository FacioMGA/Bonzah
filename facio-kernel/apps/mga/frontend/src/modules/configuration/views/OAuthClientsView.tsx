import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/src/shared/ui';
import {
    oauthClientsApi,
    type OAuthClientListEntry,
} from '@/src/modules/configuration/api/oauthClientsApi';

/**
 * BO view for DCR-registered OAuth clients (ADR-0040 §6 — V2.1).
 *
 * Lists every client that registered itself via /oauth/register on
 * this tenant. Lets the operator revoke (sets revokedAt; access
 * tokens for that client immediately fail validation; refresh tokens
 * are killed at next attempt).
 *
 * NO "register manually" form — DCR handles registration. The
 * "Connect from ChatGPT" quick-start panel shows the discovery URL
 * the customer pastes into ChatGPT Apps connector dialog.
 */
function fmt(ts: string): string {
    try {
        const d = new Date(ts);
        return Number.isNaN(d.valueOf()) ? ts : `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    } catch {
        return ts;
    }
}

function familyOfScopes(scopes: string[]): 'operator' | 'config' | 'mixed' | 'empty' {
    if (scopes.length === 0) return 'empty';
    const hasOp = scopes.some((s) => s.startsWith('operator.'));
    const hasCfg = scopes.some((s) => s.startsWith('configuration.'));
    if (hasOp && hasCfg) return 'mixed';
    if (hasOp) return 'operator';
    if (hasCfg) return 'config';
    return 'empty';
}

export const OAuthClientsView: React.FC = () => {
    const [clients, setClients] = useState<OAuthClientListEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [discoveryUrl, setDiscoveryUrl] = useState('');

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const next = await oauthClientsApi.list();
            setClients(next);
        } catch (err) {
            setError(String(err instanceof Error ? err.message : err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
        // Derive discovery URL from window.location at runtime — the
        // tenant host is whatever the BO is currently being served from.
        setDiscoveryUrl(`${window.location.origin}/.well-known/oauth-protected-resource`);
    }, [reload]);

    async function handleRevoke(clientId: string, clientName: string) {
        if (!window.confirm(`Revoke OAuth client "${clientName}"? All current and future tokens for this client will be rejected.`)) {
            return;
        }
        try {
            await oauthClientsApi.revoke(clientId);
            await reload();
        } catch (err) {
            setError(String(err instanceof Error ? err.message : err));
        }
    }

    async function copyDiscoveryUrl() {
        try {
            await navigator.clipboard.writeText(discoveryUrl);
        } catch {
            // ignore — older browsers
        }
    }

    return (
        <div className="space-y-4">
            <header>
                <h2 className="text-lg font-semibold">Operator MCP — OAuth clients (V2.1)</h2>
                <p className="text-xs text-slate-500">
                    Remote MCP clients (ChatGPT Apps, Claude Desktop with OAuth, future browser-based hosts) that self-registered
                    via the Dynamic Client Registration endpoint. Revoke kills all access + refresh tokens for that client
                    immediately. Audit rows land in <code>audit_actions WHERE actionName LIKE 'OAUTH.%'</code>.
                </p>
            </header>

            <div className="border border-purple-200 rounded p-3 bg-purple-50 space-y-2">
                <div className="text-xs font-semibold text-purple-900">Connect a new ChatGPT App connector</div>
                <p className="text-xs text-purple-800">
                    In ChatGPT &rarr; Settings &rarr; Connectors &rarr; Advanced &rarr; "Add custom connector",
                    paste this discovery URL. ChatGPT will register itself via DCR, walk the operator through
                    consent, and start using the operator tools.
                </p>
                <div className="flex items-center gap-2">
                    <code className="text-[11px] bg-white px-2 py-1 rounded border border-purple-300 flex-1 select-all">{discoveryUrl}</code>
                    <Button onClick={copyDiscoveryUrl} className="text-xs">Copy</Button>
                </div>
            </div>

            <div className="flex justify-end">
                <Button onClick={reload} disabled={loading} className="text-xs">
                    {loading ? 'Loading…' : 'Refresh'}
                </Button>
            </div>

            {error && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
            )}

            <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-xs">
                    <thead className="bg-slate-100 text-slate-700">
                        <tr>
                            <th className="text-left px-3 py-2 font-medium">Name</th>
                            <th className="text-left px-3 py-2 font-medium">Client ID</th>
                            <th className="text-left px-3 py-2 font-medium">Family</th>
                            <th className="text-left px-3 py-2 font-medium">Scopes</th>
                            <th className="text-left px-3 py-2 font-medium">Type</th>
                            <th className="text-left px-3 py-2 font-medium">Created</th>
                            <th className="text-left px-3 py-2 font-medium">Status</th>
                            <th className="text-left px-3 py-2 font-medium"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {clients.length === 0 && !loading && (
                            <tr>
                                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                                    No OAuth clients yet. Paste the discovery URL above into a remote MCP client to register the first.
                                </td>
                            </tr>
                        )}
                        {clients.map((c) => {
                            const family = familyOfScopes(c.scopes);
                            return (
                                <tr key={c.client_id} className="border-t border-slate-100 hover:bg-slate-50">
                                    <td className="px-3 py-2 text-slate-800">
                                        <div className="font-semibold">{c.client_name}</div>
                                        {c.client_uri && (
                                            <a href={c.client_uri} target="_blank" rel="noopener noreferrer" className="text-[10px] text-slate-500 underline">
                                                {c.client_uri}
                                            </a>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 font-mono text-[10px] text-slate-600">{c.client_id}</td>
                                    <td className="px-3 py-2">
                                        <span className={`text-[10px] px-2 py-0.5 rounded ${
                                            family === 'operator' ? 'bg-purple-100 text-purple-800'
                                            : family === 'config' ? 'bg-blue-100 text-blue-800'
                                            : family === 'mixed' ? 'bg-amber-100 text-amber-800'
                                            : 'bg-slate-100 text-slate-600'
                                        }`}>{family}</span>
                                    </td>
                                    <td className="px-3 py-2 font-mono text-[10px] text-slate-700">
                                        {c.scopes.length > 3 ? `${c.scopes.slice(0, 3).join(', ')} +${c.scopes.length - 3}` : c.scopes.join(', ')}
                                    </td>
                                    <td className="px-3 py-2 text-[10px] text-slate-600">
                                        {c.is_public ? 'public (PKCE)' : 'confidential'} · {c.registration_kind}
                                    </td>
                                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmt(c.created_at)}</td>
                                    <td className="px-3 py-2">
                                        {c.revoked_at ? (
                                            <span className="text-[10px] text-red-700">revoked</span>
                                        ) : (
                                            <span className="text-[10px] text-green-700">active</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        {!c.revoked_at && (
                                            <button
                                                onClick={() => handleRevoke(c.client_id, c.client_name)}
                                                className="text-[10px] text-red-700 hover:underline"
                                            >
                                                Revoke
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
