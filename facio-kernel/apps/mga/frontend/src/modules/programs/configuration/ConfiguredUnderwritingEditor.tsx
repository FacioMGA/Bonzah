import React from 'react';
import { Checkbox, Input, Textarea } from '@/src/shared/ui';
import type { JsonObject, JsonValue } from '@/src/modules/programs/components/StructuredJsonEditor';

type Field =
  | { key: string; label: string; description: string; kind: 'number'; optional?: boolean }
  | { key: string; label: string; description: string; kind: 'boolean' }
  | { key: string; label: string; description: string; kind: 'string-list' };

function strings(value: JsonValue | undefined): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null;
}

/** Shared presentation primitive; each product owns the fields it passes here. */
export function ConfiguredUnderwritingEditor({ title, fields, value, onChange }: { title: string; fields: Field[]; value: JsonObject; onChange: (next: JsonObject) => void }) {
  const invalid = fields.some((field) => {
    const configured = value[field.key];
    if (field.kind === 'number') return configured === undefined ? !field.optional : typeof configured !== 'number';
    if (field.kind === 'boolean') return typeof configured !== 'boolean';
    return strings(configured) === null;
  });
  if (invalid) return <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">This draft does not contain the complete {title} underwriting structure. Correct it before publishing; the system will not fill missing limits or territories from a prior configuration.</p>;
  return <section className="space-y-5"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title} underwriting</h3><p className="mt-1 text-xs font-semibold text-slate-500">These limits and appetite controls are published with the programme and executed by the product underwriting engine.</p></div><div className="grid grid-cols-1 gap-4 md:grid-cols-2">{fields.map((field) => {
    const configured = value[field.key];
    if (field.kind === 'boolean') return <div className="space-y-2" key={field.key}><Checkbox checked={configured === true} onChange={(event) => onChange({ ...value, [field.key]: event.target.checked })} label={field.label} /><p className="pl-7 text-xs font-medium text-slate-500">{field.description}</p></div>;
    if (field.kind === 'string-list') return <div className="space-y-2 md:col-span-2" key={field.key}><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{field.label}</p><Textarea rows={3} value={(configured as string[]).join('\n')} onChange={(event) => onChange({ ...value, [field.key]: event.target.value.split('\n').map((entry) => entry.trim()).filter(Boolean) })} aria-label={field.label} /><p className="text-xs font-medium text-slate-500">{field.description} One item per line.</p></div>;
    return <div className="space-y-2" key={field.key}><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{field.label}</p><Input type="number" min="0" inputMode="decimal" value={configured === undefined ? '' : String(configured)} onChange={(event) => { const raw = event.target.value; if (raw === '' && field.optional) { const next = { ...value }; delete next[field.key]; onChange(next); return; } const number = Number(raw); if (Number.isFinite(number)) onChange({ ...value, [field.key]: number }); }} aria-label={field.label} /><p className="text-xs font-medium text-slate-500">{field.description}</p></div>;
  })}</div></section>;
}
