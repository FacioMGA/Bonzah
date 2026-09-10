import React from 'react';
import { Button, Checkbox, Input } from '@/src/shared/ui';
import { StructuredJsonEditor, type JsonObject, type JsonValue } from '@/src/modules/programs/components/StructuredJsonEditor';

type CoverageEntry = JsonObject & { code: string; params: JsonObject };
type BaseCoverageEntry = CoverageEntry & { enabled: boolean };
type OptionalCoverageEntry = CoverageEntry & { enabledByDefault: boolean };

function asObject(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asEntries(value: JsonValue | undefined, flag: 'enabled' | 'enabledByDefault'): Array<BaseCoverageEntry | OptionalCoverageEntry> | null {
  if (!Array.isArray(value)) return null;
  const entries = value.map((entry) => asObject(entry));
  if (entries.some((entry) => !entry)) return null;
  const configured = entries.map((entry) => ({
    ...entry,
    code: typeof entry!.code === 'string' ? entry!.code : '',
    params: asObject(entry!.params) || {},
    [flag]: entry![flag] === true,
  }));
  return configured as Array<BaseCoverageEntry | OptionalCoverageEntry>;
}

function EntryEditor({ entry, title, enabledLabel, onChange, onRemove }: {
  entry: BaseCoverageEntry | OptionalCoverageEntry;
  title: string;
  enabledLabel: string;
  onChange: (next: BaseCoverageEntry | OptionalCoverageEntry) => void;
  onRemove: () => void;
}) {
  const flag = 'enabled' in entry ? 'enabled' : 'enabledByDefault';
  const checked = entry[flag] === true;
  return <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <div className="flex items-center justify-between gap-3"><p className="text-xs font-black text-slate-700">{title}</p><Button type="button" variant="ghost" size="sm" onClick={onRemove}>Remove</Button></div>
    <div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Catalogue code</p><Input value={entry.code} onChange={(event) => onChange({ ...entry, code: event.target.value })} aria-label={`${title} catalogue code`} /><p className="text-xs font-medium text-slate-500">Must match an approved product coverage/endorsement code at publication.</p></div>
    <Checkbox checked={checked} onChange={(event) => onChange({ ...entry, [flag]: event.target.checked })} label={enabledLabel} />
    <StructuredJsonEditor label="Coverage parameters" description="Template-specific parameters. Invalid parameters are rejected when the draft is published." value={entry.params} onChange={(next) => {
      const params = asObject(next);
      if (params) onChange({ ...entry, params });
    }} />
  </div>;
}

/** Shared form editor for the published cover and option catalogue. */
export function ProgrammeCoverageEditor({ pricingMode, value, onChange }: { pricingMode: '' | 'AUTOMATED' | 'MANUAL'; value: JsonObject; onChange: (next: JsonObject) => void }) {
  if (!pricingMode) return <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-700">Choose a pricing mode before configuring coverage.</p>;
  if (pricingMode === 'MANUAL') {
    const complete = value.schemaVersion === 1 && value.mode === 'MANUAL';
    return <section className="space-y-4"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Manual cover</h3><p className="mt-1 text-xs font-semibold text-slate-500">Manual programmes do not expose an automated cover catalogue. Their cover and premium are governed by the operator’s proposal.</p></div>{complete ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-semibold text-emerald-700">This manual-coverage component is complete.</p> : <Button type="button" variant="secondary" onClick={() => onChange({ schemaVersion: 1, mode: 'MANUAL' })}>Set manual coverage mode</Button>}</section>;
  }

  const base = asEntries(value.base, 'enabled') as BaseCoverageEntry[] | null;
  const options = asEntries(value.options, 'enabledByDefault') as OptionalCoverageEntry[] | null;
  const valid = value.schemaVersion === 1 && typeof value.programCode === 'string' && base && options;
  if (!valid) return <section className="space-y-3"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cover and options</h3><p className="mt-1 text-xs font-semibold text-slate-500">Start an automated cover catalogue. It remains a draft until its programme code and approved catalogue entries are provided.</p></div><Button type="button" variant="secondary" onClick={() => onChange({ schemaVersion: 1, programCode: '', base: [], options: [] })}>Start cover catalogue draft</Button></section>;
  const update = (key: 'base' | 'options', entries: Array<BaseCoverageEntry | OptionalCoverageEntry>) => onChange({ ...value, [key]: entries });
  return <section className="space-y-5"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cover and options</h3><p className="mt-1 text-xs font-semibold text-slate-500">The published programme, not code, determines which approved catalogue entries are included and optional.</p></div><div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Programme catalogue code</p><Input value={value.programCode as string} onChange={(event) => onChange({ ...value, programCode: event.target.value })} aria-label="Coverage programme catalogue code" /></div><div className="space-y-3"><h4 className="text-xs font-black text-slate-800">Base cover</h4>{base.map((entry, index) => <EntryEditor key={`base-${index}`} title={`Base cover ${index + 1}`} enabledLabel="Included in this programme" entry={entry} onChange={(next) => update('base', base.map((current, currentIndex) => currentIndex === index ? next as BaseCoverageEntry : current))} onRemove={() => update('base', base.filter((_, currentIndex) => currentIndex !== index))} />)}<Button type="button" variant="secondary" size="sm" onClick={() => update('base', [...base, { code: '', enabled: true, params: {} }])}>Add base cover</Button></div><div className="space-y-3"><h4 className="text-xs font-black text-slate-800">Optional cover</h4>{options.map((entry, index) => <EntryEditor key={`option-${index}`} title={`Option ${index + 1}`} enabledLabel="Selected by default" entry={entry} onChange={(next) => update('options', options.map((current, currentIndex) => currentIndex === index ? next as OptionalCoverageEntry : current))} onRemove={() => update('options', options.filter((_, currentIndex) => currentIndex !== index))} />)}<Button type="button" variant="secondary" size="sm" onClick={() => update('options', [...options, { code: '', enabledByDefault: false, params: {} }])}>Add option</Button></div></section>;
}
