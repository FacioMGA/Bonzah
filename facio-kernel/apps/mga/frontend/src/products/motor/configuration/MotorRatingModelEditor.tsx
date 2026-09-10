import React from 'react';
import { Button, Input } from '@/src/shared/ui';
import { StructuredJsonEditor, type JsonObject, type JsonValue } from '@/src/modules/programs/components/StructuredJsonEditor';
import type { PricingStage } from '@/src/modules/programs/model/programs';

type NumberBand = { label: string; min: number; max: number | null; factor: number };

const CLASSIC_RATE_GROUPS = ['1', '2', '3', '4', '5', '5+'] as const;
const CLASSIC_MILEAGE_BANDS = ['0-1500', '1501-3000', '3001-5000'] as const;
const CLASSIC_AGE_BANDS = ['10-20', '20+'] as const;

type MotorRatingModelEditorProps = {
  tables: JsonObject;
  onChange: (next: JsonObject) => void;
  stages: PricingStage[];
  onStagesChange: (next: PricingStage[]) => void;
  ratingPipeline?: Array<{ operator: string; label: string }>;
};

function asRecord(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asNumbers(value: JsonValue | undefined): number[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number') ? value as number[] : null;
}

function asStrings(value: JsonValue | undefined): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value as string[] : null;
}

function asGrid(value: JsonValue | undefined): number[][] | null {
  return Array.isArray(value) && value.every((row) => asNumbers(row) !== null) ? value as number[][] : null;
}

function asNumberBands(value: JsonValue | undefined): NumberBand[] | null {
  if (!Array.isArray(value)) return null;
  const bands = value.map((entry) => asRecord(entry));
  if (bands.some((entry) => !entry)) return null;
  return bands.map((entry) => ({
    label: typeof entry!.label === 'string' ? entry!.label : '',
    min: typeof entry!.min === 'number' ? entry!.min : Number.NaN,
    max: typeof entry!.max === 'number' || entry!.max === null ? entry!.max as number | null : Number.NaN,
    factor: typeof entry!.factor === 'number' ? entry!.factor : Number.NaN,
  }));
}

function updateRecord(root: JsonObject, key: string, value: JsonValue): JsonObject {
  return { ...root, [key]: value };
}

function numberFromInput(value: string): number {
  return Number(value);
}

function MoneyInput({ value, onChange, label }: { value: number; onChange: (next: number) => void; label: string }) {
  return <Input
    type="number"
    min="0"
    step="0.01"
    inputMode="decimal"
    aria-label={label}
    value={String(value)}
    onChange={(event) => {
      const next = numberFromInput(event.target.value);
      if (Number.isFinite(next)) onChange(next);
    }}
    className="min-w-20 px-2 py-1.5 text-right text-xs"
  />;
}

function NumberBandTable({
  title,
  bands,
  onChange,
}: {
  title: string;
  bands: NumberBand[];
  onChange: (next: NumberBand[]) => void;
}) {
  const update = (index: number, field: keyof NumberBand, value: string) => {
    const next = bands.map((band, rowIndex) => {
      if (rowIndex !== index) return band;
      if (field === 'label') return { ...band, label: value };
      if (field === 'max' && value === '') return { ...band, max: null };
      return { ...band, [field]: numberFromInput(value) };
    });
    onChange(next);
  };

  return <section className="space-y-3">
    <div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</h3><p className="mt-1 text-xs font-semibold text-slate-500">Edit the band boundaries and multiplier used by the approved Motor model.</p></div>
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="ui-table min-w-[44rem]">
        <thead className="ui-thead"><tr><th>Label</th><th>Minimum</th><th>Maximum</th><th>Factor</th><th aria-label="Remove row" /></tr></thead>
        <tbody className="ui-tbody">
          {bands.map((band, index) => <tr className="ui-row" key={`${title}-${index}`}>
            <td><Input aria-label={`${title} ${index + 1} label`} value={band.label} onChange={(event) => update(index, 'label', event.target.value)} className="min-w-48 px-2 py-1.5 text-xs" /></td>
            <td><MoneyInput label={`${title} ${index + 1} minimum`} value={band.min} onChange={(value) => update(index, 'min', String(value))} /></td>
            <td><Input type="number" inputMode="decimal" aria-label={`${title} ${index + 1} maximum`} value={band.max === null ? '' : String(band.max)} onChange={(event) => update(index, 'max', event.target.value)} placeholder="No limit" className="min-w-24 px-2 py-1.5 text-right text-xs" /></td>
            <td><MoneyInput label={`${title} ${index + 1} factor`} value={band.factor} onChange={(value) => update(index, 'factor', String(value))} /></td>
            <td><Button type="button" variant="ghost" size="sm" onClick={() => onChange(bands.filter((_, rowIndex) => rowIndex !== index))}>Remove</Button></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...bands, { label: '', min: 0, max: null, factor: 1 }])}>Add band</Button>
  </section>;
}

