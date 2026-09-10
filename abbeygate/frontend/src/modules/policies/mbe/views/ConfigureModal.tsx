import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { mbeApi } from '@/src/shared/api/mbe';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';

import { logger } from '@/src/shared/lib/logger';

type ParameterValue = string | number | boolean | null | undefined;
type ParamsRecord = Record<string, ParameterValue>;
type TargetOption = { id: string; label: string };
type PreviewState = {
    premiumDelta: number;
    scheduleText?: string;
    validation: {
        status: 'VALID' | 'WARN' | 'ERROR';
        messages?: string[];
    };
};

function toParamsRecord(value: unknown): ParamsRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const input = value as Record<string, unknown>;
    const out: ParamsRecord = {};
    for (const [k, v] of Object.entries(input)) {
        if (v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v)) {
            out[k] = v as ParameterValue;
        }
    }
    return out;
}

function normalizePreview(input: unknown): PreviewState {
    const data = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const validationRaw = data.validation && typeof data.validation === 'object'
        ? (data.validation as Record<string, unknown>)
        : {};
    const statusRaw = validationRaw.status;
    const blocking = validationRaw.blocking === true || data.success === false;
    const status =
        statusRaw === 'ERROR' || statusRaw === 'WARN'
            ? statusRaw
            : blocking
                ? 'ERROR'
                : 'VALID';
    const messages = Array.isArray(validationRaw.messages)
        ? validationRaw.messages.map((m) => String(m))
        : [];
    return {
        premiumDelta: Number(data.premiumDelta || 0),
        scheduleText: data.scheduleText ? String(data.scheduleText) : undefined,
        validation: {
            status,
            messages,
        },
    };
}

export interface ConfigureTemplate {
    code: string;
    title: string;
    summary?: string;
    scope: string;
    default_params?: unknown;
    legal_text?: string;
    document_template?: string;
    disallowed_with?: string[];
    ui: {
        help_text?: string;
        form_fields: Array<{
            name: string;
            label: string;
            type: string;
            required: boolean;
            options?: string[];
        }>;
    };
}

interface ConfigureModalProps {
    template: ConfigureTemplate;
    isOpen: boolean;
    onClose: () => void;
    onApply: (params: ParamsRecord) => Promise<void>;
    onRemove?: () => Promise<void>;
    initialParams?: unknown;
    isActive?: boolean;
    policyId: string;
    policySnapshot: unknown;
    targetOptions: TargetOption[];
    /**
     * UI mode:
     * - overlay: legacy modal w/ dimmed backdrop
     * - embedded: in-page configuration "screen" (no dimmed backdrop)
     */
    mode?: 'overlay' | 'embedded';
}

