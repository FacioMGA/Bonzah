import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/src/shared/ui';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import type { Program, ProgramUwConfig } from '@/src/modules/programs/model/programs';
import { ProductRegistry, SchemaDrivenForm, type ProductManifest } from '@/src/shared/lib/products';

interface ProgramUnderwritingProps {
    program: Program;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

function getProgramProductType(program: Program): string {
    const meta = isRecord(program.metadata) ? program.metadata : {};
    return String(program.productType || meta.productType || '').trim().toUpperCase();
}

function defaultUwConfigFromManifest(manifest: ProductManifest | null): ProgramUwConfig {
    if (!manifest) return {};
    const out: Record<string, unknown> = {};
    for (const group of manifest.uwConfigSchema.groups) {
        for (const field of group.fields) {
            if (field.type === 'boolean') out[field.path] = false;
            else out[field.path] = null;
        }
    }
    return out;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
    const parts = String(path || '').split('.').filter(Boolean);
    if (parts.length === 0) return target;
    const root: Record<string, unknown> = { ...target };
    let cursor: Record<string, unknown> = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
        const key = parts[i];
        const next = isRecord(cursor[key]) ? { ...(cursor[key] as Record<string, unknown>) } : {};
        cursor[key] = next;
        cursor = next;
    }
    cursor[parts[parts.length - 1]] = value;
    return root;
}

export const ProgramUnderwriting: React.FC<ProgramUnderwritingProps> = ({ program }) => {
    const [uwConfig, setUwConfig] = useState<ProgramUwConfig>({});
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [savedAt, setSavedAt] = useState<string>('');

    const productType = useMemo(() => getProgramProductType(program), [program]);
    const manifest = useMemo(() => ProductRegistry.get(productType), [productType]);
    const defaultUwConfig = useMemo(() => defaultUwConfigFromManifest(manifest), [manifest]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const resp = await api.getProgramUwConfig(program.id);
                if (cancelled) return;
                if (!resp.success) throw new Error(resp.error?.message || 'Failed to load underwriting config');
                const incoming = isRecord(resp.data) ? resp.data : {};
                setUwConfig({ ...defaultUwConfig, ...incoming });
            } catch (e: unknown) {
                if (cancelled) return;
                setUwConfig(defaultUwConfig);
                setError(errorMessage(e, 'Failed to load underwriting config'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [defaultUwConfig, program.id]);

    const handleSave = async () => {
        try {
            setSaving(true);
            const resp = await api.saveProgramUwConfig(program.id, uwConfig);
            if (!resp.success) throw new Error(resp.error?.message || 'Failed to save underwriting config');
            setError(null);
            setSavedAt(new Date().toISOString());
        } catch (e: unknown) {
            setError(errorMessage(e, 'Failed to save underwriting config'));
        } finally {
            setSaving(false);
        }
    };

    if (!productType || !manifest) {
        return (
            <div className="ui-card ui-card-pad">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Underwriting rules</div>
                <div className="mt-2 text-xl font-black text-slate-900">Manifest not available</div>
                <div className="mt-3 text-sm text-slate-600 font-semibold">
                    This program does not expose a valid product manifest. Set `program.productType` or `program.metadata.productType`
                    to a registered product before editing underwriting configuration.
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="ui-card ui-card-pad">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Underwriting rules</div>
                        <div className="mt-2 text-xl font-black text-slate-900">{manifest.displayName} underwriting configuration</div>
                        <div className="mt-2 text-sm text-slate-600 font-semibold">
                            Shared BO renders this form from the product manifest&apos;s <span className="font-black text-slate-800">uwConfigSchema</span>.
                            Product-specific business logic does not live in this UI surface.
                        </div>
                        {error && (
                            <div className="mt-3 text-sm font-bold text-rose-700">Error: {error}</div>
                        )}
                        {!error && savedAt && (
                            <div className="mt-3 text-xs font-semibold text-emerald-700">
                                Saved at {new Date(savedAt).toLocaleTimeString()}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="secondary"
                            onClick={() => setUwConfig(defaultUwConfig)}
                            disabled={loading || saving}
                        >
                            Reset to manifest defaults
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={loading || saving}
                        >
                            {saving ? 'Saving…' : 'Save'}
                        </Button>
                    </div>
                </div>
            </div>

            <div className="ui-card ui-card-pad">
                <SchemaDrivenForm
                    schema={manifest.uwConfigSchema}
                    value={uwConfig}
                    onChange={(path, value) => setUwConfig((prev: ProgramUwConfig) => setPath(prev, path, value))}
                    readOnly={loading || saving}
                />
            </div>
        </div>
    );
};