function ClassicRateTable({
  title,
  description,
  rows,
  onChange,
}: {
  title: string;
  description: string;
  rows: Array<{ key: string; label: string; values: JsonObject }>;
  onChange: (rowKey: string, group: string, value: number) => void;
}) {
  return <section className="space-y-3">
    <div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</h3><p className="mt-1 text-xs font-semibold text-slate-500">{description}</p></div>
    <div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="ui-table min-w-[46rem]"><thead className="ui-thead"><tr><th>Band</th>{CLASSIC_RATE_GROUPS.map((group) => <th key={group}>Group {group}</th>)}</tr></thead><tbody className="ui-tbody">{rows.map((row) => <tr className="ui-row" key={row.key}><td className="px-3 py-2 text-xs font-semibold text-slate-700">{row.label}</td>{CLASSIC_RATE_GROUPS.map((group) => <td key={group}><MoneyInput label={`${title} ${row.label} group ${group}`} value={typeof row.values[group] === 'number' ? row.values[group] as number : 0} onChange={(next) => onChange(row.key, group, next)} /></td>)}</tr>)}</tbody></table></div>
  </section>;
}

/** Product-owned, typed authoring surface for the Motor pricing component. */
export function MotorRatingModelEditor({ tables, onChange, stages, onStagesChange, ratingPipeline }: MotorRatingModelEditorProps) {
  const baseMatrix = asRecord(tables.baseMatrix);
  const factors = asRecord(tables.factors);
  const vehicleValueBands = baseMatrix ? asNumbers(baseMatrix.vehicleValueBands) : null;
  const engineSizeBands = baseMatrix ? asStrings(baseMatrix.engineSizeBands) : null;
  const values = baseMatrix ? asGrid(baseMatrix.values) : null;
  const excessBands = baseMatrix ? asStrings(baseMatrix.basePolicyExcessEngineSizeBands) : null;
  const excessValues = baseMatrix ? asNumbers(baseMatrix.basePolicyExcessByEngineBand) : null;
  const classicRates = asRecord(tables.classicRates);
  const classicPremiumByMileageBand = classicRates ? asRecord(classicRates.premiumByMileageBand) : null;
  const classicPolicyExcessByAgeBand = classicRates ? asRecord(classicRates.policyExcessByAgeBand) : null;
  const classic = asRecord(tables.classic);

  if (!baseMatrix || !factors || !vehicleValueBands || !engineSizeBands || !values || !excessBands || !excessValues) {
    return <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">This draft does not contain a complete Motor rating model. Correct the model structure before editing it; the system will not load a file or another version as a fallback.</p>;
  }
  if (values.length !== engineSizeBands.length || values.some((row) => row.length !== vehicleValueBands.length)) {
    return <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">The base-matrix rows and columns do not match their configured bands. Save is blocked until the model is complete.</p>;
  }

  const replaceBaseMatrix = (next: JsonObject) => onChange(updateRecord(tables, 'baseMatrix', next));
  const replaceFactors = (next: JsonObject) => onChange(updateRecord(tables, 'factors', next));
  const updateBaseCell = (rowIndex: number, columnIndex: number, amount: number) => {
    const nextValues = values.map((row, currentRow) => currentRow === rowIndex ? row.map((entry, currentColumn) => currentColumn === columnIndex ? amount : entry) : row);
    replaceBaseMatrix(updateRecord(baseMatrix, 'values', nextValues));
  };
  const updateExcess = (index: number, amount: number) => {
    replaceBaseMatrix(updateRecord(baseMatrix, 'basePolicyExcessByEngineBand', excessValues.map((entry, currentIndex) => currentIndex === index ? amount : entry)));
  };
  const replaceFactorBands = (key: string, next: NumberBand[]) => {
    replaceFactors(updateRecord(factors, key, next.map((band) => ({ ...band }))));
  };
  const updateClassicRate = (table: 'premiumByMileageBand' | 'policyExcessByAgeBand', band: string, group: string, amount: number) => {
    if (!classicRates) return;
    const source = table === 'premiumByMileageBand' ? classicPremiumByMileageBand : classicPolicyExcessByAgeBand;
    const currentBand = source ? asRecord(source[band]) : null;
    if (!source || !currentBand) return;
    const nextTable = { ...source, [band]: { ...currentBand, [group]: amount } };
    onChange(updateRecord(tables, 'classicRates', { ...classicRates, [table]: nextTable }));
  };
  const updateClassicExcessPct = (amount: number) => {
    if (!classic) return;
    onChange(updateRecord(tables, 'classic', { ...classic, excessPctOfValue: amount }));
  };
  const otherMotorSettings = Object.fromEntries(Object.entries(tables).filter(([key]) => ![
    'baseMatrix', 'factors', 'classicRates', 'classic',
  ].includes(key))) as JsonObject;
  const replaceOtherMotorSettings = (next: JsonObject) => {
    const merged = { ...tables };
    Object.keys(otherMotorSettings).forEach((key) => delete merged[key]);
    onChange({ ...merged, ...next });
  };

  return <div className="space-y-8">
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Executable rating pipeline</h3><p className="mt-1 text-xs font-semibold text-slate-500">This is the product-owned calculation order. It is validated by the Motor engine; it is not a draggable display.</p></div>
      {!ratingPipeline ? <p className="text-xs font-semibold text-rose-700">The product did not supply a rating-pipeline descriptor. This model cannot be published.</p> : ratingPipeline.length === 0 ? <p className="text-xs font-semibold text-rose-700">The product supplied an empty rating-pipeline descriptor. This model cannot be published.</p> : <>
        <ol className="grid gap-2 md:grid-cols-2">{ratingPipeline.map((stage, index) => <li key={stage.operator} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"><span className="mr-2 font-black text-slate-400">{index + 1}.</span>{stage.label}</li>)}</ol>
        <Button type="button" variant="secondary" size="sm" onClick={() => onStagesChange(ratingPipeline.map((stage) => ({ id: stage.operator, operator: stage.operator })))}>Apply validated Motor pipeline</Button>
        {stages.length > 0 ? <p className="text-xs font-semibold text-emerald-700">Draft contains {stages.length} configured pipeline steps. The server verifies their operator order before publication.</p> : <p className="text-xs font-semibold text-amber-700">No pipeline has been selected for this draft yet.</p>}
      </>}
    </section>
    <section className="space-y-3">
      <div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Base premium matrix</h3><p className="mt-1 text-xs font-semibold text-slate-500">Each cell is the configured base premium for the selected engine-size and vehicle-value bands.</p></div>
      <div className="overflow-auto rounded-2xl border border-slate-200">
        <table className="ui-table min-w-max">
          <thead className="ui-thead"><tr><th>Engine size</th>{vehicleValueBands.map((band) => <th key={band}>€{band.toLocaleString()}</th>)}</tr></thead>
          <tbody className="ui-tbody">{engineSizeBands.map((engineBand, rowIndex) => <tr className="ui-row" key={engineBand}><th scope="row" className="whitespace-nowrap px-3 py-2 text-left text-xs font-black text-slate-700">{engineBand}</th>{values[rowIndex].map((amount, columnIndex) => <td key={`${engineBand}-${vehicleValueBands[columnIndex]}`}><MoneyInput label={`${engineBand}, €${vehicleValueBands[columnIndex].toLocaleString()}`} value={amount} onChange={(next) => updateBaseCell(rowIndex, columnIndex, next)} /></td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className="space-y-3">
      <div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Compulsory base excess</h3><p className="mt-1 text-xs font-semibold text-slate-500">This is the minimum policy excess by engine-size band.</p></div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="ui-table min-w-[34rem]"><thead className="ui-thead"><tr><th>Engine size</th><th>Minimum excess</th></tr></thead><tbody className="ui-tbody">{excessBands.map((band, index) => <tr className="ui-row" key={band}><td className="px-3 py-2 text-xs font-semibold text-slate-700">{band}</td><td><MoneyInput label={`${band} minimum excess`} value={excessValues[index]} onChange={(next) => updateExcess(index, next)} /></td></tr>)}</tbody></table></div>
    </section>

    {['proposerAge', 'vehicleAge', 'licencePeriod', 'addedDriversUnder25'].map((key) => {
      const bands = asNumberBands(factors[key]);
      return bands ? <NumberBandTable key={key} title={key.replace(/([A-Z])/g, ' $1').trim()} bands={bands} onChange={(next) => replaceFactorBands(key, next)} /> : null;
    })}

    {classicPremiumByMileageBand && classicPolicyExcessByAgeBand ? <>
      <ClassicRateTable title="Classic base premium" description="Own-damage base premium by annual mileage and classic vehicle group." rows={CLASSIC_MILEAGE_BANDS.map((band) => ({ key: band, label: `${band} km`, values: asRecord(classicPremiumByMileageBand[band]) || {} }))} onChange={(band, group, amount) => updateClassicRate('premiumByMileageBand', band, group, amount)} />
      <ClassicRateTable title="Classic policy excess" description="Compulsory policy excess by proposer age band and classic vehicle group." rows={CLASSIC_AGE_BANDS.map((band) => ({ key: band, label: `Age ${band}`, values: asRecord(classicPolicyExcessByAgeBand[band]) || {} }))} onChange={(band, group, amount) => updateClassicRate('policyExcessByAgeBand', band, group, amount)} />
      {classic && typeof classic.excessPctOfValue === 'number' ? <section className="space-y-2"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Classic value-based excess</h3><p className="mt-1 text-xs font-semibold text-slate-500">The policy uses the higher of the age/group excess and this percentage of vehicle value.</p></div><MoneyInput label="Classic excess percentage of vehicle value" value={classic.excessPctOfValue as number} onChange={updateClassicExcessPct} /></section> : null}
    </> : <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">Classic rate tables are missing or incomplete. This Motor model cannot be published until they are supplied.</p>}

    <StructuredJsonEditor label="Additional Motor pricing settings" description="Motorcycle, motorcaravan, fees, discounts and other product-owned rating tables. Changes are validated before this draft can be published." value={otherMotorSettings} onChange={(next) => replaceOtherMotorSettings(asRecord(next) || otherMotorSettings)} />
  </div>;
}
