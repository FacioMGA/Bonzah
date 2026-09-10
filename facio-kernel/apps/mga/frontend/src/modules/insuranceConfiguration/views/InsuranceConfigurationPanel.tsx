import React, { useEffect, useRef, useState } from 'react';
import type { JsonObject, JsonValue } from '@/src/modules/programs/components/StructuredJsonEditor';
import { insuranceConfigurationApi } from '../api/insuranceConfigurationApi';
import { initialFieldValue, type ConfigurationView, type EditorSchema } from '../model/editorContract';
import { ContractFields } from './ContractFields';

export type InsuranceConfigurationPanelProps = { programId: string; canEdit: boolean; onSaved?: (definitionId: string) => void; onDirtyChange?: (dirty: boolean) => void };
function asObject(value: JsonValue): JsonObject { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be an object.'); return value; }

/** Existing BO programme editor extension. Saves the same versioned definition used by runtime. */
export function InsuranceConfigurationPanel({ programId, canEdit, onSaved, onDirtyChange }: InsuranceConfigurationPanelProps) {
  const [schema, setSchema] = useState<EditorSchema | null>(null);
  const [source, setSource] = useState('');
  const [view, setView] = useState<ConfigurationView | null>(null);
  const [value, setValue] = useState<JsonObject | null>(null);
  const [tab, setTab] = useState<'process' | 'product'>('process');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const [reload, setReload] = useState(0);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const current = ++generation.current;
    setView(null); setValue(null); setSchema(null); setDirty(false); setMessage(''); setBusy(true);
    void Promise.all([insuranceConfigurationApi.schema(), insuranceConfigurationApi.read(programId)]).then(([contract, next]) => {
      if (current !== generation.current) return;
      const nextSchema = JSON.parse(contract.schemaJson) as EditorSchema;
      setSchema(nextSchema); setSource(contract.sourceRevision); setView(next);
      setValue(next.process && next.product ? { schemaVersion: 1, process: next.process, product: next.product } : null);
    }).catch((error: unknown) => { if (current === generation.current) setMessage(error instanceof Error ? error.message : 'Configuration could not be loaded.'); }).finally(() => { if (current === generation.current) setBusy(false); });
    return () => { generation.current++; };
  }, [programId, reload]);
  const initialize = () => {
    if (!schema) return;
    setValue(asObject(initialFieldValue(schema))); setDirty(true);
    setMessage('Choose and review every capability and product field. These values remain a draft until separately published to the intended binder authority.');
  };
  const save = async () => {
    if (!view || !value || busy || !canEdit) return;
    const current = generation.current;
    setBusy(true); setMessage('');
    try {
      const next = await insuranceConfigurationApi.save(programId, { baseDefinitionId: view.definitionId, expectedDefinitionHash: view.definitionHash, process: asObject(value.process), product: asObject(value.product) });
      if (current !== generation.current) return;
      setView(next); setValue({ schemaVersion: 1, process: next.process!, product: next.product! }); setDirty(false);
      setMessage(`Draft version ${next.version} saved. Review the programme and publish to selected binder authorities to apply it.`); onSaved?.(next.definitionId);
    } catch (error) { if (current === generation.current) setMessage(error instanceof Error ? error.message : 'Save failed. Reload before retrying an uncertain result.'); }
    finally { if (current === generation.current) setBusy(false); }
  };
  return <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6" aria-label="Insurance and workflow configuration">
    <header><h2 className="text-lg font-bold text-slate-900">Insurance and workflow configuration</h2><p className="mt-1 text-sm text-slate-600">Save a draft, then publish it to apply changes to this programme; existing policies retain their terms.</p></header>
    {message ? <p role="status" className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm">{message}</p> : null}
    {busy && !view ? <p>Loading selected programme configuration…</p> : null}
    {view ? <div className="text-xs text-slate-600"><p>Definition {view.version} · {view.status} · {dirty ? 'Unsaved changes' : 'Saved'}</p><details className="mt-2"><summary className="cursor-pointer">Definition hash</summary><p className="mt-1 break-all font-mono">{view.definitionHash}</p></details></div> : null}
    <details className="rounded-lg border border-slate-200 px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">Configuration guidance</summary>
      <div className="mt-3 space-y-3 text-sm text-slate-600">
        <p>Symphony product and Process Builder contracts apply through this programme’s definition and binder authority. Saving includes the registered engine’s required input fields and applies matching source labels and settings; review the complete questionnaire before publishing.</p>
        <p>Question group scopes override the nested question scope when supplied, including “All”. Use configured coverage names, stable segment IDs, section labels or class keys, and a linked binder’s ID or unique name. Scopes combine with OPEN IF conditions. Empty selections remain visible until chosen; hidden answers are retained. Save a new draft and publish it to apply scope changes.</p>
        {view?.runtimeSupport.map((support) => <p key={support.capability}><strong>{support.capability.replace(/_/g, ' ')}:</strong> {support.detail}</p>)}
        {source ? <p className="break-all text-xs text-slate-500">Source contract revision {source}. Runtime authority comes from the selected programme publication.</p> : null}
      </div>
    </details>
    {view && !value ? <button type="button" disabled={!canEdit || busy || !schema} onClick={initialize} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white">Configure insurance and workflow</button> : null}
    {value && schema ? <>
      <nav className="flex gap-2" aria-label="Insurance configuration sections"><button type="button" onClick={() => setTab('process')} aria-pressed={tab === 'process'} className="rounded-lg border px-4 py-2">Workflow and participants</button><button type="button" onClick={() => setTab('product')} aria-pressed={tab === 'product'} className="rounded-lg border px-4 py-2">Product, coverage and questions</button></nav>
      <fieldset disabled={!canEdit || busy} className="min-w-0"><legend className="mb-4 text-base font-bold">{tab === 'process' ? 'Workflow and participants' : 'Product configuration'}</legend><ContractFields schema={schema.properties?.[tab] ?? {}} value={value[tab]} path={tab} onChange={(next) => { setValue({ ...value, [tab]: next }); setDirty(true); setMessage(''); }} /></fieldset>
      <button type="button" disabled={!canEdit || busy || !dirty} onClick={() => void save()} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save programme definition draft'}</button>
    </> : null}
    {view?.publicationIssues.length ? <aside className="rounded-lg border border-amber-300 bg-amber-50 p-4"><h3 className="font-semibold">Publication dependencies</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{view.publicationIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></aside> : null}
    <button type="button" disabled={busy || dirty} onClick={() => setReload((current) => current + 1)} className="mt-4 block text-sm underline">Reload saved configuration</button>
  </section>;
}
