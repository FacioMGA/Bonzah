import React from 'react';
import { Checkbox } from '@/src/shared/ui';
import type { JsonObject } from '@/src/modules/programs/components/StructuredJsonEditor';

const CHANNELS = [
  { key: 'questions', label: 'Allow customer questions', description: 'Allow the customer journey to collect programme questions.' },
  { key: 'quote', label: 'Allow quotation', description: 'Allow the programme to return a quote or a governed referral.' },
  { key: 'payment', label: 'Allow payment', description: 'Allow payment only when the approved programme workflow permits it.' },
] as const;

/** Shared editor for the published channel component consumed by every journey surface. */
export function ProgrammeChannelsEditor({ value, onChange }: { value: JsonObject; onChange: (next: JsonObject) => void }) {
  const complete = CHANNELS.every((channel) => typeof value[channel.key] === 'boolean');
  if (!complete) return <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">This draft needs an explicit yes or no for questions, quotation and payment. Channels are never inferred from a previous programme or tenant setting.</p>;
  return <section className="space-y-4">
    <div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Customer channels</h3><p className="mt-1 text-xs font-semibold text-slate-500">These published permissions control the public journey for this binder-mapped programme.</p></div>
    <div className="space-y-4">{CHANNELS.map((channel) => <div className="space-y-1" key={channel.key}><Checkbox checked={value[channel.key] as boolean} onChange={(event) => onChange({ ...value, [channel.key]: event.target.checked })} label={channel.label} /><p className="pl-7 text-xs font-medium text-slate-500">{channel.description}</p></div>)}</div>
  </section>;
}
