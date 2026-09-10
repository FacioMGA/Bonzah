import React, { useState } from 'react';
import type { JsonObject, JsonValue } from '@/src/modules/programs/components/StructuredJsonEditor';
import { editableSchema, initialFieldValue, type EditorSchema } from '../model/editorContract';

const labelFor = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
function object(value: JsonValue | undefined): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
type Props = { schema: EditorSchema; value: JsonValue | undefined; path: string; onChange: (value: JsonValue) => void };
const controlClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';

export function ContractFields({ schema: raw, value, path, onChange }: Props) {
  const schema = editableSchema(raw);
  const [newKey, setNewKey] = useState('');
  if (schema.const !== undefined) return <output>{String(schema.const)}</output>;
  if (schema.enum) return <select className={controlClass} aria-label={path} value={value === null ? 'null' : String(value ?? '')} onChange={(event) => { const next = schema.enum!.find((item) => String(item) === event.target.value); if (next !== undefined) onChange(next); }}><option value="" disabled>Select explicitly</option>{schema.enum.map((option) => <option key={String(option)} value={String(option)}>{labelFor(String(option))}</option>)}</select>;
  if (schema.type === 'object') {
    const current = object(value), properties = schema.properties ?? {};
    const update = (key: string, next: JsonValue) => onChange({ ...current, [key]: next });
    const remove = (key: string) => { const next = { ...current }; delete next[key]; onChange(next); };
    const additionalSchema = typeof schema.additionalProperties === 'object' ? schema.additionalProperties : null;
    return <div className="space-y-4">
      {Object.entries(properties).map(([key, childSchema]) => {
        const required = schema.required?.includes(key), present = Object.hasOwn(current, key);
        const child = editableSchema(childSchema), collection = child.type === 'object' || child.type === 'array';
        return <div className={collection ? 'rounded-lg border border-slate-200 p-4' : ''} key={key}>
          <div className="mb-1 flex items-center justify-between gap-2"><label className="text-sm font-semibold">{labelFor(key)}{required ? ' *' : ''}</label>{!required ? <button type="button" className="text-xs text-indigo-700 underline" onClick={() => present ? remove(key) : update(key, initialFieldValue(childSchema))}>{present ? 'Remove optional setting' : 'Configure'}</button> : null}</div>
          {childSchema.description ? <p className="mb-2 text-xs text-slate-600">{childSchema.description}</p> : null}
          {present || required ? <ContractFields schema={childSchema} value={current[key]} path={`${path}.${key}`} onChange={(next) => update(key, next)} /> : <p className="text-xs text-slate-500">Not configured</p>}
        </div>;
      })}
      {additionalSchema ? <div className="space-y-3">
        {Object.keys(current).filter((key) => !Object.hasOwn(properties, key)).map((key) => <div className="rounded-lg border p-3" key={key}><div className="flex justify-between"><strong>{key}</strong><button type="button" onClick={() => remove(key)}>Remove entry</button></div><ContractFields schema={additionalSchema} value={current[key]} path={`${path}.${key}`} onChange={(next) => update(key, next)} /></div>)}
        <div className="flex gap-2"><input className={controlClass} aria-label={`${path} new key`} value={newKey} onChange={(event) => setNewKey(event.target.value)} /><button type="button" disabled={!newKey.trim() || ['__proto__', 'constructor', 'prototype'].includes(newKey.trim()) || Object.hasOwn(current, newKey.trim())} onClick={() => { update(newKey.trim(), initialFieldValue(additionalSchema)); setNewKey(''); }}>Add entry</button></div>
      </div> : null}
    </div>;
  }
  if (schema.type === 'array') {
    const current = Array.isArray(value) ? value : [];
    const itemSchema = schema.items ?? {};
    return <div className="space-y-3">{current.map((item, index) => <div className="rounded-lg border border-slate-200 p-3" key={index}><div className="mb-2 flex items-center justify-between text-xs"><strong>Entry {index + 1}</strong><button type="button" onClick={() => onChange(current.filter((_, itemIndex) => index !== itemIndex))}>Remove entry {index + 1}</button></div><ContractFields schema={itemSchema} value={item} path={`${path}[${index}]`} onChange={(next) => onChange(current.map((previous, itemIndex) => itemIndex === index ? next : previous))} /></div>)}<button type="button" disabled={schema.maxItems !== undefined && current.length >= schema.maxItems} className="rounded-lg border border-indigo-300 px-3 py-2 text-sm text-indigo-800" onClick={() => onChange([...current, initialFieldValue(itemSchema)])}>Add {labelFor(path.split('.').at(-1) ?? 'entry')}</button></div>;
  }
  if (schema.type === 'boolean') return <input type="checkbox" aria-label={path} checked={value === true} onChange={(event) => onChange(event.target.checked)} />;
  if (schema.type === 'number' || schema.type === 'integer') return <input className={controlClass} type="number" aria-label={path} step={schema.type === 'integer' ? 1 : 'any'} min={schema.minimum} max={schema.maximum} value={typeof value === 'number' || typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))} />;
  if ((schema.maxLength ?? 0) > 1500) return <textarea className={controlClass} rows={3} aria-label={path} value={typeof value === 'string' ? value : ''} maxLength={schema.maxLength} onChange={(event) => onChange(event.target.value)} />;
  return <input className={controlClass} aria-label={path} value={typeof value === 'string' ? value : ''} minLength={schema.minLength} maxLength={schema.maxLength} onChange={(event) => onChange(event.target.value)} />;
}
