import React from 'react';
import { Checkbox, Input, Textarea } from '@/src/shared/ui';
import type { JsonObject, JsonValue } from '@/src/modules/programs/components/StructuredJsonEditor';

type Props = {
  value: JsonObject;
  onChange: (next: JsonObject) => void;
};

type Thresholds = Record<string, number>;
type ReferralFlags = Record<string, boolean>;

type ListField = {
  key: string;
  label: string;
  description: string;
};

type NumberField = {
  key: string;
  label: string;
  description: string;
};

const LIST_FIELDS: ListField[] = [
  { key: 'allowedRiskCountries', label: 'Permitted risk countries', description: 'Countries in which this programme may accept a risk.' },
  { key: 'allowedVehicleUses', label: 'Permitted vehicle uses', description: 'Vehicle uses that qualify for straight-through processing.' },
  { key: 'supportedVehicleTypeTokens', label: 'Supported vehicle types', description: 'Vehicle-type values that this programme recognises.' },
  { key: 'motorcycleAllowedVehicleUses', label: 'Motorcycle permitted uses', description: 'Vehicle uses permitted when the risk is a motorcycle.' },
  { key: 'motorcycleAllowedCoverRequired', label: 'Motorcycle permitted covers', description: 'Cover choices permitted when the risk is a motorcycle.' },
  { key: 'motorcycleDisallowedDriverRestrictions', label: 'Motorcycle restricted driver bases', description: 'Driver bases that must not be accepted for motorcycles.' },
];

const REFERRAL_FLAGS: Array<{ key: string; label: string }> = [
  { key: 'referElectricVehicles', label: 'Refer electric vehicles' },
  { key: 'referHybridVehicles', label: 'Refer hybrid vehicles' },
  { key: 'referMotorcycle', label: 'Refer motorcycles' },
  { key: 'referMotorcaravan', label: 'Refer motorhomes / motor caravans' },
];

const DECLINE_THRESHOLDS: NumberField[] = [
  { key: 'declineVehicleValueOver', label: 'Vehicle value above', description: 'Decline when insured vehicle value exceeds this amount.' },
  { key: 'declineGarageTotalValueOver', label: 'Garage total value above', description: 'Decline when total vehicles in the garage exceed this amount.' },
  { key: 'declineClaimsCountOver5Years', label: 'Claims in five years above', description: 'Decline when the claim count is above this number.' },
  { key: 'declineFaultClaimOver', label: 'Fault-claim cost above', description: 'Decline when the highest fault claim is above this amount.' },
  { key: 'declineLicenceYearsUnder', label: 'Licence years below', description: 'Decline when the driver has held a licence for fewer years.' },
  { key: 'declineAddedDriverAgeUnder', label: 'Additional-driver age below', description: 'Decline when the youngest additional driver is below this age.' },
  { key: 'declineMotorcycleRiderAgeUnder', label: 'Motorcycle rider age below', description: 'Decline when the motorcycle rider is below this age.' },
  { key: 'declineMotorcycleOverCcRequiresNcdCc', label: 'Motorcycle engine size above', description: 'Requires no-claims evidence above this engine size.' },
];

const REFERRAL_THRESHOLDS: NumberField[] = [
  { key: 'referralVehicleValueOver', label: 'Vehicle value above', description: 'Refer when insured vehicle value exceeds this amount.' },
  { key: 'referralFaultClaimOver', label: 'Fault-claim cost above', description: 'Refer when the highest fault claim is above this amount.' },
  { key: 'referralClaimsCountAtLeast', label: 'Claims in five years at least', description: 'Refer when the claim count reaches this number.' },
  { key: 'referralClaimsTotalUnder', label: 'Claims total below', description: 'Referral threshold used with the claim-count rule.' },
  { key: 'referralAddedDriverAgeMin', label: 'Additional-driver age from', description: 'Lower bound of the additional-driver referral range.' },
  { key: 'referralAddedDriverAgeMax', label: 'Additional-driver age to', description: 'Upper bound of the additional-driver referral range.' },
  { key: 'referralMotorcaravanValueOver', label: 'Motorhome value above', description: 'Refer when a motorhome / motor caravan value exceeds this amount.' },
  { key: 'referralMotorcaravanKmsOver', label: 'Motorhome annual kilometres above', description: 'Refer when declared annual mileage exceeds this number.' },
  { key: 'referralProposerAgeUnder', label: 'Proposer age below', description: 'Refer when the proposer is below this age.' },
  { key: 'referralStpAgeUnder', label: 'Straight-through age below', description: 'Refer instead of straight-through acceptance below this age.' },
  { key: 'referralStpLicenceYearsAtMost', label: 'Straight-through licence years at most', description: 'Refer when licence tenure is at or below this number of years.' },
  { key: 'referralSeatsOver', label: 'Seats above', description: 'Refer when the vehicle has more seats.' },
  { key: 'referralClassicVehicleValueOver', label: 'Classic vehicle value above', description: 'Refer when classic-vehicle value exceeds this amount.' },
  { key: 'referralSeriousTechnicalConvictionsAtLeast', label: 'Serious technical convictions at least', description: 'Refer when this count is reached.' },
];

