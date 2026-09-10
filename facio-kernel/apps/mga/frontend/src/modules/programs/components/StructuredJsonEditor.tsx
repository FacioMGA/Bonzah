import React, { useState } from 'react';
import { Button, Checkbox, Input, Select } from '@/src/shared/ui';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

type ValueKind = 'text' | 'number' | 'boolean' | 'object' | 'list';
type StructuredJsonEditorProps = { label: string; description: string; value: JsonValue; onChange: (value: JsonValue) => void; };

function blankValue(kind: ValueKind): JsonValue {
  if (kind === 'object') return {};
  if (kind === 'list') return [];
  if (kind === 'number') return 0;
  if (kind === 'boolean') return false;
  return '';
}

function AddValueControl({ onAdd, noun }: { onAdd: (name: string, kind: ValueKind) => void; noun: string }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ValueKind>('text');
  return <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_10rem_auto]">
    <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={`${noun} name`} aria-label={`${noun} name`} />
    <Select value={kind} onChange={(event) => setKind(event.target.value as ValueKind)} aria-label={`${noun} value type`}><option value="text">Text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="object">Object</option><option value="list">List</option></Select>
    <Button type="button" variant="secondary" onClick={() => { const key = name.trim(); if (!key) return; onAdd(key, kind); setName(''); }}>Add</Button>
  </div>;
}

function JsonValueEditor({ value, onChange, label, allowRemove, onRemove }: { value: JsonValue; onChange: (value: JsonValue) => void; label: string; allowRemove?: boolean; onRemove?: () => void; }) {
  if (Array.isArray(value)) {
    return <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3"><div className="flex items-center justify-between gap-3"><p className="text-xs font-black text-slate-700">{label}</p>{allowRemove ? <Button type="button" variant="ghost" size="sm" onClick={onRemove}>Remove</Button> : null}</div>{value.map((item, index) => <JsonValueEditor key={`${label}-${index}`} label={`Item ${index + 1}`} value={item} allowRemove onRemove={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} onChange={(next) => onChange(value.map((entry, itemIndex) => itemIndex === index ? next : entry))} />)}<AddValueControl noun="Item" onAdd={(_name, kind) => onChange([...value, blankValue(kind)])} /></div>;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3"><div className="flex items-center justify-between gap-3"><p className="text-xs font-black text-slate-700">{label}</p>{allowRemove ? <Button type="button" variant="ghost" size="sm" onClick={onRemove}>Remove</Button> : null}</div>{entries.map(([key, entry]) => <JsonValueEditor key={key} label={key} value={entry} allowRemove onRemove={() => { const next = { ...value }; delete next[key]; onChange(next); }} onChange={(next) => onChange({ ...value, [key]: next })} />)}<AddValueControl noun="Field" onAdd={(key, kind) => { if (Object.prototype.hasOwnProperty.call(value, key)) return; onChange({ ...value, [key]: blankValue(kind) }); }} /></div>;
  }
  if (typeof value === 'boolean') {
    return <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3"><Checkbox checked={value} onChange={(event) => onChange(event.target.checked)} label={<span className="text-xs font-black text-slate-700">{label}</span>} />{allowRemove ? <Button type="button" variant="ghost" size="sm" onClick={onRemove}>Remove</Button> : null}</div>;
  }
  if (typeof value === 'number') {
    return <div className="grid grid-cols-1 items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[12rem_minmax(0,1fr)_auto]"><p className="text-xs font-black text-slate-700">{label}</p><Input type="number" inputMode="decimal" value={String(value)} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} aria-label={label} />{allowRemove ? <Button type="button" variant="ghost" size="sm" onClick={onRemove}>Remove</Button> : null}</div>;
  }
  return <div className="grid grid-cols-1 items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[12rem_minmax(0,1fr)_auto]"><p className="text-xs font-black text-slate-700">{label}</p><Input value={value ?? ''} onChange={(event) => onChange(event.target.value)} aria-label={label} />{allowRemove ? <Button type="button" variant="ghost" size="sm" onClick={onRemove}>Remove</Button> : null}</div>;
}

/** Structural fallback for a product-owned configuration schema. */
export function StructuredJsonEditor({ label, description, value, onChange }: StructuredJsonEditorProps) {
  return <section className="space-y-2"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</h3><p className="mt-1 text-xs font-semibold text-slate-500">{description}</p></div><JsonValueEditor label={label} value={value} onChange={onChange} /></section>;
}
