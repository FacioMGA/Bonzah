import React from 'react';
import { Input } from '@/src/shared/ui';
import type { JsonObject, JsonValue } from '@/src/modules/programs/components/StructuredJsonEditor';

type HealthRatingModelEditorProps = {
  tables: JsonObject;
  onChange: (next: JsonObject) => void;
};

type AgeBand = { band: string; premiumGross: number; commissionPercent: number; excess: number | '10%' };

const BASE_COVER_FIELDS = [
  ['inpatientPerIllness', 'Inpatient per illness'],
  ['inpatientPerPeriod', 'Inpatient per policy period'],
  ['dailyRoomRegular', 'Daily room (regular)'],
  ['dailyRoomEmergency', 'Daily room (emergency)'],
  ['childbirthLumpSum', 'Childbirth lump sum'],
  ['repatriationLimit', 'Repatriation limit'],
  ['outpatientPerIllness', 'Outpatient per illness'],
  ['outpatientPerPeriod', 'Outpatient per policy period'],
  ['outpatientExcess', 'Outpatient excess'],
  ['coinsurancePercent', 'Co-insurance percentage'],
] as const;

const GHS_EXTENSION_FIELDS = [
  ['doctorVisit', 'Doctor visit'],
  ['doctorVisitsPerPeriod', 'Doctor visits per policy period'],
  ['medications', 'Medications'],
  ['deathByAccidentLimit', 'Death by accident'],
  ['repatriationAfterDeathLimit', 'Repatriation after death'],
] as const;

function asRecord(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asAgeBands(value: JsonValue | undefined): AgeBand[] | null {
  if (!Array.isArray(value)) return null;
  const bands = value.map((entry) => asRecord(entry));
  if (bands.some((entry) => !entry)) return null;
  const parsed = bands.map((entry) => ({
    band: typeof entry!.band === 'string' ? entry!.band : '',
    premiumGross: typeof entry!.premiumGross === 'number' ? entry!.premiumGross : Number.NaN,
    commissionPercent: typeof entry!.commissionPercent === 'number' ? entry!.commissionPercent : Number.NaN,
    excess: typeof entry!.excess === 'number' || entry!.excess === '10%' ? entry!.excess as number | '10%' : Number.NaN,
  }));
  return parsed.some((band) => !band.band || !Number.isFinite(band.premiumGross) || !Number.isFinite(band.commissionPercent) || (typeof band.excess === 'number' && !Number.isFinite(band.excess))) ? null : parsed;
}

function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (next: number) => void }) {
  return <Input type="number" min="0" step="0.01" inputMode="decimal" aria-label={label} value={String(value)} onChange={(event) => {
    const next = Number(event.target.value);
    if (Number.isFinite(next)) onChange(next);
  }} className="min-w-24 px-2 py-1.5 text-right text-xs" />;
}

function AmountFields({ title, description, values, fields, onChange }: {
  title: string;
  description: string;
  values: JsonObject;
  fields: readonly (readonly [string, string])[];
  onChange: (key: string, amount: number) => void;
}) {
  return <section className="space-y-3"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</h3><p className="mt-1 text-xs font-semibold text-slate-500">{description}</p></div><div className="grid gap-3 md:grid-cols-2">{fields.map(([key, label]) => <div key={key} className="rounded-xl border border-slate-200 bg-white p-3"><p className="mb-2 text-xs font-black text-slate-700">{label}</p><MoneyInput label={`${title} ${label}`} value={typeof values[key] === 'number' ? values[key] as number : 0} onChange={(amount) => onChange(key, amount)} /></div>)}</div></section>;
}

/** Product-owned authoring surface for the complete Health rating-model schema. */
export function HealthRatingModelEditor({ tables, onChange }: HealthRatingModelEditorProps) {
  const ageBands = asAgeBands(tables.ageBands);
  const baseCover = asRecord(tables.baseCover);
  const ghsExtension = asRecord(tables.ghsExtension);
  if (!ageBands || !baseCover || !ghsExtension) {
    return <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">This draft does not contain a complete Health rating model. Supply all approved age bands, cover limits and GHS-extension limits before saving; the system will not read a rate file or another version as a fallback.</p>;
  }
  const setMetadata = (key: 'asset' | 'version' | 'reviewed', value: string) => onChange({ ...tables, [key]: value });
  const setAgeBand = (index: number, key: keyof AgeBand, value: string | number) => onChange({
    ...tables,
    ageBands: ageBands.map((band, currentIndex) => currentIndex === index ? { ...band, [key]: value } : band),
  });
  const setAmount = (section: 'baseCover' | 'ghsExtension', values: JsonObject, key: string, amount: number) => onChange({
    ...tables,
    [section]: { ...values, [key]: amount },
  });

  return <div className="space-y-8">
    <section className="space-y-3"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Approved rate source</h3><p className="mt-1 text-xs font-semibold text-slate-500">Record the insurer-approved source and review version for this published model.</p></div><div className="grid gap-3 md:grid-cols-3">{(['asset', 'version', 'reviewed'] as const).map((key) => <div key={key} className="space-y-2"><p className="text-xs font-black text-slate-700">{key === 'asset' ? 'Source reference' : key === 'version' ? 'Version' : 'Reviewed date'}</p><Input aria-label={`Health ${key}`} value={typeof tables[key] === 'string' ? tables[key] : ''} onChange={(event) => setMetadata(key, event.target.value)} /></div>)}</div></section>
    <section className="space-y-3"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Age-banded premium and excess</h3><p className="mt-1 text-xs font-semibold text-slate-500">Gross annual premium, commission share and compulsory excess for every insured age band.</p></div><div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="ui-table min-w-[48rem]"><thead className="ui-thead"><tr><th>Age band</th><th>Gross premium</th><th>Commission (decimal)</th><th>Excess (€ or 10%)</th></tr></thead><tbody className="ui-tbody">{ageBands.map((band, index) => <tr className="ui-row" key={band.band}><td className="px-3 py-2 text-xs font-semibold text-slate-700">{band.band}</td><td><MoneyInput label={`Health ${band.band} gross premium`} value={band.premiumGross} onChange={(amount) => setAgeBand(index, 'premiumGross', amount)} /></td><td><MoneyInput label={`Health ${band.band} commission`} value={band.commissionPercent} onChange={(amount) => setAgeBand(index, 'commissionPercent', amount)} /></td><td><Input aria-label={`Health ${band.band} excess`} value={String(band.excess)} onChange={(event) => { const value = event.target.value.trim(); if (value === '10%') setAgeBand(index, 'excess', value); else { const amount = Number(value); if (Number.isFinite(amount)) setAgeBand(index, 'excess', amount); } }} className="min-w-24 px-2 py-1.5 text-right text-xs" /></td></tr>)}</tbody></table></div></section>
    <AmountFields title="Base cover limits" description="Health cover amounts displayed on the quote and issued documents." values={baseCover} fields={BASE_COVER_FIELDS} onChange={(key, amount) => setAmount('baseCover', baseCover, key, amount)} />
    <AmountFields title="GHS extension limits" description="Limits for the conditional GESY/GHS extension." values={ghsExtension} fields={GHS_EXTENSION_FIELDS} onChange={(key, amount) => setAmount('ghsExtension', ghsExtension, key, amount)} />
  </div>;
}
