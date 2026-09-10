import { InsuranceConfigurationPanel } from '@/src/modules/insuranceConfiguration';
import { hasPermission } from '@/src/modules/auth/session';
import type { AppUser } from '@/src/shared/types/session';
import React, { useEffect, useState } from 'react';
import { Button, Checkbox, Input, Select } from '@/src/shared/ui';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import { formatDateUI } from '@/src/shared/lib/format';
import type { JsonObject } from '@/src/modules/programs/components/StructuredJsonEditor';
import { RatingModelEditor } from '@/src/modules/programs/configuration/RatingModelEditor';
import { ProgrammeDefinitionComponentEditor, type ProgrammeDefinitionEditorControl } from '@/src/modules/programs/configuration/ProgrammeDefinitionComponentEditor';
import type { Program, PersistedRatingModel, PricingStage } from '@/src/modules/programs/model/programs';

interface ProgramPricingProps { program: Program; user?: AppUser | null; onDirtyChange?: (dirty: boolean) => void; }

type PublishAuthority = { id: string; label: string; };
type ProgramBinderAuthorityResponse = { id: string; productCode: string; status: string; };
type ProgramBinderResponse = {
  binderId: string;
  status: string;
  binder: {
    agreementNumber?: string | null;
    umr?: string | null;
    coverholderName?: string | null;
    productAuthorities: ProgramBinderAuthorityResponse[];
  };
};
type DefinitionComponentKey = 'underwriting' | 'coverage' | 'questionnaire' | 'workflow' | 'channels' | 'documents';

type ProgrammeDefinitionEditorDescriptor = {
  schemaVersion: 1;
  productType: string;
  pricingModes: Array<'AUTOMATED' | 'MANUAL'>;
  ratingPipeline?: Array<{ operator: string; label: string }>;
  components: Array<{ key: DefinitionComponentKey; label: string; description: string; control: ProgrammeDefinitionEditorControl }>;
};

type DefinitionDraft = {
  pricingMode: '' | 'AUTOMATED' | 'MANUAL';
  programRatingModelId: string;
  components: Record<DefinitionComponentKey, JsonObject>;
  source: string;
  notes: string;
};

type PersistedDefinition = {
  id: string;
  version: number;
  status: string;
  updatedAt: string;
  pricingMode: 'AUTOMATED' | 'MANUAL';
  programRatingModelId?: string | null;
  underwriting: JsonObject;
  coverage: JsonObject;
  questionnaire: JsonObject;
  workflow: JsonObject;
  channels: JsonObject;
  documents: JsonObject;
  source?: string;
  notes?: string;
};

const componentKeys: DefinitionComponentKey[] = ['underwriting', 'coverage', 'questionnaire', 'workflow', 'channels', 'documents'];

function emptyDefinitionDraft(): DefinitionDraft {
  return {
    pricingMode: '',
    programRatingModelId: '',
    components: Object.fromEntries(componentKeys.map((key) => [key, {}])) as Record<DefinitionComponentKey, JsonObject>,
    source: '',
    notes: '',
  };
}

function asRecord(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as JsonObject;
}

function asStages(value: unknown): PricingStage[] {
  if (!Array.isArray(value) || value.some((stage) => !stage || typeof stage !== 'object' || Array.isArray(stage) || typeof (stage as { id?: unknown }).id !== 'string' || typeof (stage as { operator?: unknown }).operator !== 'string')) {
    throw new Error('Rating-model stages must contain stable id and operator values.');
  }
  return value as PricingStage[];
}

function definitionFromPersisted(value: PersistedDefinition): DefinitionDraft {
  return {
    pricingMode: value.pricingMode,
    programRatingModelId: value.programRatingModelId ?? '',
    components: {
      underwriting: value.underwriting,
      coverage: value.coverage,
      questionnaire: value.questionnaire,
      workflow: value.workflow,
      channels: value.channels,
      documents: value.documents,
    },
    source: value.source ?? '',
    notes: value.notes ?? '',
  };
}

function definitionPayload(value: DefinitionDraft) {
  if (value.pricingMode !== 'AUTOMATED' && value.pricingMode !== 'MANUAL') throw new Error('Choose whether this programme is automated or manual.');
  return {
    pricingMode: value.pricingMode,
    ...(value.pricingMode === 'AUTOMATED' ? { programRatingModelId: value.programRatingModelId.trim() || null } : {}),
    underwriting: value.components.underwriting,
    coverage: value.components.coverage,
    questionnaire: value.components.questionnaire,
    workflow: value.components.workflow,
    channels: value.components.channels,
    documents: value.components.documents,
    ...(value.source.trim() ? { source: value.source.trim() } : {}),
    ...(value.notes.trim() ? { notes: value.notes.trim() } : {}),
  };
}

