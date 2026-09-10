import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/src/shared/ui';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import { formatDateUI } from '@/src/shared/lib/format';
import type {
    Program,
    PricingStage,
    RatingMatrix,
    PersistedRatingModel,
} from '@/src/modules/programs/model/programs';

interface ProgramPricingProps {
    program: Program;
}

export const ProgramPricing: React.FC<ProgramPricingProps> = ({ program }) => {
    const [stages, setStages] = useState<PricingStage[]>([
        { id: 'stage-base', name: 'Base premium (Engine × Value)', kind: 'table_lookup', tableKey: 'baseMatrix', notes: 'Hidden Workings matrix' },
        { id: 'stage-age', name: 'Proposer age factor', kind: 'factor', tableKey: 'proposerAge' },
        { id: 'stage-vehage', name: 'Vehicle age factor', kind: 'factor', tableKey: 'vehicleAge' },
        { id: 'stage-lic', name: 'Licence period factor', kind: 'factor', tableKey: 'licencePeriod' },
        { id: 'stage-add25', name: 'Added drivers under 25', kind: 'factor', tableKey: 'addedDriversUnder25' },
        { id: 'stage-fees', name: 'Fees & charges', kind: 'fee', notes: 'MIF, stamp, policy fee' },
    ]);
    const [selectedStageId, setSelectedStageId] = useState<string>('stage-base');
    const dragStageId = useRef<string | null>(null);

    const [rating, setRating] = useState<RatingMatrix | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [modelMeta, setModelMeta] = useState<{ version: number; status: string; updatedAt: string } | null>(null);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'publishing'>('idle');

    const errorMessage = (error: unknown, fallback: string): string => {
        return error instanceof Error ? error.message : fallback;
    };

    const normalizeModel = (model: PersistedRatingModel): PersistedRatingModel => ({
        ...model,
        stages: Array.isArray(model.stages) ? model.stages : [],
    });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(null);
                setModelMeta(null);

                // Prefer persisted model (ACTIVE/DRAFT). If none exists, fallback to XLSX-derived matrix.
                // We catch 404s inside api.request if we are careful, but api.request generally throws or returns !success.
                // The endpoint logic in Programs.tsx tried to load model then matrix.
                const modelResp = await api.getProgramRatingModel(program.id);

                if (modelResp.success && modelResp.data) {
                    const m = normalizeModel(modelResp.data);
                    if (cancelled) return;
                    setStages(m.stages);
                    setRating(m.tables || null);
                    setModelMeta({ version: m.version, status: m.status, updatedAt: m.updatedAt });
                    return;
                }

                // Fallback to matrix
                const resp = await api.getProgramRatingMatrix(program.id);
                if (!resp.success || !resp.data) throw new Error(resp.error?.message || 'Failed to load rating matrix');
                if (cancelled) return;

                const base = resp.data;
                setRating({
                    ...base,
                    lloyds: base.lloyds || {
                        standardsRef: 'CRS_V5_2',
                        sourceDocUrl: 'https://assets.lloyds.com/assets/pdf-reporting-standards-lloyds-coverholder-reporting-standards-user-guide-v52/1/pdf-reporting-standards-lloyds-coverholder-reporting-standards-user-guide-V52.pdf',
                        mappings: [
                            { crCode: 'CR????', title: 'Country of registration', pvrKey: 'vehicle.country_of_registration', required: true, notes: 'Motor vehicle info' },
                            { crCode: 'CR????', title: 'Registration number', pvrKey: 'vehicle.registration_number', required: true, notes: 'Motor vehicle info' },
                            { crCode: 'CR????', title: 'Type of vehicle', pvrKey: 'vehicle.type', required: true },
                            { crCode: 'CR????', title: 'Period of cover (inception)', pvrKey: 'policy.inception_date', required: true },
                            { crCode: 'CR????', title: 'Period of cover (expiry)', pvrKey: 'policy.expiry_date', required: true },
                            {
                                crCode: 'CR????',
                                title: 'Cover type',
                                pvrKey: 'policy.cover_required',
                                required: true,
                                transform: 'map(Comprehensive=>Motor: Comprehensive, Third Party Liability=>Motor: 3rd Party)',
                                notes: 'See Appendix Two – Cover Type (Motor)'
                            },
                            { crCode: 'CR????', title: 'Deductible / excess', pvrKey: 'coverage.excess_required_eur', required: true, notes: 'Deductible / excess field' },
                        ],
                    },
                });
            } catch (e: unknown) {
                if (cancelled) return;
                setRating(null);
                setError(errorMessage(e, 'Failed to load rating matrix'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [program.id]);

    const handleSave = async () => {
        if (!rating) return;
        try {
            setSaveStatus('saving');
            const resp = await api.saveProgramRatingModel(program.id, { stages, tables: rating, source: rating.source });
            if (!resp.success || !resp.data) throw new Error(resp.error?.message || 'Failed to save');
            const m = normalizeModel(resp.data);
            setModelMeta({ version: m.version, status: m.status, updatedAt: m.updatedAt });
            setSaveStatus('saved');
            setTimeout(() => setSaveStatus('idle'), 1200);
        } catch (e: unknown) {
            setSaveStatus('idle');
            alert(errorMessage(e, 'Failed to save rating model'));
        }
    };

    const handlePublish = async () => {
        try {
            setSaveStatus('publishing');
            const resp = await api.publishProgramRatingModel(program.id);
            if (!resp.success || !resp.data) throw new Error(resp.error?.message || 'Failed to publish');
            const m = normalizeModel(resp.data);
            setModelMeta({ version: m.version, status: m.status, updatedAt: m.updatedAt });
            setSaveStatus('idle');
            alert('Version published to ACTIVE.');
        } catch (e: unknown) {
            setSaveStatus('idle');
            alert(errorMessage(e, 'Failed to publish'));
        }
    };

    const currentStage = stages.find((s) => s.id === selectedStageId) || stages[0];

    return (
        <div className="grid grid-cols-1 xl:grid-cols-[360px,minmax(0,1fr)] gap-8">
            {/* Left: stages (draggable) */}
            <div className="ui-card ui-card-pad space-y-6">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pricing stages</div>
                    <h2 className="text-xl font-black text-slate-900 mt-1">Rating pipeline</h2>
                    <div className="mt-1 text-sm text-slate-500 font-semibold">
                        Build stages, connect to tables, and drag to reorder.
                    </div>
                </div>

                <div className="space-y-3">
                    {stages.map((s) => (
                        <div
                            key={s.id}
                            draggable
                            onDragStart={() => { dragStageId.current = s.id; }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                                const fromId = dragStageId.current;
                                dragStageId.current = null;
                                if (!fromId || fromId === s.id) return;
                                setStages((prev) => {
                                    const fromIdx = prev.findIndex((x) => x.id === fromId);
                                    const toIdx = prev.findIndex((x) => x.id === s.id);
                                    if (fromIdx < 0 || toIdx < 0) return prev;
                                    const next = [...prev];
                                    const [moved] = next.splice(fromIdx, 1);
                                    next.splice(toIdx, 0, moved);
                                    return next;
                                });
                            }}
                            onClick={() => setSelectedStageId(s.id)}
                            className={`p-4 rounded-3xl border transition cursor-pointer select-none ${s.id === currentStage?.id ? 'bg-brand-primary/[0.06] border-brand-primary/20' : 'bg-white border-slate-200 hover:bg-slate-50'
                                }`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-sm font-black text-slate-900 truncate">{s.name}</div>
                                    <div className="mt-1 text-xs font-semibold text-slate-500">
                                        {s.kind === 'table_lookup' ? 'Table lookup' : s.kind === 'factor' ? 'Factor' : s.kind === 'fee' ? 'Fees' : 'Custom'}
                                        {s.tableKey ? ` • ${s.tableKey}` : ''}
                                    </div>
                                </div>
                                <div className="text-slate-300 text-xs font-black">⋮⋮</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Right: tables + editor */}
            <div className="space-y-6">
                <div className="ui-card ui-card-pad space-y-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Rating</div>
                            <h2 className="text-xl font-black text-slate-900 tracking-tight mt-1">Factor tables (editable)</h2>
                            <div className="mt-1 text-xs font-semibold text-slate-500">
                                {rating?.source ? <>Source: <span className="font-mono text-slate-700">{rating.source}</span></> : 'Source: —'}
                            </div>
                            <div className="mt-1 text-xs font-semibold text-slate-500">
                                {modelMeta ? (
                                    <>
                                        Model: <span className="font-black text-slate-700">v{modelMeta.version}</span> •{' '}
                                        <span className="font-black text-slate-700">{modelMeta.status}</span> • Updated {formatDateUI(modelMeta.updatedAt, { withTime: true })}
                                    </>
                                ) : (
                                    <>Model: <span className="font-black text-slate-700">not saved</span></>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button
                                variant="secondary"
                                size="lg"
                                onClick={handleSave}
                            >
                                {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Save'}
                            </Button>
                            <Button
                                size="lg"
                                onClick={handlePublish}
                            >
                                {saveStatus === 'publishing' ? 'Publishing…' : 'Publish to Live'}
                            </Button>
                        </div>
                    </div>

                    <div>
                        {!rating ? (
                            loading ? (
                                <div className="p-8 text-center bg-slate-50 rounded-3xl border border-slate-200">
                                    <div className="text-sm font-black text-slate-400">Loading rating tables...</div>
                                </div>
                            ) : (
                                <div className="p-8 text-center bg-slate-50 rounded-3xl border border-slate-200">
                                    <div className="text-sm font-black text-slate-400 text-rose-500">Failed to load rating tables. {error}</div>
                                </div>
                            )
                        ) : (
                            <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
                                {/* Base Matrix */}
                                <div className="p-5 rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Base Matrix</div>
                                    <div className="mt-2 text-sm font-black text-slate-900">Engine x Value</div>
                                    <div className="mt-4 overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr>
                                                    <th className="p-2 text-left bg-slate-50 border-b border-slate-200">Engine \ Value</th>
                                                    {rating.baseMatrix.x.slice(0, 5).map((val, i) => (
                                                        <th key={i} className="p-2 text-center bg-slate-50 border-b border-slate-200 w-16">&euro;{val}</th>
                                                    ))}
                                                    <th className="p-2 text-center bg-slate-50 border-b border-slate-200 text-slate-400 font-normal">...</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rating.baseMatrix.y.slice(0, 5).map((rowLabel, i) => (
                                                    <tr key={i}>
                                                        <td className="p-2 font-bold text-slate-700 bg-slate-50/50">{rowLabel}</td>
                                                        {rating.baseMatrix.values[i].slice(0, 5).map((v, j) => (
                                                            <td key={j} className="p-2 text-center border-b border-slate-100">&euro;{v}</td>
                                                        ))}
                                                        <td className="p-2 text-center text-slate-300">...</td>
                                                    </tr>
                                                ))}
                                                <tr>
                                                    <td colSpan={7} className="p-2 text-center text-slate-400 italic font-mono text-[10px]">
                                                        (Truncated view - {rating.baseMatrix.y.length} rows x {rating.baseMatrix.x.length} cols)
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Factor Tables Preview */}
                                <div className="space-y-6">
                                    {Object.entries(rating.factors).map(([k, factors]) => (
                                        <div key={k} className="p-5 rounded-3xl border border-slate-200 bg-white">
                                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Factor</div>
                                            <div className="mt-2 text-sm font-black text-slate-900 capitalize">{k.replace(/([A-Z])/g, ' $1').trim()}</div>
                                            <div className="mt-3 space-y-1">
                                                {factors.slice(0, 4).map((f, i) => (
                                                    <div key={i} className="flex justify-between text-xs py-1 border-b border-slate-50 last:border-0">
                                                        <span className="font-semibold text-slate-600">{f.label}</span>
                                                        <span className="font-mono text-slate-800 bg-slate-100 px-1 rounded">{f.factor}</span>
                                                    </div>
                                                ))}
                                                {factors.length > 4 && (
                                                    <div className="text-[10px] text-slate-400 mt-1 italic">+{factors.length - 4} more rows</div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