export const ConfigureModal: React.FC<ConfigureModalProps> = ({
    template, isOpen, onClose, onApply, onRemove, initialParams, isActive = false, policyId, policySnapshot: _policySnapshot, targetOptions, mode = 'overlay'
}) => {
    const [params, setParams] = useState<ParamsRecord>({});
    const [preview, setPreview] = useState<PreviewState | null>(null);
    const [loading, setLoading] = useState(false);
    const [applying, setApplying] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // A template scope is "risk-object-scoped" if it targets an individual
    // insured object (vehicle, property, traveler). Today only MOTOR uses
    // `VEHICLE`; `RISK_OBJECT` is the forward-looking generic alias. We do
    // NOT treat `COVER` as object-scoped — that is a per-cover toggle, not
    // a target selector.
    const isRiskObjectScope = template.scope === 'VEHICLE' || template.scope === 'RISK_OBJECT';

    // Initialize defaults
    useEffect(() => {
        if (isOpen && template) {
            const defaults: ParamsRecord = { ...toParamsRecord(template.default_params), ...toParamsRecord(initialParams) };
            setParams(defaults);
            setPreview(null);
            setError(null);
        }
    }, [initialParams, isOpen, template, targetOptions]);

    // Live Preview Effect
    useEffect(() => {
        if (!isOpen || !template) return;

        const fetchPreview = async () => {
            setLoading(true);
            try {
                const selectedTargetId = params.targetId || params.target_vehicle_id || params.target_risk_object_id || params.target_object_id;
                // If risk-object-scoped and no target selected yet, skip preview.
                if (isRiskObjectScope && !selectedTargetId && targetOptions.length > 0) {
                    setLoading(false);
                    return;
                }

                const targetId = isRiskObjectScope ? (selectedTargetId ? String(selectedTargetId) : undefined) : undefined;
                const res = await mbeApi.preview({ policyId, endorsementCode: template.code, params, targetId });
                const nextPreview = normalizePreview(res);
                setPreview(nextPreview);
            } catch (err) {
                logger.error("Preview failed", err);
            } finally {
                setLoading(false);
            }
        };

        const debounce = setTimeout(fetchPreview, 500);
        return () => clearTimeout(debounce);
    }, [params, isOpen, policyId, template, targetOptions.length, isRiskObjectScope]);

    const handleChange = (field: string, value: ParameterValue) => {
        setParams((prev) => ({ ...prev, [field]: value }));
    };

    const handleApply = async () => {
        setApplying(true);
        setError(null);
        try {
            await onApply(params);
            onClose();
        } catch (err: unknown) {
            logger.error(err);
            setError(err instanceof Error ? err.message : "Failed to apply endorsement");
        } finally {
            setApplying(false);
        }
    };

    const handleRemove = async () => {
        if (!onRemove) return;
        setRemoving(true);
        setError(null);
        try {
            await onRemove();
            onClose();
        } catch (err: unknown) {
            logger.error(err);
            setError(err instanceof Error ? err.message : 'Failed to remove endorsement');
        } finally {
            setRemoving(false);
        }
    };

    if (!isOpen) return null;

    const shell =
        mode === 'overlay'
            ? 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200'
            : 'w-full';

    const card =
        mode === 'overlay'
            ? 'bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-modal animate-in zoom-in-95 slide-in-from-bottom-2 duration-200'
            : 'bg-white/70 backdrop-blur-sm border border-slate-200/60 rounded-3xl shadow-[0_20px_70px_rgba(15,23,42,0.10)] w-full max-w-6xl mx-auto overflow-hidden flex flex-col min-h-[72vh] animate-in fade-in slide-in-from-right-4 duration-300';

    const content = (
        <div className={shell}>
            <div className={card}>
                {/* Header */}
                <div className={`px-8 py-5 border-b border-gray-100 flex justify-between items-center ${mode === 'overlay' ? 'bg-gray-50/50' : 'bg-white/40'}`}>
                    <div className="flex items-center gap-4 min-w-0">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-3">
                                <code className="text-[10px] font-black text-slate-500 bg-slate-100/80 px-2 py-1 rounded-2xl border border-slate-200/60 tracking-widest uppercase">
                                    {template.code}
                                </code>
                                <h3 className="text-xl font-black text-slate-900 tracking-tight truncate">
                                    {template.title}
                                </h3>
                            </div>
                            {template.summary && (
                                <div className="mt-1 text-sm font-semibold text-slate-500 truncate">
                                    {template.summary}
                                </div>
                            )}
                        </div>
                    </div>
                    <Button
                        type="button"
                        onClick={onClose}
                        variant="ghost"
                        size="sm"
                        className="text-slate-400 hover:text-slate-700 transition-colors"
                        aria-label="Close"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </Button>
                </div>

                {/* Body - Split Layout */}
                <div className={`flex-1 ${mode === 'overlay' ? 'overflow-y-auto max-h-modal' : 'overflow-y-auto'} grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-gray-100`}>

                    {/* Left: Configuration (3 cols) */}
                    <div className="p-8 lg:col-span-3 space-y-8">
                        <div>
                            <h4 className="text-xs font-black uppercase tracking-widest text-brand-primary mb-4 flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                                Configuration
                            </h4>
                            <div className="space-y-5">
                                {template.ui.form_fields.length === 0 && (
                                    <div className="text-slate-400 italic text-sm">No parameters required for this endorsement.</div>
                                )}
                                {template.ui.form_fields.map(field => (
                                    <div key={field.name}>
                                        <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">
                                            {field.label} {field.required && <span className="text-red-500">*</span>}
                                        </label>
                                        {field.type === 'vehicle_select' || field.type === 'risk_object_select' ? (
                                            <Select
                                                className="w-full border border-gray-200 bg-gray-50/50 rounded-lg px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all"
                                                value={String(params[field.name] ?? '')}
                                                onChange={e => handleChange(field.name, e.target.value)}
                                            >
                                                <option value="">Select item...</option>
                                                {targetOptions.map(v => (
                                                    <option key={String(v.id)} value={String(v.id)}>
                                                        {v.label}
                                                    </option>
                                                ))}
                                            </Select>
                                        ) : field.type === 'boolean' ? (
                                            <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg bg-gray-50/30">
                                                <Input
                                                    type="checkbox"
                                                    className="h-5 w-5 rounded border-gray-300 text-brand-primary focus:ring-brand-primary cursor-pointer"
                                                    checked={!!params[field.name]}
                                                    onChange={e => handleChange(field.name, e.target.checked)}
                                                />
                                                <span className="text-sm font-medium text-gray-700">Enable</span>
                                            </div>
                                        ) : field.type === 'select' ? (
                                            <Select
                                                className="w-full border border-gray-200 bg-gray-50/50 rounded-lg px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all"
                                                value={String(params[field.name] ?? '')}
                                                onChange={e => handleChange(field.name, e.target.value)}
                                            >
                                                {(field.options || []).map(opt => (
                                                    <option key={opt} value={opt}>{opt}</option>
                                                ))}
                                            </Select>
                                        ) : field.type === 'date' ? (
                                            <Input
                                                type="date"
                                                className="w-full border border-gray-200 bg-gray-50/50 rounded-lg px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all"
                                                value={String(params[field.name] ?? '')}
                                                onValueChange={(next) => handleChange(field.name, next)}
                                            />
                                        ) : (
                                            <Input
                                                type={field.type === 'currency' ? 'number' : 'text'}
                                                className="w-full border border-gray-200 bg-gray-50/50 rounded-lg px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all"
                                                value={(() => {
                                                    const raw = params[field.name];
                                                    return typeof raw === 'number' ? raw : String(raw ?? '');
                                                })()}
                                                onChange={e => handleChange(field.name, field.type === 'currency' ? parseFloat(e.target.value) : e.target.value)}
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Preview Card */}
                        <div className="bg-slate-900 rounded-xl p-5 text-white shadow-lg relative min-h-panel flex flex-col justify-center overflow-hidden">
                            <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">Impact Analysis</h5>

                            {/* Loading Overlay */}
                            {loading && (
                                <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-[1px] flex items-center justify-center z-20 transition-all">
                                    <div className="flex items-center gap-3 text-slate-300">
                                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                        <span className="text-sm font-medium">Updating...</span>
                                    </div>
                                </div>
                            )}

                            {/* Content */}
                            <div className={`transition-opacity duration-200 ${loading ? 'opacity-40' : 'opacity-100'}`}>
                                {preview ? (
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-baseline border-b border-slate-700 pb-4">
                                            <span className="text-sm text-slate-400">Premium Adjustment</span>
                                            <span className="text-2xl font-bold tracking-tight">
                                                {preview.premiumDelta >= 0 ? '+' : ''}€{preview.premiumDelta.toFixed(2)}
                                            </span>
                                        </div>

                                        <div className={`text-xs px-3 py-2 rounded font-bold uppercase tracking-wide inline-flex items-center gap-2 ${preview.validation.status === 'VALID' ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                                            <div className={`w-2 h-2 rounded-full ${preview.validation.status === 'VALID' ? "bg-emerald-400" : "bg-amber-400"}`} />
                                            {preview.validation.status === 'VALID' ? "Valid Configuration" : "Specific Setup Required"}
                                        </div>

                                        {preview.validation.status !== 'VALID' && Array.isArray(preview.validation.messages) && preview.validation.messages.length > 0 && (
                                            <div className="text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded p-3 space-y-1">
                                                {preview.validation.messages.slice(0, 5).map((m: string, idx: number) => (
                                                    <div key={idx} className="leading-relaxed">
                                                        - {m}
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {preview.scheduleText && (
                                            <div className="text-xs text-slate-400 leading-relaxed font-mono bg-black/30 p-3 rounded">
                                                "{preview.scheduleText}"
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <span className="text-slate-500 italic text-sm">Adjust parameters to see impact.</span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right: Details (2 cols) */}
                    <div className="p-8 lg:col-span-2 bg-slate-50 border-l border-gray-100 flex flex-col h-full">
                        <h4 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-6 flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            About this Cover
                        </h4>

                        <div className="prose prose-sm prose-slate max-w-none">
                            <h5 className="text-sm font-bold text-slate-900 mb-2">Description</h5>
                            <p className="text-sm text-slate-600 leading-relaxed mb-6">
                                {template.summary || template.ui.help_text || "No summary available."}
                            </p>

                            <h5 className="text-sm font-bold text-slate-900 mb-2">Legal Wording</h5>
                            <div className="text-[11px] leading-relaxed text-slate-500 bg-white border border-gray-200 rounded p-3 h-48 overflow-y-auto font-mono">
                                {template.legal_text || "Standard wording applies as per policy schedule."}
                            </div>
                        </div>

                        <div className="mt-auto pt-6 text-center">
                            {template.document_template && (
                                <span className="text-[10px] text-slate-400 font-mono">Template: {template.document_template}</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className={`px-8 py-5 flex items-center justify-between border-t border-gray-100 ${mode === 'overlay' ? 'bg-white' : 'bg-white/50 backdrop-blur-sm'} ${mode === 'embedded' ? 'sticky bottom-0' : ''}`}>
                    <div className="text-sm font-medium text-red-600">
                        {error && <span>{error}</span>}
                    </div>
                    <div className="flex gap-3">
                        <Button
                            onClick={onClose}
                            variant="ghost"
                            size="md"
                            className="px-5 py-2.5 text-sm font-bold text-slate-600 hover:text-slate-800 transition-colors"
                        >
                            Cancel
                        </Button>
                        {isActive && onRemove && (
                            <Button
                                onClick={handleRemove}
                                disabled={applying || removing}
                                variant="ghost"
                                size="md"
                                className="px-5 py-2.5 text-sm font-bold text-red-600 hover:text-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {removing ? 'Removing...' : 'Remove'}
                            </Button>
                        )}
                        <Button
                            onClick={handleApply}
                            disabled={loading || applying || removing || Boolean(preview && preview.validation.status === 'ERROR')}
                            variant="primary"
                            size="md"
                            className="px-6 py-2.5 text-sm font-bold text-white bg-brand-primary rounded-lg shadow-lg hover:bg-brand-primary/90 hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
                        >
                            {applying ? 'Applying Changes...' : 'Save & Add Coverage'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );

    if (mode === 'overlay' && typeof document !== 'undefined') {
        return createPortal(content, document.body);
    }

    return content;
};
