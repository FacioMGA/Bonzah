import React, { useState, useEffect } from 'react';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import type { Program, ProgramMbeProductConfig } from '@/src/modules/programs/model/programs';
import type { EndorsementTemplate, FormField } from '@/src/modules/policies/model/mbe';

interface ProgramCoverageProps {
    program: Program;
}

export const ProgramCoverage: React.FC<ProgramCoverageProps> = ({ program }) => {
    const [mbeTemplates, setMbeTemplates] = useState<EndorsementTemplate[]>([]);
    const [mbeConfig, setMbeConfig] = useState<ProgramMbeProductConfig | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = useState<'view' | 'edit'>('view');
    const [tab, setTab] = useState<'Coverages' | 'Excess' | 'Exclusions' | 'Extensions' | 'Extras'>('Coverages');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const [tmplResp, cfgResp] = await Promise.all([
                    api.request(`mbe/templates?programId=${encodeURIComponent(program.id)}`),
                    api.request(`programs/${program.id}/mbe-config`),
                ]);
                if (cancelled) return;
                if (!tmplResp?.success) throw new Error(tmplResp?.error?.message || 'Failed to load MBE templates');
                if (!cfgResp?.success) throw new Error(cfgResp?.error?.message || 'Failed to load MBE product config');
                setMbeTemplates((tmplResp.data || []) as EndorsementTemplate[]);
                setMbeConfig(cfgResp.data as ProgramMbeProductConfig);
            } catch (e: unknown) {
                const errRecord = (e && typeof e === 'object') ? (e as Record<string, unknown>) : {};
                if (cancelled) return;
                setMbeTemplates([]);
                setMbeConfig(null);
                setError(String(errRecord.message || 'Failed to load MBE product config'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [program.id]);

    const handleSave = async () => {
        if (!mbeConfig) return;
        try {
            setSaving(true);
            const resp = await api.request(`programs/${program.id}/mbe-config`, {
                method: 'PUT',
                body: JSON.stringify(mbeConfig),
            });
            if (!resp?.success) throw new Error(resp?.error?.message || 'Failed to save MBE product config');
            setMbeConfig(resp.data as ProgramMbeProductConfig);
            alert('Product config saved');
        } catch (e: unknown) {
            const errRecord = (e && typeof e === 'object') ? (e as Record<string, unknown>) : {};
            setError(String(errRecord.message || 'Failed to save'));
        } finally {
            setSaving(false);
        }
    };

    const handleReload = async () => {
        try {
            setLoading(true);
            setError(null);
            const cfgResp = await api.request(`programs/${program.id}/mbe-config`);
            const tmplResp = await api.request(`mbe/templates?programId=${encodeURIComponent(program.id)}`);
            if (!cfgResp?.success) throw new Error(cfgResp?.error?.message || 'Failed to reload config');
            if (!tmplResp?.success) throw new Error(tmplResp?.error?.message || 'Failed to reload templates');
            setMbeConfig(cfgResp.data as ProgramMbeProductConfig);
            setMbeTemplates((tmplResp.data || []) as EndorsementTemplate[]);
        } catch (e: unknown) {
            const errRecord = (e && typeof e === 'object') ? (e as Record<string, unknown>) : {};
            setError(String(errRecord.message || 'Failed to reload'));
        } finally {
            setLoading(false);
        }
    };

    // Helper logic
    const byTab = (t: EndorsementTemplate) => {
        if (tab === 'Coverages') return t.type === 'COVERAGE';
        if (tab === 'Excess') return t.type === 'EXCESS';
        if (tab === 'Exclusions') return t.type === 'CONDITION';
        if (tab === 'Extensions') return t.type === 'COVER_EXTENSION' || t.type === 'EXTENSION_SPECIAL';
        return t.ui?.group === 'Extras' || t.type === 'PROTECTION' || t.type === 'ASSISTANCE';
    };

    const filteredTemplates = mbeTemplates.filter((t) => t.program_code === mbeConfig?.programCode).filter(byTab);

    const upsertBase = (code: string, patch: Partial<ProgramMbeProductConfig['base'][number]>) => {
        setMbeConfig((prev) => {
            if (!prev) return prev;
            const idx = prev.base.findIndex((x) => x.code === code);
            const nextBase = [...prev.base];
            if (idx >= 0) nextBase[idx] = { ...nextBase[idx], ...patch };
            else nextBase.push({ code, enabled: false, params: {}, ...patch });
            return { ...prev, base: nextBase };
        });
    };

    const upsertOption = (code: string, patch: Partial<ProgramMbeProductConfig['options'][number]>) => {
        setMbeConfig((prev) => {
            if (!prev) return prev;
            const idx = prev.options.findIndex((x) => x.code === code);
            const nextOptions = [...prev.options];
            if (idx >= 0) nextOptions[idx] = { ...nextOptions[idx], ...patch };
            else nextOptions.push({ code, enabledByDefault: false, params: {}, ...patch });
            return { ...prev, options: nextOptions };
        });
    };

    const getEntry = (t: EndorsementTemplate) => {
        if (!mbeConfig) return { kind: 'base' as const, enabled: false, params: {} };
        if (t.type === 'COVERAGE') {
            const e = mbeConfig.base.find((x) => x.code === t.code);
            return { kind: 'base' as const, enabled: e?.enabled ?? false, params: (e?.params || {}) as Record<string, unknown> };
        }
        const e = mbeConfig.options.find((x) => x.code === t.code);
        return { kind: 'option' as const, enabled: e?.enabledByDefault ?? false, params: (e?.params || {}) as Record<string, unknown> };
    };

    const effectiveValue = (t: EndorsementTemplate, entry: { params: Record<string, unknown> }, field: FormField) => {
        const v = entry.params?.[field.name];
        if (v !== undefined && v !== null && v !== '') return v;
        return (t.default_params || {})[field.name];
    };

    const setParam = (t: EndorsementTemplate, field: FormField, nextVal: unknown) => {
        const entry = getEntry(t);
        const nextParams = { ...(entry.params || {}), [field.name]: nextVal };
        if (entry.kind === 'base') upsertBase(t.code, { params: nextParams });
        else upsertOption(t.code, { params: nextParams });
    };

    return (
        <div className="space-y-6">
            <div className="ui-card ui-card-pad">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Magic B Product Builder</div>
                        <div className="text-xl font-black text-slate-900 mt-2">Coverages, excess, exclusions, extensions, extras</div>
                        <div className="mt-2 text-sm text-slate-600 font-semibold">
                            This config is persisted under <span className="font-black text-slate-800">Program.metadata.mbeProductConfig</span> and used by pricing + schedule generation.
                        </div>
                        {error && <div className="mt-3 text-sm font-bold text-rose-700">Error: {error}</div>}
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={`px-3 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition ${mode === 'view' ? 'bg-brand-primary/[0.06] text-brand-primary border-brand-primary/10' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                }`}
                            onClick={() => setMode('view')}
                        >
                            View
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={`px-3 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition ${mode === 'edit' ? 'bg-brand-primary/[0.06] text-brand-primary border-brand-primary/10' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                }`}
                            onClick={() => setMode('edit')}
                        >
                            Edit
                        </Button>
                        <Button
                            variant="secondary"
                            disabled={loading || saving}
                            onClick={handleReload}
                        >
                            Reload
                        </Button>
                        <Button
                            disabled={loading || saving || !mbeConfig || mode !== 'edit'}
                            onClick={handleSave}
                        >
                            {saving ? 'Saving…' : 'Save'}
                        </Button>
                    </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                    {(['Coverages', 'Excess', 'Exclusions', 'Extensions', 'Extras'] as const).map((t) => (
                        <Button
                            key={t}
                            type="button"
                            onClick={() => setTab(t)}
                            variant="ghost"
                            size="sm"
                            className={`px-3 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition ${tab === t ? 'bg-brand-primary/[0.06] text-brand-primary border-brand-primary/10' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                }`}
                        >
                            {t}
                        </Button>
                    ))}
                </div>

                {loading ? (
                    <div className="mt-8 text-sm font-semibold text-slate-500">Loading product configuration…</div>
                ) : !mbeConfig ? (
                    <div className="mt-8 text-sm font-semibold text-slate-500">No product configuration loaded.</div>
                ) : (
                    <div className="mt-8 space-y-4">
                        {!filteredTemplates.length ? (
                            <div className="text-sm font-semibold text-slate-500">No templates in this section.</div>
                        ) : (
                            filteredTemplates.map((t) => {
                                const entry = getEntry(t);
                                const required = Array.isArray(t.parameters_schema?.required) ? (t.parameters_schema.required as string[]) : [];
                                const missingRequired = required.filter((k) => {
                                    const v = effectiveValue(t, entry, { name: k, label: k, type: 'string' });
                                    return v === undefined || v === null || v === '';
                                });

                                return (
                                    <div key={t.code} className="p-5 rounded-3xl border border-slate-200 bg-white">
                                        <div className="flex flex-wrap items-start justify-between gap-4">
                                            <div className="min-w-0">
                                                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.ui?.group || t.type}</div>
                                                <div className="mt-2 text-lg font-black text-slate-900">{t.code} • {t.title}</div>
                                                {t.summary ? <div className="mt-1 text-sm text-slate-600 font-semibold">{t.summary}</div> : null}
                                                <div className="mt-2 text-xs text-slate-500 font-semibold">
                                                    Scope: <span className="font-black text-slate-700">{t.scope}</span>
                                                    {t.requires_underwriter_approval ? <> • <span className="text-amber-700 font-black">UW approval required</span></> : null}
                                                </div>
                                                {missingRequired.length ? (
                                                    <div className="mt-2 text-xs font-bold text-rose-700">
                                                        Missing required: {missingRequired.join(', ')}
                                                    </div>
                                                ) : null}
                                            </div>

                                            <div className="flex items-center gap-3">
                                                {t.type === 'COVERAGE' ? (
                                                    <label className="flex items-center gap-2 text-sm font-black text-slate-800">
                                                        <Input
                                                            type="checkbox"
                                                            checked={entry.enabled}
                                                            disabled={mode !== 'edit'}
                                                            onChange={(e) => upsertBase(t.code, { enabled: e.target.checked })}
                                                        />
                                                        Enabled
                                                    </label>
                                                ) : (
                                                    <label className="flex items-center gap-2 text-sm font-black text-slate-800">
                                                        <Input
                                                            type="checkbox"
                                                            checked={entry.enabled}
                                                            disabled={mode !== 'edit'}
                                                            onChange={(e) => upsertOption(t.code, { enabledByDefault: e.target.checked })}
                                                        />
                                                        Included by default
                                                    </label>
                                                )}
                                            </div>
                                        </div>

                                        {t.ui?.help_text ? (
                                            <div className="mt-4 text-sm text-slate-600 font-semibold">{t.ui.help_text}</div>
                                        ) : null}

                                        {Array.isArray(t.ui?.form_fields) && t.ui.form_fields.length ? (
                                            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {t.ui.form_fields.map((f) => {
                                                    const val = effectiveValue(t, entry, f);
                                                    const isReq = Boolean(f.required) || required.includes(f.name);
                                                    const disabled = mode !== 'edit';

                                                    if (f.type === 'boolean') {
                                                        return (
                                                            <label key={f.name} className="flex items-center gap-2 text-sm font-black text-slate-800">
                                                                <Input
                                                                    type="checkbox"
                                                                    checked={Boolean(val)}
                                                                    disabled={disabled}
                                                                    onChange={(e) => setParam(t, f, e.target.checked)}
                                                                />
                                                                {f.label}{isReq ? <span className="text-rose-700">*</span> : null}
                                                            </label>
                                                        );
                                                    }

                                                    if (f.type === 'select' && Array.isArray(f.options)) {
                                                        return (
                                                            <div key={f.name}>
                                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                                                    {f.label}{isReq ? <span className="text-rose-700">*</span> : null}
                                                                </label>
                                                                <Select
                                                                    className="ui-select"
                                                                    value={String(val ?? '')}
                                                                    disabled={disabled}
                                                                    onChange={(e) => setParam(t, f, e.target.value)}
                                                                >
                                                                    <option value="">—</option>
                                                                    {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                                                                </Select>
                                                            </div>
                                                        );
                                                    }

                                                    if (f.type === 'multiselect') {
                                                        return (
                                                            <div key={f.name}>
                                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                                                    {f.label}{isReq ? <span className="text-rose-700">*</span> : null}
                                                                </label>
                                                                <Input
                                                                    className="ui-input"
                                                                    value={Array.isArray(val) ? val.join(', ') : String(val ?? '')}
                                                                    disabled={disabled}
                                                                    onChange={(e) => setParam(t, f, e.target.value.split(',').map((x) => x.trim()).filter(Boolean))}
                                                                    placeholder={Array.isArray(f.options) ? f.options.join(', ') : ''}
                                                                />
                                                            </div>
                                                        );
                                                    }

                                                    const isNumber = f.type === 'currency';
                                                    return (
                                                        <div key={f.name}>
                                                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                                                {f.label}{isReq ? <span className="text-rose-700">*</span> : null}
                                                            </label>
                                                            <Input
                                                                className="ui-input"
                                                                type={isNumber ? 'number' : 'text'}
                                                                value={val === undefined || val === null ? '' : String(val)}
                                                                disabled={disabled}
                                                                onChange={(e) => setParam(t, f, isNumber ? Number(e.target.value || 0) : e.target.value)}
                                                            />
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="mt-5 text-sm text-slate-500 font-semibold">No configurable parameters.</div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
