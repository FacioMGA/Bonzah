import React from 'react';
import { Input } from '@/src/shared/ui';
import type { JsonObject, JsonValue } from '@/src/modules/programs/components/StructuredJsonEditor';

type Props = { tables: JsonObject; onChange: (next: JsonObject) => void };
type RateBlock = { buildings: number; contents: number; jewellery: number | null; otherAllRisks: number | null };
type WorkbookBlock = { buildingsBase: number; buildingsOver: number; buildingsAd: number | null; contentsBase: number; contentsOver: number; contentsAd: number | null; jewellery: number | null; otherAllRisks: number | null; solar: number };

const PROPERTY_USES = ['Permanent', 'Holiday'] as const;
const RATE_BRACKETS = ['small', 'largeNoAd', 'smallWithAd'] as const;
const RATE_BLOCK_FIELDS = ['buildings', 'contents', 'jewellery', 'otherAllRisks'] as const;
const WORKBOOK_FIELDS = ['buildingsBase', 'buildingsOver', 'buildingsAd', 'contentsBase', 'contentsOver', 'contentsAd', 'jewellery', 'otherAllRisks', 'solar'] as const;

function asRecord(value: JsonValue | undefined): JsonObject | null { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function asNumberRecord(value: JsonValue | undefined): Record<string, number> | null {
  const record = asRecord(value); if (!record || Object.values(record).some((entry) => typeof entry !== 'number')) return null;
  return record as Record<string, number>;
}
function asStringArray(value: JsonValue | undefined): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null;
}
function asRateBlock(value: JsonValue | undefined): RateBlock | null {
  const record = asRecord(value); if (!record) return null;
  if (typeof record.buildings !== 'number' || typeof record.contents !== 'number' || (record.jewellery !== null && typeof record.jewellery !== 'number') || (record.otherAllRisks !== null && typeof record.otherAllRisks !== 'number')) return null;
  return record as RateBlock;
}
function asWorkbookBlock(value: JsonValue | undefined): WorkbookBlock | null {
  const record = asRecord(value); if (!record) return null;
  if (WORKBOOK_FIELDS.some((key) => !(typeof record[key] === 'number' || record[key] === null))) return null;
  return record as WorkbookBlock;
}
function MoneyInput({ label, value, nullable = false, onChange }: { label: string; value: number | null; nullable?: boolean; onChange: (next: number | null) => void }) {
  return <Input type="number" min="0" step="0.0001" inputMode="decimal" aria-label={label} value={value === null ? '' : String(value)} onChange={(event) => { const raw = event.target.value; if (nullable && raw === '') return onChange(null); const next = Number(raw); if (Number.isFinite(next)) onChange(next); }} className="min-w-20 px-2 py-1.5 text-right text-xs" />;
}
function StringListInput({ label, value, onChange }: { label: string; value: string[]; onChange: (next: string[]) => void }) {
  return <Input aria-label={label} value={value.join(', ')} onChange={(event) => onChange(event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean))} />;
}
function NumberRecordTable({ title, description, values, onChange }: { title: string; description: string; values: Record<string, number>; onChange: (key: string, amount: number) => void }) {
  return <section className="space-y-3"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</h3><p className="mt-1 text-xs font-semibold text-slate-500">{description}</p></div><div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="ui-table min-w-[32rem]"><thead className="ui-thead"><tr><th>Setting</th><th>Value</th></tr></thead><tbody className="ui-tbody">{Object.entries(values).map(([key, amount]) => <tr className="ui-row" key={key}><td className="px-3 py-2 text-xs font-semibold text-slate-700">{key}</td><td><MoneyInput label={`${title} ${key}`} value={amount} onChange={(next) => onChange(key, next || 0)} /></td></tr>)}</tbody></table></div></section>;
}
function RateBlockTable({ title, block, onChange }: { title: string; block: RateBlock; onChange: (key: keyof RateBlock, value: number | null) => void }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="mb-2 text-xs font-black text-slate-700">{title}</p><div className="grid grid-cols-2 gap-2 md:grid-cols-4">{RATE_BLOCK_FIELDS.map((key) => <div key={key}><p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">{key}</p><MoneyInput label={`${title} ${key}`} value={block[key]} nullable={key === 'jewellery' || key === 'otherAllRisks'} onChange={(value) => onChange(key, value)} /></div>)}</div></div>;
}
function WorkbookTable({ title, block, onChange }: { title: string; block: WorkbookBlock; onChange: (key: keyof WorkbookBlock, value: number | null) => void }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="mb-2 text-xs font-black text-slate-700">{title}</p><div className="grid grid-cols-2 gap-2 md:grid-cols-3">{WORKBOOK_FIELDS.map((key) => <div key={key}><p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">{key}</p><MoneyInput label={`${title} ${key}`} value={block[key]} nullable={key.endsWith('Ad') || key === 'jewellery' || key === 'otherAllRisks'} onChange={(value) => onChange(key, value)} /></div>)}</div></div>;
}

/** Product-owned authoring surface for the complete Home rating-model schema. */
export function HomeRatingModelEditor({ tables, onChange }: Props) {
  const rateCards = asRecord(tables.rateCards);
  const workbook = asRecord(tables.workbook);
  const countryBaseLoading = asNumberRecord(tables.countryBaseLoading);
  const pricingRules = asRecord(tables.pricingRules);
  const propertyAgeDiscounts = pricingRules ? asNumberRecord(pricingRules.propertyAgeDiscounts) : null;
  const noClaimsDiscounts = pricingRules ? asNumberRecord(pricingRules.noClaimsDiscounts) : null;
  const increasedExcessDiscounts = pricingRules ? asNumberRecord(pricingRules.increasedExcessDiscounts) : null;
  const previousClaimsLoadings = pricingRules ? asNumberRecord(pricingRules.previousClaimsLoadings) : null;
  const greekPostcodeLoading = pricingRules ? asRecord(pricingRules.greekPostcodeLoading) : null;
  const greekPostcodes = greekPostcodeLoading ? asStringArray(greekPostcodeLoading.postcodes) : null;
  const europAssistance = pricingRules ? asRecord(pricingRules.europAssistance) : null;
  const europCountryCodes = europAssistance ? asStringArray(europAssistance.countryCodes) : null;
  if (!rateCards || !workbook || !countryBaseLoading || !pricingRules || !propertyAgeDiscounts || !noClaimsDiscounts || !increasedExcessDiscounts || !previousClaimsLoadings || !greekPostcodeLoading || !greekPostcodes || !europAssistance || !europCountryCodes) return <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">This draft does not contain a complete Home rating model. Supply every approved rate card, workbook, loading and pricing rule before saving; no asset or previous version is used at runtime.</p>;
  const updateTop = (key: string, value: JsonValue) => onChange({ ...tables, [key]: value });
  const updateRateBlock = (country: string, use: string, bracket: string, key: keyof RateBlock, value: number | null) => {
    const countryCard = asRecord(rateCards[country])!; const useCard = asRecord(countryCard[use])!; const block = asRateBlock(useCard[bracket])!;
    updateTop('rateCards', { ...rateCards, [country]: { ...countryCard, [use]: { ...useCard, [bracket]: { ...block, [key]: value } } } });
  };
  const updateWorkbook = (country: string, use: string, key: keyof WorkbookBlock, value: number | null) => {
    const countryBook = asRecord(workbook[country])!; const block = asWorkbookBlock(countryBook[use])!;
    updateTop('workbook', { ...workbook, [country]: { ...countryBook, [use]: { ...block, [key]: value } } });
  };
  const updateNumberRecord = (key: string, values: Record<string, number>, entry: string, amount: number) => updateTop(key, { ...values, [entry]: amount });
  const updatePricingRecord = (key: string, values: Record<string, number>, entry: string, amount: number) => updateTop('pricingRules', { ...pricingRules, [key]: { ...values, [entry]: amount } });
  const updatePricingValue = (key: string, amount: number) => updateTop('pricingRules', { ...pricingRules, [key]: amount });

  return <div className="space-y-8">
    <section className="space-y-3"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Approved rate source</h3><p className="mt-1 text-xs font-semibold text-slate-500">Record the versioned source before publishing this Home model.</p></div><div className="grid gap-3 md:grid-cols-2">{(['vintage', 'source'] as const).map((key) => <div key={key} className="space-y-2"><p className="text-xs font-black text-slate-700">{key === 'vintage' ? 'Rate-card vintage' : 'Source reference'}</p><Input aria-label={`Home ${key}`} value={typeof tables[key] === 'string' ? tables[key] : ''} onChange={(event) => updateTop(key, event.target.value)} /></div>)}</div></section>
    <section className="space-y-3"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Country rate cards</h3><p className="mt-1 text-xs font-semibold text-slate-500">Base premium rates by territory, property use and insured-value bracket.</p></div>{Object.keys(rateCards).map((country) => <div key={country} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-black text-slate-800">{country}</p>{PROPERTY_USES.map((use) => { const useCard = asRecord(asRecord(rateCards[country])?.[use]); return useCard ? <div key={use} className="space-y-2"><p className="text-xs font-black text-slate-700">{use}</p><div className="grid gap-3 xl:grid-cols-3">{RATE_BRACKETS.map((bracket) => { const block = asRateBlock(useCard[bracket]); return block ? <RateBlockTable key={bracket} title={`${country} ${use} ${bracket}`} block={block} onChange={(key, value) => updateRateBlock(country, use, bracket, key, value)} /> : null; })}</div></div> : null; })}</div>)}</section>
    <section className="space-y-3"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Workbook rates</h3><p className="mt-1 text-xs font-semibold text-slate-500">Detailed Home rate inputs by country and property use.</p></div>{Object.keys(workbook).map((country) => <div key={country} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-black text-slate-800">{country}</p><div className="grid gap-3 xl:grid-cols-2">{PROPERTY_USES.map((use) => { const block = asWorkbookBlock(asRecord(workbook[country])?.[use]); return block ? <WorkbookTable key={use} title={use} block={block} onChange={(key, value) => updateWorkbook(country, use, key, value)} /> : null; })}</div></div>)}</section>
    <section className="grid gap-4 md:grid-cols-3"><div className="rounded-xl border border-slate-200 bg-white p-3"><p className="mb-2 text-xs font-black text-slate-700">Minimum premium</p><MoneyInput label="Home minimum premium" value={typeof tables.minPremium === 'number' ? tables.minPremium : 0} onChange={(amount) => updateTop('minPremium', amount)} /></div>{(['underwritingProfitLoading', 'wildfireLoading'] as const).map((key) => <div key={key} className="rounded-xl border border-slate-200 bg-white p-3"><p className="mb-2 text-xs font-black text-slate-700">{key}</p>{Object.entries(asRecord(tables[key]) || {}).map(([field, value]) => typeof value === 'number' ? <div key={field} className="mb-2"><p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">{field}</p><MoneyInput label={`Home ${key} ${field}`} value={value} onChange={(amount) => updateTop(key, { ...(asRecord(tables[key]) || {}), [field]: amount })} /></div> : null)}</div>)}</section>
    <NumberRecordTable title="Country base loadings" description="Territory-specific additions to the base premium." values={countryBaseLoading} onChange={(entry, amount) => updateNumberRecord('countryBaseLoading', countryBaseLoading, entry, amount)} />
    <NumberRecordTable title="Property age discounts" description="Discount factors by configured property-age band." values={propertyAgeDiscounts} onChange={(entry, amount) => updatePricingRecord('propertyAgeDiscounts', propertyAgeDiscounts, entry, amount)} />
    <NumberRecordTable title="No-claims discounts" description="Discount factors by no-claims band." values={noClaimsDiscounts} onChange={(entry, amount) => updatePricingRecord('noClaimsDiscounts', noClaimsDiscounts, entry, amount)} />
    <NumberRecordTable title="Increased-excess discounts" description="Discount factors for higher customer-selected excess." values={increasedExcessDiscounts} onChange={(entry, amount) => updatePricingRecord('increasedExcessDiscounts', increasedExcessDiscounts, entry, amount)} />
    <NumberRecordTable title="Previous-claims loadings" description="Loadings for prior-claims history." values={previousClaimsLoadings} onChange={(entry, amount) => updatePricingRecord('previousClaimsLoadings', previousClaimsLoadings, entry, amount)} />
    <section className="grid gap-3 md:grid-cols-3">{(['combustibleConstructionLoading', 'staticCaravanLoading', 'alarmDiscount', 'proposerOver45Discount', 'discretionaryDiscountCap'] as const).map((key) => <div key={key} className="rounded-xl border border-slate-200 bg-white p-3"><p className="mb-2 text-xs font-black text-slate-700">{key}</p><MoneyInput label={`Home ${key}`} value={typeof pricingRules[key] === 'number' ? pricingRules[key] as number : 0} onChange={(amount) => updatePricingValue(key, amount ?? 0)} /></div>)}</section>
    <section className="grid gap-3 md:grid-cols-2"><div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3"><div><p className="text-xs font-black text-slate-700">Greek postcode loading</p><p className="mt-1 text-xs font-semibold text-slate-500">Comma-separated postcodes to which this loading applies.</p></div><StringListInput label="Home Greek loading postcodes" value={greekPostcodes} onChange={(postcodes) => updateTop('pricingRules', { ...pricingRules, greekPostcodeLoading: { ...greekPostcodeLoading, postcodes } })} /><MoneyInput label="Home Greek postcode loading rate" value={typeof greekPostcodeLoading.rate === 'number' ? greekPostcodeLoading.rate : 0} onChange={(rate) => updateTop('pricingRules', { ...pricingRules, greekPostcodeLoading: { ...greekPostcodeLoading, rate } })} /></div><div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3"><div><p className="text-xs font-black text-slate-700">Europ Assistance</p><p className="mt-1 text-xs font-semibold text-slate-500">Country codes for which the configured assistance fee applies.</p></div><StringListInput label="Home Europ Assistance country codes" value={europCountryCodes} onChange={(countryCodes) => updateTop('pricingRules', { ...pricingRules, europAssistance: { ...europAssistance, countryCodes } })} /><MoneyInput label="Home Europ Assistance fee" value={typeof europAssistance.fee === 'number' ? europAssistance.fee : 0} onChange={(fee) => updateTop('pricingRules', { ...pricingRules, europAssistance: { ...europAssistance, fee } })} /></div></section>
  </div>;
}