function asStringList(value: JsonValue | undefined): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null;
}

function asRecord(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asNumberRecord(value: JsonValue | undefined): Thresholds | null {
  const record = asRecord(value);
  if (!record || Object.values(record).some((entry) => typeof entry !== 'number')) return null;
  return record as Thresholds;
}

function asBooleanRecord(value: JsonValue | undefined): ReferralFlags | null {
  const record = asRecord(value);
  if (!record || Object.values(record).some((entry) => typeof entry !== 'boolean')) return null;
  return record as ReferralFlags;
}

function splitLines(value: string): string[] {
  return value.split('\n').map((entry) => entry.trim()).filter(Boolean);
}

function ThresholdGrid({ title, fields, value, onChange }: {
  title: string;
  fields: NumberField[];
  value: Thresholds;
  onChange: (next: Thresholds) => void;
}) {
  return <section className="space-y-3">
    <div>
      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</h3>
      <p className="mt-1 text-xs font-semibold text-slate-500">Each change is checked by the Motor underwriting schema before the draft can be published.</p>
    </div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {fields.map((field) => <div className="space-y-2" key={field.key}>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{field.label}</p>
        <Input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={String(value[field.key])}
          aria-label={field.label}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange({ ...value, [field.key]: next });
          }}
        />
        <p className="text-xs font-medium text-slate-500">{field.description}</p>
      </div>)}
    </div>
  </section>;
}

/** Product-owned, typed authoring surface for the Motor underwriting component. */
export function MotorUnderwritingEditor({ value, onChange }: Props) {
  const lists = Object.fromEntries(LIST_FIELDS.map((field) => [field.key, asStringList(value[field.key])])) as Record<string, string[] | null>;
  const referralFlags = asBooleanRecord(value.referralFlags);
  const thresholds = asNumberRecord(value.thresholds);

  const hasEveryList = LIST_FIELDS.every((field) => lists[field.key] !== null);
  const hasEveryReferralFlag = referralFlags && REFERRAL_FLAGS.every((field) => typeof referralFlags[field.key] === 'boolean');
  const hasEveryThreshold = thresholds && [...DECLINE_THRESHOLDS, ...REFERRAL_THRESHOLDS].every((field) => Number.isFinite(thresholds[field.key]));

  if (!hasEveryList || !hasEveryReferralFlag || !hasEveryThreshold || !referralFlags || !thresholds) {
    return <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">This draft does not contain a complete Motor underwriting configuration. Add the complete approved configuration before editing it; the system will not copy values from a prior version or a product default.</p>;
  }

  return <div className="space-y-8">
    <section className="space-y-4">
      <div>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Eligibility and permitted values</h3>
        <p className="mt-1 text-xs font-semibold text-slate-500">One approved value per line. These values are used by the published Motor underwriting rules.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {LIST_FIELDS.map((field) => <div className="space-y-2" key={field.key}>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{field.label}</p>
          <Textarea
            rows={4}
            value={lists[field.key]!.join('\n')}
            aria-label={field.label}
            onChange={(event) => onChange({ ...value, [field.key]: splitLines(event.target.value) })}
          />
          <p className="text-xs font-medium text-slate-500">{field.description}</p>
        </div>)}
      </div>
    </section>

    <section className="space-y-3">
      <div>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Mandatory referral flags</h3>
        <p className="mt-1 text-xs font-semibold text-slate-500">Enable a flag when the approved programme requires that risk type to be referred to an underwriter.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {REFERRAL_FLAGS.map((field) => <Checkbox key={field.key} checked={referralFlags[field.key]} onChange={(event) => onChange({ ...value, referralFlags: { ...referralFlags, [field.key]: event.target.checked } })} label={field.label} />)}
      </div>
    </section>

    <ThresholdGrid title="Decline thresholds" fields={DECLINE_THRESHOLDS} value={thresholds} onChange={(next) => onChange({ ...value, thresholds: next })} />
    <ThresholdGrid title="Referral thresholds" fields={REFERRAL_THRESHOLDS} value={thresholds} onChange={(next) => onChange({ ...value, thresholds: next })} />
  </div>;
}
