import React, { useState, useEffect } from 'react';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import { formatDateUI } from '@/src/shared/lib/format';
import type { Program, Currency } from '@/src/modules/programs/model/programs';

interface ProgramAuthorityProps {
    program: Program;
    isEditing: boolean;
    onUpdate: (updates: Partial<Program>) => void;
}

export const ProgramAuthority: React.FC<ProgramAuthorityProps> = ({ program, isEditing, onUpdate }) => {
    type BinderSummary = { id: string; status?: string; agreementNumber?: string; umr?: string; coverholderName?: string };
    type ProgramBinderLink = { id: string; binderId?: string; status?: string; binder?: BinderSummary };
    const [linkedBinders, setLinkedBinders] = useState<ProgramBinderLink[]>([]);
    const [allBinders, setAllBinders] = useState<BinderSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [binderToLinkId, setBinderToLinkId] = useState<string>('');

    // Local state for edit mode inputs
    const [editName, setEditName] = useState(program.name);
    const [editCurrency, setEditCurrency] = useState(program.currency || 'EUR');

    // Sync props to state when not editing (or initially)
    useEffect(() => {
        if (!isEditing) {
            setEditName(program.name);
            setEditCurrency(program.currency || 'EUR');
        }
    }, [program, isEditing]);

    const handleNameChange = (val: string) => {
        setEditName(val);
        onUpdate({ name: val });
    };

    const handleCurrencyChange = (val: Currency) => {
        setEditCurrency(val);
        onUpdate({ currency: val });
    };

    // Load binders
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const [linksResp, bindersResp] = await Promise.all([
                    api.request(`programs/${program.id}/binders`),
                    api.request('binders'),
                ]);
                if (cancelled) return;

                if (!linksResp?.success) throw new Error(linksResp?.error?.message || 'Failed to load linked binders');
                if (!bindersResp?.success) throw new Error(bindersResp?.error?.message || 'Failed to load binders');

                setLinkedBinders(Array.isArray(linksResp.data) ? linksResp.data : []);

                const list = (bindersResp.data || []) as BinderSummary[];
                const actives = list.filter((b) => String(b.status || '').toUpperCase() === 'ACTIVE');
                const available = actives.length ? actives : list;
                setAllBinders(available);

                if (available.length) {
                    setBinderToLinkId((prev) => prev || available[0].id);
                }
            } catch (e: unknown) {
                const errRecord = (e && typeof e === 'object') ? (e as Record<string, unknown>) : {};
                if (!cancelled) {
                    setLinkedBinders([]);
                    setAllBinders([]);
                    setError(String(errRecord.message || 'Failed to load binders'));
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [program.id]);

    const linkBinder = async () => {
        if (!binderToLinkId) return;
        try {
            setLoading(true);
            const resp = await api.request(`programs/${program.id}/binders`, {
                method: 'POST',
                body: JSON.stringify({ binderId: binderToLinkId, status: 'ACTIVE', mapping: {} }),
            });
            if (!resp?.success) throw new Error(resp?.error?.message || 'Failed to link binder');

            // Refresh links
            const linksResp = await api.request(`programs/${program.id}/binders`);
            if (linksResp?.success) setLinkedBinders(Array.isArray(linksResp.data) ? linksResp.data : []);
        } catch (e: unknown) {
            const errRecord = (e && typeof e === 'object') ? (e as Record<string, unknown>) : {};
            setError(String(errRecord.message || 'Failed to link binder'));
        } finally {
            setLoading(false);
        }
    };

    const unlinkBinder = async (linkId: string) => {
        try {
            setLoading(true);
            const resp = await api.request(`programs/${program.id}/binders/${linkId}`, { method: 'DELETE' });
            if (!resp?.success) throw new Error(resp?.error?.message || 'Failed to unlink');
            setLinkedBinders((prev) => prev.filter((x) => x.id !== linkId));
        } catch (e: unknown) {
            const errRecord = (e && typeof e === 'object') ? (e as Record<string, unknown>) : {};
            setError(String(errRecord.message || 'Failed to unlink'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="ui-card ui-card-pad space-y-6 lg:col-span-2">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Authority</div>
                    <h2 className="text-xl font-black text-slate-900 mt-1">What are we allowed to write</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white border border-slate-200 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Scope</div>
                        {isEditing ? (
                            <div className="mt-2 space-y-2">
                                <label className="block text-xs font-bold text-slate-700">Program Name</label>
                                <Input
                                    className="ui-input w-full"
                                    value={editName}
                                    onChange={(e) => handleNameChange(e.target.value)}
                                />
                            </div>
                        ) : (
                            <div className="mt-2 text-sm font-black text-slate-900">{program.name} • Private Motor • Cyprus</div>
                        )}

                        <div className="mt-2 text-sm text-slate-600 font-semibold flex items-center gap-2">
                            Binder: <span className="font-black text-slate-800">{linkedBinders.length ? `${linkedBinders.length} Linked` : '—'}</span> • Currency:
                            {isEditing ? (
                                <Select
                                    className="ui-select py-0 px-2 h-6 w-auto text-xs ml-1"
                                    value={editCurrency}
                                    onChange={(e) => {
                                        const next = e.target.value;
                                        if (next === 'EUR' || next === 'USD' || next === 'GBP') handleCurrencyChange(next);
                                    }}
                                >
                                    <option value="EUR">EUR</option>
                                    <option value="USD">USD</option>
                                    <option value="GBP">GBP</option>
                                </Select>
                            ) : (
                                <span className="font-black text-slate-800">{program.currency || 'EUR'}</span>
                            )}
                        </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Auto-bind</div>
                        <div className="mt-2 text-sm font-black text-slate-900">Enabled</div>
                        <div className="mt-2 text-sm text-slate-600 font-semibold">Limits and referral triggers configured in Underwriting Rules.</div>
                    </div>

                    <div className="md:col-span-2 bg-slate-50 border border-slate-200 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Why this tab exists</div>
                        <div className="mt-2 text-sm text-slate-700 font-semibold">
                            Program = blueprint. Binder = authority/capacity. This stage defines “where/what” before pricing or documents.
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-8">
                <div className="ui-card ui-card-pad space-y-6">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Binders</div>
                        <h2 className="text-xl font-black text-slate-900 mt-1">Allowed binders</h2>
                        <div className="mt-1 text-sm text-slate-600 font-semibold">
                            Underwriting links.
                        </div>
                    </div>
                    {error && (
                        <div className="mt-3 text-sm font-bold text-rose-700">Error: {error}</div>
                    )}

                    <div className="mt-5 flex flex-wrap items-end gap-3">
                        <div className="min-w-[180px] flex-1">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Add binder</label>
                            <Select
                                className="ui-select"
                                value={binderToLinkId}
                                onChange={(e) => setBinderToLinkId(e.target.value)}
                                disabled={loading || allBinders.length === 0}
                            >
                                {(allBinders || []).map((b) => (
                                    <option key={b.id} value={b.id}>
                                        {b.agreementNumber || b.umr || b.coverholderName || b.id}
                                    </option>
                                ))}
                            </Select>
                        </div>

                        <Button
                            disabled={loading || !binderToLinkId}
                            onClick={linkBinder}
                        >
                            Link
                        </Button>
                    </div>

                    <div className="mt-6 space-y-3">
                        {loading && !linkedBinders.length ? (
                            <div className="text-sm font-semibold text-slate-500">Loading binders...</div>
                        ) : linkedBinders.length === 0 ? (
                            <div className="text-sm font-semibold text-slate-500">No binders linked yet.</div>
                        ) : (
                            linkedBinders.map((l) => (
                                <div key={l.id} className="p-4 rounded-2xl border border-slate-200 bg-white flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="text-sm font-black text-slate-900">
                                            {l?.binder?.agreementNumber || l?.binder?.umr || l?.binderId}
                                        </div>
                                        <div className="mt-1 text-xs text-slate-500 font-semibold">
                                            Status: <span className="font-black text-slate-700">{String(l.status || '').toUpperCase()}</span>
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="danger"
                                        size="sm"
                                        className="text-xs font-black uppercase tracking-widest text-rose-700 border border-rose-200 px-3 py-2 rounded-xl hover:bg-rose-50"
                                        onClick={() => unlinkBinder(l.id)}
                                    >
                                        Unlink
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="ui-card ui-card-pad space-y-6">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Versioning</div>
                        <h2 className="text-xl font-black text-slate-900 mt-1">History</h2>
                    </div>
                    <div className="space-y-3">
                        {program.versions.map((v) => (
                            <div key={v.version} className="p-4 rounded-2xl border border-slate-200 bg-white">
                                <div className="text-sm font-black text-slate-900">v{v.version} • {v.status}</div>
                                <div className="text-xs text-slate-600 font-bold mt-1">Effective from {v.effectiveFrom}</div>
                                <div className="text-xs text-slate-500 mt-2">{v.changeReason}</div>
                                <div className="text-[11px] text-slate-400 mt-2">Updated {formatDateUI(v.updatedAt, { withTime: true })}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
