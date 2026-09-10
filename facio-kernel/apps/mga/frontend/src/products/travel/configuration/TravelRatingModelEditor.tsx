import React from 'react';
import { Input, Select } from '@/src/shared/ui';
import type { JsonObject, JsonValue } from '@/src/modules/programs/components/StructuredJsonEditor';

type Props = { tables: JsonObject; onChange: (next: JsonObject) => void };
type RateCell = number | 'REFER';
type AddonRule = { kind: 'loadPercent' | 'perTraveller'; value: number };
type Addon = { singleTrip: AddonRule; multiTrip: AddonRule };
type FeeBand = { uptoNet: number | null; fee: number };

function asRecord(value: JsonValue | undefined): JsonObject | null { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function asRates(value: JsonValue | undefined): Record<string, RateCell> | null {
  const record = asRecord(value); if (!record || Object.values(record).some((entry) => typeof entry !== 'number' && entry !== 'REFER')) return null;
  return record as Record<string, RateCell>;
}
function asRule(value: JsonValue | undefined): AddonRule | null {
  const record = asRecord(value); return record && (record.kind === 'loadPercent' || record.kind === 'perTraveller') && typeof record.value === 'number' ? record as AddonRule : null;
}
function asAddons(value: JsonValue | undefined): Record<string, Addon> | null {
  const record = asRecord(value); if (!record) return null;
  const parsed = Object.fromEntries(Object.entries(record).map(([key, entry]) => { const item = asRecord(entry); return [key, item ? { singleTrip: asRule(item.singleTrip), multiTrip: asRule(item.multiTrip) } : null]; }));
  return Object.values(parsed).some((entry) => !entry || !entry.singleTrip || !entry.multiTrip) ? null : parsed as Record<string, Addon>;
}
function asNumberRecord(value: JsonValue | undefined): Record<string, number> | null { const record = asRecord(value); return record && Object.values(record).every((entry) => typeof entry === 'number') ? record as Record<string, number> : null; }
function asFeeBands(value: JsonValue | undefined): FeeBand[] | null {
  if (!Array.isArray(value)) return null;
  const bands = value.map((entry) => asRecord(entry)).map((entry) => entry && (typeof entry.uptoNet === 'number' || entry.uptoNet === null) && typeof entry.fee === 'number' ? entry as FeeBand : null);
  return bands.some((entry) => !entry) ? null : bands as FeeBand[];
}
function NumberInput({ label, value, nullable = false, onChange }: { label: string; value: number | null; nullable?: boolean; onChange: (next: number | null) => void }) {
  return <Input type="number" min="0" step="0.01" inputMode="decimal" aria-label={label} value={value === null ? '' : String(value)} onChange={(event) => { if (nullable && event.target.value === '') return onChange(null); const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} className="min-w-24 px-2 py-1.5 text-right text-xs" />;
}
function RuleEditor({ label, value, onChange }: { label: string; value: AddonRule; onChange: (next: AddonRule) => void }) {
  return <div className="grid grid-cols-2 gap-2"><Select aria-label={`${label} calculation`} value={value.kind} onChange={(event) => onChange({ ...value, kind: event.target.value as AddonRule['kind'] })}><option value="loadPercent">% loading</option><option value="perTraveller">Per traveller</option></Select><NumberInput label={`${label} amount`} value={value.value} onChange={(amount) => onChange({ ...value, value: amount ?? 0 })} /></div>;
}

/** Product-owned authoring surface for the complete Travel rating-model schema. */
export function TravelRatingModelEditor({ tables, onChange }: Props) {
  const rateCard = asRecord(tables.rateCard); const adminFees = asRecord(tables.adminFees);
  const rates = rateCard ? asRates(rateCard.rates) : null; const addons = rateCard ? asAddons(rateCard.addons) : null;
  const multipliers = rateCard ? asNumberRecord(rateCard.singleTripCoverMultipliers) : null;
  const underwritingProfitLoading = rateCard ? asRecord(rateCard.underwritingProfitLoading) : null;
  const priorClaimLoading = rateCard ? asRecord(rateCard.priorClaimLoading) : null;
  const underwritingProfitRate = underwritingProfitLoading && typeof underwritingProfitLoading.rate === 'number' ? underwritingProfitLoading.rate : null;
  const priorClaimRate = priorClaimLoading && typeof priorClaimLoading.upTo500Rate === 'number' ? priorClaimLoading.upTo500Rate : null;
  const feeBands = adminFees ? asFeeBands(adminFees.bands) : null;
  if (!rateCard || !adminFees || !rates || !addons || !multipliers || !underwritingProfitLoading || !priorClaimLoading || underwritingProfitRate === null || priorClaimRate === null || !feeBands) return <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">This draft does not contain the complete Travel rate card and fee bands. Supply all approved rate cells, add-ons, loadings and fee bands before publishing; no runtime file or previous model is used.</p>;
  const setRateCard = (key: string, value: JsonValue) => onChange({ ...tables, rateCard: { ...rateCard, [key]: value } });
  const setAdminFees = (key: string, value: JsonValue) => onChange({ ...tables, adminFees: { ...adminFees, [key]: value } });
  const updateRate = (key: string, raw: string) => {
    const next = raw.trim().toUpperCase() === 'REFER' ? 'REFER' : Number(raw);
    if (next === 'REFER' || Number.isFinite(next)) setRateCard('rates', { ...rates, [key]: next });
  };
  const updateAddon = (key: string, journey: keyof Addon, rule: AddonRule) => setRateCard('addons', { ...addons, [key]: { ...addons[key], [journey]: rule } });
  const updateFeeBand = (index: number, key: keyof FeeBand, value: number | null) => setAdminFees('bands', feeBands.map((band, current) => current === index ? { ...band, [key]: value } : band));

  return <div className="space-y-8">
    <section className="grid gap-3 md:grid-cols-2"><div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Travel rate-card version</p><Input aria-label="Travel rate-card version" value={typeof rateCard.version === 'string' ? rateCard.version : ''} onChange={(event) => setRateCard('version', event.target.value)} /></div><div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Admin-fee schedule version</p><Input aria-label="Travel admin-fee version" value={typeof adminFees.version === 'string' ? adminFees.version : ''} onChange={(event) => setAdminFees('version', event.target.value)} /></div></section>
    <section className="space-y-3"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Base rate cells</h3><p className="mt-1 text-xs font-semibold text-slate-500">Every plan, trip, territory, cover, duration and age-cell rate. Enter REFER for an underwriting-only cell.</p></div><div className="max-h-[34rem] overflow-auto rounded-2xl border border-slate-200"><table className="ui-table min-w-[52rem]"><thead className="ui-thead"><tr><th>Rate key</th><th>Premium / referral</th></tr></thead><tbody className="ui-tbody">{Object.entries(rates).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => <tr className="ui-row" key={key}><td className="px-3 py-2 font-mono text-xs text-slate-700">{key}</td><td><Input aria-label={`Travel rate ${key}`} value={String(value)} onChange={(event) => updateRate(key, event.target.value)} className="min-w-28 px-2 py-1.5 text-right text-xs" /></td></tr>)}</tbody></table></div></section>
    <section className="space-y-3"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Add-on pricing</h3><p className="mt-1 text-xs font-semibold text-slate-500">Each add-on is explicitly priced by trip type.</p></div><div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="ui-table min-w-[52rem]"><thead className="ui-thead"><tr><th>Add-on</th><th>Single trip</th><th>Multi trip</th></tr></thead><tbody className="ui-tbody">{Object.entries(addons).map(([key, addon]) => <tr className="ui-row" key={key}><td className="px-3 py-2 text-xs font-semibold text-slate-700">{key}</td><td><RuleEditor label={`Travel ${key} single trip`} value={addon.singleTrip} onChange={(rule) => updateAddon(key, 'singleTrip', rule)} /></td><td><RuleEditor label={`Travel ${key} multi trip`} value={addon.multiTrip} onChange={(rule) => updateAddon(key, 'multiTrip', rule)} /></td></tr>)}</tbody></table></div></section>
    <section className="grid gap-4 md:grid-cols-2"><div className="space-y-3"><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Single-trip cover multipliers</h3>{Object.entries(multipliers).map(([key, value]) => <div className="rounded-xl border border-slate-200 bg-white p-3" key={key}><p className="mb-2 text-xs font-black text-slate-700">{key}</p><NumberInput label={`Travel single-trip multiplier ${key}`} value={value} onChange={(amount) => setRateCard('singleTripCoverMultipliers', { ...multipliers, [key]: amount })} /></div>)}</div><div className="space-y-3"><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Programme loadings</h3><div className="rounded-xl border border-slate-200 bg-white p-3"><p className="mb-1 text-xs font-black text-slate-700">Underwriting profit loading</p><p className="mb-2 text-xs font-semibold text-slate-500">Applied to net premium.</p><NumberInput label="Travel underwriting profit loading rate" value={underwritingProfitRate} onChange={(rate) => setRateCard('underwritingProfitLoading', { ...underwritingProfitLoading, rate })} /></div><div className="rounded-xl border border-slate-200 bg-white p-3"><p className="mb-1 text-xs font-black text-slate-700">Prior claim loading up to €500</p><p className="mb-2 text-xs font-semibold text-slate-500">Applied to base premium. Higher prior claims are an underwriting referral.</p><NumberInput label="Travel prior claim loading up to €500 rate" value={priorClaimRate} onChange={(rate) => setRateCard('priorClaimLoading', { ...priorClaimLoading, upTo500Rate: rate })} /></div></div></section>
    <section className="space-y-3"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Admin-fee bands</h3><p className="mt-1 text-xs font-semibold text-slate-500">Thresholds are evaluated against net premium; leave the final threshold blank for the open-ended band.</p></div><div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="ui-table min-w-[32rem]"><thead className="ui-thead"><tr><th>Net premium up to</th><th>Fee</th></tr></thead><tbody className="ui-tbody">{feeBands.map((band, index) => <tr className="ui-row" key={index}><td><NumberInput label={`Travel admin fee band ${index + 1} threshold`} value={band.uptoNet} nullable onChange={(amount) => updateFeeBand(index, 'uptoNet', amount)} /></td><td><NumberInput label={`Travel admin fee band ${index + 1} fee`} value={band.fee} onChange={(amount) => updateFeeBand(index, 'fee', amount)} /></td></tr>)}</tbody></table></div></section>
  </div>;
}