export const ProgramPricing: React.FC<ProgramPricingProps> = ({ program, user, onDirtyChange }) => {
  const canEdit = hasPermission(user, 'configuration.draft');
  const canPublish = hasPermission(user, 'configuration.publish_sandbox');
  const [reviewedHash, setReviewedHash] = useState('');
  const [configurationTab, setConfigurationTab] = useState<'runtime' | 'insurance'>('runtime');
  const [sourceDirty, setSourceDirty] = useState(false);
  const [definitionBaseline, setDefinitionBaseline] = useState('');
  const [definitionReload, setDefinitionReload] = useState(0);
  const [modelBaseline, setModelBaseline] = useState('');
  const [stages, setStages] = useState<PricingStage[]>([]);
  const [tables, setTables] = useState<JsonObject>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelMeta, setModelMeta] = useState<{ id: string; version: number; status: string; updatedAt: string } | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'publishing'>('idle');
  const [publishAuthorities, setPublishAuthorities] = useState<PublishAuthority[]>([]);
  const [selectedAuthorityIds, setSelectedAuthorityIds] = useState<string[]>([]);
  const [editorDescriptor, setEditorDescriptor] = useState<ProgrammeDefinitionEditorDescriptor | null>(null);
  const [definition, setDefinition] = useState<DefinitionDraft>(emptyDefinitionDraft);
  const [definitionMeta, setDefinitionMeta] = useState<{ id: string; version: number; status: string; updatedAt: string } | null>(null);
  const [definitionStatus, setDefinitionStatus] = useState<'idle' | 'saving' | 'saved' | 'publishing'>('idle');
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const errorMessage = (cause: unknown, fallback: string): string => cause instanceof Error ? cause.message : fallback;
  const normalizeModel = (model: PersistedRatingModel): PersistedRatingModel => ({ ...model, stages: asStages(model.stages) });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true); setError(null); setModelMeta(null);
        const response = await api.getProgramRatingModel(program.id);
        if (!response.success || !response.data) {
          if (!cancelled) { setStages([]); setTables({}); }
          return;
        }
        const model = normalizeModel(response.data);
        if (cancelled) return;
        setModelBaseline(JSON.stringify({stages:model.stages,tables:asRecord(model.tables || {}, 'Rating-model tables')}));
        setStages(model.stages);
        setTables(asRecord(model.tables || {}, 'Rating-model tables'));
        setModelMeta({ id: model.id, version: model.version, status: model.status, updatedAt: model.updatedAt });
      } catch (cause: unknown) {
        if (!cancelled) setError(errorMessage(cause, 'Failed to load rating model'));
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [program.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setDefinitionError(null); setDefinitionMeta(null); setReviewedHash('');
        const [descriptorResponse, definitionResponse, sourceResponse] = await Promise.all([
          api.request<ProgrammeDefinitionEditorDescriptor>(`programs/${program.id}/definition-editor`),
          api.request<PersistedDefinition[]>(`programs/${program.id}/definitions`),
          api.request<{definitionId:string;definitionHash:string}>(`insurance-configuration/programs/${program.id}`),
        ]);
        if (!descriptorResponse.success || !descriptorResponse.data) throw new Error(descriptorResponse.error?.message || 'This product has no programme-settings editor descriptor.');
        if (descriptorResponse.data.productType !== String(program.productType || '').toUpperCase()) throw new Error('The programme editor descriptor does not match this programme product.');
        if (!cancelled) setEditorDescriptor(descriptorResponse.data);
        if (!definitionResponse.success || !definitionResponse.data || definitionResponse.data.length === 0) {
          if (!cancelled) { setDefinition(emptyDefinitionDraft()); setDefinitionBaseline(JSON.stringify(emptyDefinitionDraft())); }
          return;
        }
        if (!cancelled) {
          const latest = definitionResponse.data[0];
          if (!sourceResponse.success || sourceResponse.data?.definitionId !== latest.id) throw new Error('The reviewed definition changed while loading. Reload before publishing.');
          setReviewedHash(sourceResponse.data.definitionHash);
          setDefinition(definitionFromPersisted(latest));
          setDefinitionBaseline(JSON.stringify(definitionFromPersisted(latest)));
          setDefinitionMeta({ id: latest.id, version: latest.version, status: latest.status, updatedAt: latest.updatedAt });
        }
      } catch (cause: unknown) {
        if (!cancelled) setDefinitionError(errorMessage(cause, 'Failed to load programme settings'));
      }
    })();
    return () => { cancelled = true; };
  }, [program.id, program.productType, definitionReload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await api.request<ProgramBinderResponse[]>(`programs/${program.id}/binders`);
        if (!response?.success || cancelled) return;
        const links = response.data || [];
        const authorities = links.flatMap((link) => {
          if (String(link.status || '').toUpperCase() !== 'ACTIVE') return [];
          const binder = link.binder;
          const binderName = String(binder.agreementNumber || binder.umr || binder.coverholderName || link.binderId || 'Binder');
          const productAuthorities = binder.productAuthorities || [];
          return productAuthorities
            .filter((authority) => String(authority.status || '').toUpperCase() === 'ACTIVE')
            .map((authority) => ({ id: String(authority.id), label: `${binderName} • ${String(authority.productCode || program.productType || 'Product')}` }));
        });
        setPublishAuthorities(authorities);
      } catch { if (!cancelled) setPublishAuthorities([]); }
    })();
    return () => { cancelled = true; };
  }, [program.id, program.productType]);

  const handleSave = async () => {
    try {
      setSaveStatus('saving');
      const response = await api.saveProgramRatingModel(program.id, { stages: asStages(stages), tables: asRecord(tables, 'Rating-model tables') });
      if (!response.success || !response.data) throw new Error(response.error?.message || 'Failed to save rating model');
      const model = normalizeModel(response.data);
      setModelBaseline(JSON.stringify({stages:model.stages,tables:asRecord(model.tables || {}, 'Rating-model tables')}));
      setStages(model.stages);setTables(asRecord(model.tables || {}, 'Rating-model tables'));
      setModelMeta({ id: model.id, version: model.version, status: model.status, updatedAt: model.updatedAt });
      setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 1200);
    } catch (cause: unknown) { setSaveStatus('idle'); alert(errorMessage(cause, 'Failed to save rating model')); }
  };

  const handlePublish = async () => {
    try {
      if (modelDirty) throw new Error('Save the visible rating changes before publishing.');
      setSaveStatus('publishing');
      if (selectedAuthorityIds.length === 0) throw new Error('Select at least one active binder product authority before publishing.');
      const response = await api.publishProgramRatingModel(program.id, selectedAuthorityIds);
      if (!response.success || !response.data) throw new Error(response.error?.message || 'Failed to publish rating model');
      const model = normalizeModel(response.data);
      setModelBaseline(JSON.stringify({stages:model.stages,tables:asRecord(model.tables || {}, 'Rating-model tables')}));
      setStages(model.stages);setTables(asRecord(model.tables || {}, 'Rating-model tables'));
      setModelMeta({ id: model.id, version: model.version, status: model.status, updatedAt: model.updatedAt });
      setSaveStatus('idle');
      alert('Rating model published and mapped. Publish the programme definition separately to make every component live.');
    } catch (cause: unknown) { setSaveStatus('idle'); alert(errorMessage(cause, 'Failed to publish rating model')); }
  };

  const handleSaveDefinition = async () => {
    try {
      setDefinitionStatus('saving');
      const response = await api.request<PersistedDefinition>(`programs/${program.id}/definitions/draft`, { method: 'PUT', body: JSON.stringify(definitionPayload(definition)) });
      if (!response.success || !response.data) throw new Error(response.error?.message || 'Failed to save programme definition');
      const saved = response.data;
      setDefinition(definitionFromPersisted(saved));
      setDefinitionBaseline(JSON.stringify(definitionFromPersisted(saved)));
      setDefinitionMeta({ id: saved.id, version: saved.version, status: saved.status, updatedAt: saved.updatedAt });
      setDefinitionReload((value) => value + 1);
      setDefinitionStatus('saved'); setTimeout(() => setDefinitionStatus('idle'), 1200);
    } catch (cause: unknown) { setDefinitionStatus('idle'); alert(errorMessage(cause, 'Failed to save programme definition')); }
  };

  const handlePublishDefinition = async () => {
    try {
      setDefinitionStatus('publishing');
      if (!canPublish || !reviewedHash) throw new Error('You need sandbox publication permission and an exact reviewed definition.');
      if (definitionDirty) throw new Error('Save the visible programme changes before publishing.');
      if (!definitionMeta || definitionMeta.status !== 'DRAFT') throw new Error('Save a valid programme definition draft before publishing.');
      if (selectedAuthorityIds.length === 0) throw new Error('Select at least one active binder product authority before publishing.');
      const response = await api.request<{definitionId:string;definitionHash:string}>(`insurance-configuration/programs/${program.id}/publish`, { method: 'POST', body: JSON.stringify({ definitionId: definitionMeta.id, expectedDefinitionHash: reviewedHash, binderProductAuthorityIds: selectedAuthorityIds }) });
      if (!response.success || !response.data) throw new Error(response.error?.message || 'Failed to publish programme definition');
      setDefinitionReload((value) => value + 1);
      setDefinitionStatus('idle');
      alert('Programme definition published and mapped. Quotes, repricing, endorsements, issuance and documents now use this version for the selected authorities.');
    } catch (cause: unknown) { setDefinitionStatus('idle'); alert(errorMessage(cause, 'Failed to publish programme definition')); }
  };

  const definitionDirty = Boolean(definitionBaseline && JSON.stringify(definition) !== definitionBaseline);
  const modelDirty = Boolean(modelBaseline && JSON.stringify({stages,tables}) !== modelBaseline);
  const editorDirty = sourceDirty || definitionDirty || modelDirty;
  useEffect(()=>{onDirtyChange?.(editorDirty);},[editorDirty,onDirtyChange]);
  const switchConfiguration = (next: 'runtime' | 'insurance') => {
    if (next === configurationTab) return;
    if (editorDirty && !window.confirm('Discard unsaved programme definition changes before changing editor?')) return;
    setSourceDirty(false);
    if(modelDirty){const saved=JSON.parse(modelBaseline) as {stages:PricingStage[];tables:JsonObject};setStages(saved.stages);setTables(saved.tables);}
    setDefinitionReload(value => value + 1); setConfigurationTab(next);
  };
  useEffect(() => {
    if (!editorDirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: MouseEvent) => {const target=event.target;const anchor=target instanceof Element ? target.closest('a[href]') : null;if(anchor && !window.confirm('Discard unsaved programme changes before leaving?')){event.preventDefault();event.stopPropagation();}};
    window.addEventListener('beforeunload', leave);document.addEventListener('click',navigate,true);
    return () => {window.removeEventListener('beforeunload', leave);document.removeEventListener('click',navigate,true);};
  }, [editorDirty]);
  return <div className="space-y-6">
    <nav aria-label="Programme configuration editor" className="flex flex-wrap gap-3">
      <Button type="button" variant={configurationTab === 'runtime' ? 'primary' : 'secondary'} onClick={() => switchConfiguration('runtime')}>Runtime definition and rates</Button>
      <Button type="button" variant={configurationTab === 'insurance' ? 'primary' : 'secondary'} onClick={() => switchConfiguration('insurance')}>Insurance and workflow</Button>
    </nav>
    {configurationTab === 'insurance' ? <InsuranceConfigurationPanel key={program.id} programId={program.id} canEdit={canEdit} onDirtyChange={setSourceDirty} onSaved={() => { setSourceDirty(false); setDefinitionReload(value => value + 1); }} /> : <fieldset disabled={!canEdit} className="min-w-0 space-y-6"><legend className="sr-only">Runtime definition and rates</legend>

    <div className="ui-card ui-card-pad space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Rating model</div>
          <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">Versioned rate configuration</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">Add the complete approved model as structured settings, save a draft, then publish it to the authorised binder product authorities.</p>
          {modelMeta ? <><p className="mt-1 text-xs font-semibold text-slate-500">Model: <span className="font-black text-slate-700">v{modelMeta.version}</span> • <span className="font-black text-slate-700">{modelMeta.status}</span> • Updated {formatDateUI(modelMeta.updatedAt, { withTime: true })}</p><p className="mt-1 text-xs font-semibold text-slate-500">Published model ID: <span className="font-mono text-slate-700">{modelMeta.id}</span></p></> : <p className="mt-1 text-xs font-semibold text-amber-700">No persisted rating model is configured.</p>}
        </div>
        <div className="flex items-center gap-3"><Button variant="secondary" size="lg" onClick={handleSave} disabled={saveStatus === 'saving'}>{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Save draft'}</Button><Button size="lg" onClick={handlePublish} disabled={saveStatus === 'publishing' || selectedAuthorityIds.length === 0}>{saveStatus === 'publishing' ? 'Publishing…' : 'Publish rating model'}</Button></div>
      </div>
      {error ? <p className="text-xs font-semibold text-rose-600">{error}</p> : null}
      {loading ? <p className="text-xs font-semibold text-slate-500">Loading persisted rating model…</p> : null}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-xs font-black text-slate-800">Authorised binder product authorities</div><p className="mt-1 text-xs font-semibold text-slate-500">The same selected authorities are used when publishing the complete programme definition below.</p><div className="mt-3 space-y-2">{publishAuthorities.length === 0 ? <p className="text-xs font-semibold text-amber-700">No active linked binder-product authority is available for this programme.</p> : publishAuthorities.map((authority) => <Checkbox key={authority.id} checked={selectedAuthorityIds.includes(authority.id)} onChange={(event) => setSelectedAuthorityIds((current) => event.target.checked ? [...current, authority.id] : current.filter((id) => id !== authority.id))} label={authority.label} />)}</div></div>
      <RatingModelEditor productType={program.productType} value={tables} onChange={setTables} stages={stages} onStagesChange={setStages} ratingPipeline={editorDescriptor?.ratingPipeline} />
    </div>
    <div className="ui-card ui-card-pad space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Programme definition</div>
          <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">Complete runtime settings</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">This versioned definition owns underwriting, cover and options, questionnaire, workflow, channels and document selection. Missing or invalid components cannot be published.</p>
          {definitionMeta ? <p className="mt-1 text-xs font-semibold text-slate-500">Definition: <span className="font-black text-slate-700">v{definitionMeta.version}</span> • <span className="font-black text-slate-700">{definitionMeta.status}</span> • Updated {formatDateUI(definitionMeta.updatedAt, { withTime: true })}</p> : <p className="mt-1 text-xs font-semibold text-amber-700">No persisted programme definition is configured.</p>}
        </div>
        <div className="flex items-center gap-3"><Button variant="secondary" size="lg" onClick={handleSaveDefinition} disabled={definitionStatus === 'saving' || !editorDescriptor}>{definitionStatus === 'saving' ? 'Saving…' : definitionStatus === 'saved' ? 'Saved' : 'Save draft'}</Button><Button size="lg" onClick={handlePublishDefinition} disabled={!canPublish || !reviewedHash || definitionStatus === 'publishing' || selectedAuthorityIds.length === 0}>{definitionStatus === 'publishing' ? 'Publishing…' : 'Publish definition'}</Button></div>
      </div>
      {definitionError ? <p className="text-xs font-semibold text-rose-600">{definitionError}</p> : null}
      {!editorDescriptor ? <p className="text-xs font-semibold text-slate-500">Loading product-owned editor descriptor…</p> : <>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pricing mode</p><Select value={definition.pricingMode} onChange={(event) => setDefinition((current) => ({ ...current, pricingMode: event.target.value as DefinitionDraft['pricingMode'] }))} aria-label="Programme pricing mode"><option value="">Select pricing mode</option>{editorDescriptor.pricingModes.map((mode) => <option key={mode} value={mode}>{mode === 'AUTOMATED' ? 'Automated' : 'Manual'}</option>)}</Select></div>
          {definition.pricingMode === 'AUTOMATED' ? <div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Published rating model ID</p><Input value={definition.programRatingModelId} onChange={(event) => setDefinition((current) => ({ ...current, programRatingModelId: event.target.value }))} placeholder="Publish and map the model first" aria-label="Published rating model ID" /></div> : null}
          <div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Source</p><Input value={definition.source} onChange={(event) => setDefinition((current) => ({ ...current, source: event.target.value }))} placeholder="Approved source reference" aria-label="Source" /></div>
          <div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Notes</p><Input value={definition.notes} onChange={(event) => setDefinition((current) => ({ ...current, notes: event.target.value }))} placeholder="Review note" aria-label="Notes" /></div>
        </div>
        <div className="space-y-5">{editorDescriptor.components.map((component) => <ProgrammeDefinitionComponentEditor key={component.key} control={component.control} label={component.label} description={component.description} productType={editorDescriptor.productType} pricingMode={definition.pricingMode} value={definition.components[component.key]} onChange={(value) => setDefinition((current) => ({ ...current, components: { ...current.components, [component.key]: asRecord(value, component.label) } }))} />)}</div>
      </>}
    </div>
    </fieldset>}
  </div>;
};
