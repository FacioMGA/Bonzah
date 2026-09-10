import { useEffect } from 'react';
import { QuoteData, type MotorConvictionEntry } from '../../types';
import { Controller, useFormContext, type FieldErrors } from 'react-hook-form';
import { countries, MOTOR_WHERE_DID_YOU_HEAR_OPTIONS, requiresForeignLicenceConfirmation } from '@facio/products';
import { FormField } from '@/src/shared/ui';
import { WizardInput as Input } from '@/src/shared/ui';
import { WizardSelect as Select } from '@/src/shared/ui';
import { WizardSearchableSelect as SearchableSelect } from '@/src/shared/ui';
import { WizardTextarea as Textarea } from '@/src/shared/ui';
import { RadioGroup } from '@/src/shared/ui';
import { Checkbox } from '@/src/shared/ui';
import { SectionCard } from '@/src/shared/ui';
import { AlertTriangle, Car, Users, User } from 'lucide-react';
import { selectQuestionnaireFieldOptions } from '@/src/shared/lib/products/questionnaireFromProfile';
import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';
import { getOperatingCountryName } from '@/src/shared/lib/tenant/operatingCountry';
// Step uses react-hook-form via <FormProvider /> in App.tsx.

const licenseTypeOptions = [
  { value: '', label: 'Please Select' },
  { value: 'Full', label: 'Full' },
  { value: 'Provisional', label: 'Provisional' },
];

const priorityCountries = ['United Kingdom', 'Cyprus', 'Portugal', 'Spain'];
const otherCountries = countries.filter(c => !priorityCountries.includes(c));

const licenseIssuedInOptions = [
  { value: '', label: 'Select...' },
  ...priorityCountries.map(c => ({ value: c, label: c })),
  { value: 'Other EU', label: 'Other EU' },
  ...otherCountries.map(c => ({ value: c, label: c })),
];

const whereDidYouHearOptions = [
  { value: '', label: 'Please Select' },
  ...MOTOR_WHERE_DID_YOU_HEAR_OPTIONS,
];

const convictionTypeOptions = [
  { value: '', label: 'Select conviction type' },
  ...selectQuestionnaireFieldOptions('MOTOR', 'convictionClass').map((option) => ({
    value: option.value,
    label: option.label
      .replace(' (no load)', '')
      .replace(' (10 points)', '')
      .replace(' (22.5 points)', '')
      .replace(' (15 points)', ''),
  })),
];

const CONVICTION_SEVERITY: Record<string, number> = {
  minor_technical: 1,
  minor_offence_10: 2,
  minor_offence_225: 3,
  serious_technical: 4,
  major: 5,
  other: 0,
};

function convictionTypeLabel(value: string): string {
  return convictionTypeOptions.find((option) => option.value === value)?.label || value;
}

function yearsAgoBucket(date: string): 2 | 3 | 5 {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return 5;
  const today = new Date();
  let years = today.getFullYear() - parsed.getFullYear();
  const monthDiff = today.getMonth() - parsed.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < parsed.getDate())) years -= 1;
  if (years <= 2) return 2;
  if (years <= 3) return 3;
  return 5;
}

function buildConvictionsSummary(rows: MotorConvictionEntry[]): string {
  return rows
    .filter((row) => row.date || row.convictionClass || row.description)
    .map((row, index) => {
      const parts = [
        `#${index + 1}`,
        row.date ? `date: ${row.date}` : '',
        row.convictionClass ? `type: ${convictionTypeLabel(row.convictionClass)}` : '',
        row.description ? `details: ${row.description.trim()}` : '',
      ].filter(Boolean);
      return parts.join(' — ');
    })
    .join('\n');
}

function deriveConvictionFields(rows: MotorConvictionEntry[]) {
  const typedRows = rows.filter((row) => String(row.convictionClass || '').trim());
  const highest = typedRows.reduce<MotorConvictionEntry | null>((best, row) => {
    if (!best) return row;
    const current = CONVICTION_SEVERITY[row.convictionClass || ''] ?? 0;
    const previous = CONVICTION_SEVERITY[best.convictionClass || ''] ?? 0;
    return current > previous ? row : best;
  }, null);
  const majorRows = typedRows.filter((row) => row.convictionClass === 'major');
  const seriousTechnicalCount = typedRows.filter((row) => row.convictionClass === 'serious_technical').length;
  const majorWithin = majorRows.length > 0 ? Math.min(...majorRows.map((row) => yearsAgoBucket(row.date || ''))) : '';
  return {
    convictionClass: highest?.convictionClass || '',
    hasMajorConvictionLast5Years: majorRows.length > 0,
    majorConvictionWithinYears: majorWithin,
    majorConvictionsCountLast5Years: majorRows.length,
    seriousTechnicalOffenceCount: seriousTechnicalCount,
    convictionsDetails: buildConvictionsSummary(rows),
  };
}

export function Step2DrivingHistory() {
  const { register, control, watch, setValue, formState } = useFormContext<QuoteData>();
  const data = watch();
  // ABY-324 — a motorbike can only be insured-only (policyholder) or on a
  // named-driver basis; the open "any driver" coverage modes are not
  // available on the motorcycle scheme.
  const isMotorcycle = (() => {
    const vt = String(data.vehicleType || '').toLowerCase();
    return vt.includes('motorbike') || vt.includes('motorcycle');
  })();
  const driverRestrictionOptions = [
    { value: '', label: 'Please select…' },
    { value: 'POLICYHOLDER_ONLY', label: 'Policy Holder' },
    { value: 'NAMED_DRIVERS', label: 'Named Drivers Only' },
    ...(isMotorcycle
      ? []
      : [
          { value: 'ANY_DRIVER_25_PLUS', label: 'Any Driver Over 25' },
          { value: 'ANY_DRIVER_40_PLUS', label: 'Any Driver Over 40' },
        ]),
  ];
  const hasNamedAdditionalDrivers = Array.isArray(data.additionalDrivers) && data.additionalDrivers.length > 0;
  // Clear an open-driver restriction that is no longer offered once the
  // risk becomes a motorbike, so a stale ANY_DRIVER_* value from a car
  // selection can't persist into pricing / documents.
  useEffect(() => {
    if (!isMotorcycle) return;
    const restriction = data.driverRestriction;
    if (restriction === 'ANY_DRIVER_25_PLUS' || restriction === 'ANY_DRIVER_40_PLUS') {
      setValue('driverRestriction', null, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
    }
  }, [isMotorcycle, data.driverRestriction, setValue]);
  const convictionRows = Array.isArray(data.motorConvictions) ? data.motorConvictions : [];
  const errors = formState.errors as FieldErrors<QuoteData>;
  const err = (k: keyof QuoteData | string) =>
    getNestedError(errors as Record<string, unknown>, String(k));
  const claimsCount = Number(data.claimsCountLast5Years);
  const claimsCountValid = Number.isFinite(claimsCount) && claimsCount > 0;
  const syncConvictionRows = (rows: MotorConvictionEntry[]) => {
    const normalized = rows.map((row) => ({
      id: row.id || `conviction-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      date: String(row.date || ''),
      convictionClass: String(row.convictionClass || ''),
      description: String(row.description || ''),
    }));
    const derived = deriveConvictionFields(normalized);
    setValue('motorConvictions', normalized, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
    setValue('convictionClass', derived.convictionClass, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
    setValue('hasMajorConvictionLast5Years', derived.hasMajorConvictionLast5Years, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
    setValue('majorConvictionWithinYears', derived.majorConvictionWithinYears, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
    setValue('convictionsDetails', derived.convictionsDetails, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
    setValue('majorConvictionsCountLast5Years', derived.majorConvictionsCountLast5Years, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
    setValue('seriousTechnicalOffenceCount', derived.seriousTechnicalOffenceCount, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
  };

  const updateConvictionRow = (index: number, patch: Partial<MotorConvictionEntry>) => {
    const next = convictionRows.map((row, idx) => idx === index ? { ...row, ...patch } : row);
    syncConvictionRows(next);
  };

  const addConvictionRow = () => {
    syncConvictionRows([
      ...convictionRows,
      { id: `conviction-${Date.now()}`, date: '', convictionClass: '', description: '' },
    ]);
  };

  const removeConvictionRow = (index: number) => {
    syncConvictionRows(convictionRows.filter((_, idx) => idx !== index));
  };

  return (
    <div className="max-w-4xl mx-auto px-5 py-2">
      <SectionCard title="Licence Details" icon={<Car className="w-6 h-6" />}>
        <FormField label="License Held – Number of Years" required error={err('licenseYears')} fieldKey="licenseYears">
          <Input
            type="number"
            min={0}
            max={60}
            inputMode="numeric"
            {...register('licenseYears', {
              setValueAs: (v) => (v === '' ? '' : parseInt(String(v), 10)),
            })}
            error={!!err('licenseYears')}
            showValid
            placeholder="e.g. 12"
          />
        </FormField>

        <FormField label="License Type" required error={err('licenseType')} fieldKey="licenseType">
          <Select
            {...register('licenseType')}
            error={!!err('licenseType')}
            showValid
            options={licenseTypeOptions}
          />
        </FormField>

        {data.licenseType === 'Provisional' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-gray-700">
              We may need to speak to you before confirming cover for provisional licences.
            </p>
          </div>
        )}

        <FormField label="Issued In" required error={err('licenseIssuedIn')} fieldKey="licenseIssuedIn">
          <Controller
            name="licenseIssuedIn"
            control={control}
            render={({ field }) => (
              <SearchableSelect
                value={field.value}
                onChange={(val) => field.onChange(val)}
                error={!!err('licenseIssuedIn')}
                showValid
                options={licenseIssuedInOptions}
                placeholder="Select..."
                searchPlaceholder="Type to search..."
              />
            )}
          />
        </FormField>

        {requiresForeignLicenceConfirmation(data.licenseIssuedIn) && (
          <FormField label="" error={err('licenseForeignDeclarationAccepted')} fieldKey="licenseForeignDeclarationAccepted">
            <Checkbox
              {...register('licenseForeignDeclarationAccepted')}
              error={!!err('licenseForeignDeclarationAccepted')}
              label={`By proceeding, you confirm that the driving license you hold is valid and legally permits you to drive a motor vehicle in ${getOperatingCountryName() ?? 'the country where this policy is issued'} without supervision. Failure to comply with this requirement may invalidate some or all of your insurance cover.`}
            />
          </FormField>
        )}
      </SectionCard>

      <SectionCard title="Claims & Convictions – Proposer" icon={<AlertTriangle className="w-6 h-6" />}>
        <FormField label="Any claims or accidents in the last 5 years?" required error={err('hasClaims')} fieldKey="hasClaims">
          <Controller
            name="hasClaims"
            control={control}
            render={({ field }) => (
              <RadioGroup
                name="hasClaims"
                value={field.value === true ? 'yes' : field.value === false ? 'no' : ''}
                onChange={(value) => {
                  const yes = value === 'yes';
                  field.onChange(yes);
                  if (!yes) {
                    setValue('claimsCountLast5Years', '', { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    setValue('claimsTotalCostLast5Years', '', { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    setValue('maxFaultClaimCostLast5Years', '', { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    setValue('claimsDetails', '', { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                  }
                }}
                options={[
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' },
                ]}
                error={!!err('hasClaims')}
              />
            )}
          />
        </FormField>

        {data.hasClaims && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField
                label="Number of claims in last 5 years"
                required
                error={err('claimsCountLast5Years')}
                fieldKey="claimsCountLast5Years"
              >
                <Input
                  inputMode="numeric"
                  {...register('claimsCountLast5Years', {
                    setValueAs: (v) => (v === '' ? '' : parseInt(String(v), 10)),
                  })}
                  error={!!err('claimsCountLast5Years')}
                  showValid={claimsCountValid}
                  placeholder="e.g. 2"
                />
              </FormField>

              <FormField
                label="Total cost of claims (€)"
                required
                error={err('claimsTotalCostLast5Years')}
                fieldKey="claimsTotalCostLast5Years"
              >
                <Input
                  inputMode="decimal"
                  {...register('claimsTotalCostLast5Years', {
                    setValueAs: (v) => (v === '' ? '' : parseFloat(String(v))),
                  })}
                  error={!!err('claimsTotalCostLast5Years')}
                  showValid
                  placeholder="e.g. 12000"
                />
              </FormField>

              <FormField
                label="Largest fault claim (€)"
                required
                error={err('maxFaultClaimCostLast5Years')}
                fieldKey="maxFaultClaimCostLast5Years"
              >
                <Input
                  inputMode="decimal"
                  {...register('maxFaultClaimCostLast5Years', {
                    setValueAs: (v) => (v === '' ? '' : parseFloat(String(v))),
                  })}
                  error={!!err('maxFaultClaimCostLast5Years')}
                  showValid
                  placeholder="e.g. 50000"
                />
              </FormField>
            </div>

            <FormField label="Details of previous claims" required error={err('claimsDetails')} fieldKey="claimsDetails">
              <Textarea
                {...register('claimsDetails')}
                error={!!err('claimsDetails')}
                showValid={!err('claimsDetails') && String(data.claimsDetails || '').trim().length >= 10}
                placeholder="Please provide date, type of claim, amount paid, fault / non-fault..."
                rows={4}
              />
            </FormField>
          </>
        )}

        <FormField
          label="Any motoring convictions, endorsements or pending prosecutions in the last 5 years?"
          required
          error={err('hasConvictions')}
          fieldKey="hasConvictions"
        >
          <Controller
            name="hasConvictions"
            control={control}
            render={({ field }) => (
              <RadioGroup
                name="hasConvictions"
                value={field.value === true ? 'yes' : field.value === false ? 'no' : ''}
                onChange={(value) => {
                  const yes = value === 'yes';
                  field.onChange(yes);
                  if (yes && convictionRows.length === 0) {
                    syncConvictionRows([{ id: `conviction-${Date.now()}`, date: '', convictionClass: '', description: '' }]);
                  }
                  if (!yes) {
                    setValue('motorConvictions', [], { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    setValue('hasMajorConvictionLast5Years', null, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    setValue('convictionClass', '', { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    setValue('majorConvictionWithinYears', '', { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    setValue('convictionsDetails', '', { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    setValue('majorConvictionsCountLast5Years', 0, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    setValue('seriousTechnicalOffenceCount', 0, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                  }
                }}
                options={[
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' },
                ]}
                error={!!err('hasConvictions')}
              />
            )}
          />
        </FormField>

        {data.hasConvictions && (
          <>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-900">Convictions and endorsements</div>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    Add one row for each conviction in the last 5 years. The type drives the underwriting/pricing code; the description gives our underwriters context.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addConvictionRow}
                  className="shrink-0 rounded-xl bg-brand-primary px-4 py-2 text-sm font-black text-white hover:bg-brand-secondary"
                >
                  Add conviction
                </button>
              </div>

              <FormField
                label="Conviction entries"
                required
                error={err('motorConvictions')}
                fieldKey="motorConvictions"
              >
                <div className="space-y-4">
                  {(convictionRows.length ? convictionRows : [{ id: 'conviction-empty', date: '', convictionClass: '', description: '' }]).map((row, index) => (
                    <div key={row.id || index} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-xs font-black uppercase tracking-widest text-slate-400">
                          Conviction {index + 1}
                        </div>
                        {convictionRows.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => removeConvictionRow(index)}
                            className="text-xs font-black uppercase tracking-widest text-rose-600 hover:text-rose-700"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <FormField
                          label="Conviction date"
                          required
                          error={err(`motorConvictions.${index}.date`)}
                          fieldKey={`motorConvictions.${index}.date`}
                        >
                          <Input
                            type="date"
                            value={String(row.date || '')}
                            onValueChange={(next) => updateConvictionRow(index, { date: next })}
                            error={!!err(`motorConvictions.${index}.date`)}
                            showValid={!err(`motorConvictions.${index}.date`) && Boolean(row.date)}
                          />
                        </FormField>

                        <FormField
                          label="Conviction type"
                          required
                          error={err(`motorConvictions.${index}.convictionClass`)}
                          fieldKey={`motorConvictions.${index}.convictionClass`}
                        >
                          <Select
                            value={String(row.convictionClass || '')}
                            onChange={(event) => updateConvictionRow(index, { convictionClass: event.target.value })}
                            error={!!err(`motorConvictions.${index}.convictionClass`)}
                            showValid={!err(`motorConvictions.${index}.convictionClass`) && Boolean(row.convictionClass)}
                            options={convictionTypeOptions}
                          />
                        </FormField>
                      </div>

                      <FormField
                        label="Description"
                        required
                        error={err(`motorConvictions.${index}.description`)}
                        fieldKey={`motorConvictions.${index}.description`}
                      >
                        <Textarea
                          value={String(row.description || '')}
                          onChange={(event) => updateConvictionRow(index, { description: event.target.value })}
                          error={!!err(`motorConvictions.${index}.description`)}
                          showValid={!err(`motorConvictions.${index}.description`) && String(row.description || '').trim().length >= 3}
                          placeholder="Briefly describe what happened, including any code shown on documents if known."
                          rows={3}
                        />
                      </FormField>
                    </div>
                  ))}
                </div>
              </FormField>
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard title="Other Drivers" icon={<Users className="w-6 h-6" />}>
        <FormField
          label="Who can drive this vehicle?"
          required
          error={err('driverRestriction')}
          fieldKey="driverRestriction"
        >
          <Controller
            name="driverRestriction"
            control={control}
            render={({ field }) => (
              <Select
                name="driverRestriction"
                value={field.value ?? ''}
                onChange={(event) => {
                  const next = (event.target.value || null) as
                    | 'POLICYHOLDER_ONLY'
                    | 'NAMED_DRIVERS'
                    | 'ANY_DRIVER_25_PLUS'
                    | 'ANY_DRIVER_40_PLUS'
                    | null
                    | '';
                  const value = next === '' ? null : next;
                  field.onChange(value);
                  // Cascade-clear named-driver fields when the
                  // restriction moves away from NAMED_DRIVERS — for
                  // POLICYHOLDER_ONLY the policy excludes additional
                  // drivers; for the two open modes the named-drivers
                  // list is meaningless and must not feed pricing or
                  // documents (ABY-232 / ADR-0025).
                  if (value !== 'NAMED_DRIVERS') {
                    setValue('hasAdditionalDrivers', false, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    setValue('youngestDriverAge', '', { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    setValue('additionalDrivers', [], { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    setValue('otherDriversClaims', false, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    setValue('otherDriversClaimsDetails', '', { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    setValue('otherDriversConvictions', false, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    setValue('otherDriversConvictionsDetails', '', { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                  } else if (field.value === null || field.value === undefined) {
                    // Entering NAMED_DRIVERS for the first time — leave
                    // `hasAdditionalDrivers` for the user to pick (Yes/No
                    // is required by the schema in this mode).
                    setValue('hasAdditionalDrivers', null, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                  }
                }}
                options={driverRestrictionOptions}
                error={!!err('driverRestriction')}
                showValid
              />
            )}
          />
        </FormField>

        {data.driverRestriction === 'ANY_DRIVER_25_PLUS' && (
          <p className="text-sm text-gray-600 mt-2">
            Any authorised driver aged 25–70 may drive the vehicle (standard rate, no named-driver discount).
          </p>
        )}
        {data.driverRestriction === 'ANY_DRIVER_40_PLUS' && (
          <p className="text-sm text-gray-600 mt-2">
            Any authorised driver aged 40–70 may drive the vehicle (standard rate, no named-driver discount).
          </p>
        )}
        {data.driverRestriction === 'POLICYHOLDER_ONLY' && (
          <p className="text-sm text-gray-600 mt-2">
            Only the policyholder may drive the vehicle. Qualifies for the named-drivers discount.
          </p>
        )}

        {data.driverRestriction === 'NAMED_DRIVERS' && (
          <FormField
            label="Will there be any additional named drivers on this policy?"
            required
            error={err('hasAdditionalDrivers')}
            fieldKey="hasAdditionalDrivers"
          >
            <Controller
              name="hasAdditionalDrivers"
              control={control}
              render={({ field }) => (
                <RadioGroup
                  name="hasAdditionalDrivers"
                  value={field.value === true ? 'yes' : field.value === false ? 'no' : ''}
                  onChange={(value) => {
                    const yes = value === 'yes';
                    field.onChange(yes);
                    if (!yes) {
                      setValue('youngestDriverAge', '', { shouldDirty: true, shouldTouch: true });
                      setValue('additionalDrivers', [], { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                      setValue('otherDriversClaims', false, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                      setValue('otherDriversClaimsDetails', '', { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                      setValue('otherDriversConvictions', false, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                      setValue('otherDriversConvictionsDetails', '', { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                    }
                  }}
                  options={[
                    { value: 'yes', label: 'Yes' },
                    { value: 'no', label: 'No' },
                  ]}
                  error={!!err('hasAdditionalDrivers')}
                />
              )}
            />
          </FormField>
        )}

        {data.driverRestriction === 'NAMED_DRIVERS' && data.hasAdditionalDrivers && (
          <>
            {!hasNamedAdditionalDrivers && (
              <FormField
                label="Age of the youngest driver"
                required
                error={err('youngestDriverAge')}
                fieldKey="youngestDriverAge"
              >
                <Input
                  type="number"
                  min={21}
                  max={80}
                  inputMode="numeric"
                  {...register('youngestDriverAge', {
                    setValueAs: (v) => (v === '' ? '' : parseInt(String(v), 10)),
                  })}
                  error={!!err('youngestDriverAge')}
                  showValid
                  placeholder="e.g. 35"
                />
              </FormField>
            )}

            <FormField
              label="Any claims for other drivers in the last 5 years?"
              required
              error={err('otherDriversClaims')}
              fieldKey="otherDriversClaims"
            >
              <Controller
                name="otherDriversClaims"
                control={control}
                render={({ field }) => (
                  <RadioGroup
                    name="otherDriversClaims"
                    value={field.value ? 'yes' : 'no'}
                    onChange={(value) => field.onChange(value === 'yes')}
                    options={[
                      { value: 'yes', label: 'Yes' },
                      { value: 'no', label: 'No' },
                    ]}
                    error={!!err('otherDriversClaims')}
                  />
                )}
              />
            </FormField>

            {data.otherDriversClaims && (
              <FormField
                label="Details of other drivers' previous claims"
                required
                error={err('otherDriversClaimsDetails')}
                fieldKey="otherDriversClaimsDetails"
              >
                <Textarea
                  {...register('otherDriversClaimsDetails')}
                  error={!!err('otherDriversClaimsDetails')}
                  showValid={!err('otherDriversClaimsDetails') && String(data.otherDriversClaimsDetails || '').trim().length >= 10}
                  placeholder="Please provide details..."
                  rows={4}
                />
              </FormField>
            )}

            <FormField
              label="Any convictions for other drivers in the last 5 years?"
              required
              error={err('otherDriversConvictions')}
              fieldKey="otherDriversConvictions"
            >
              <Controller
                name="otherDriversConvictions"
                control={control}
                render={({ field }) => (
                  <RadioGroup
                    name="otherDriversConvictions"
                    value={field.value ? 'yes' : 'no'}
                    onChange={(value) => field.onChange(value === 'yes')}
                    options={[
                      { value: 'yes', label: 'Yes' },
                      { value: 'no', label: 'No' },
                    ]}
                    error={!!err('otherDriversConvictions')}
                  />
                )}
              />
            </FormField>

            {data.otherDriversConvictions && (
              <FormField
                label="Details of other drivers' convictions"
                required
                error={err('otherDriversConvictionsDetails')}
                fieldKey="otherDriversConvictionsDetails"
              >
                <Textarea
                  {...register('otherDriversConvictionsDetails')}
                  error={!!err('otherDriversConvictionsDetails')}
                  showValid={!err('otherDriversConvictionsDetails') && String(data.otherDriversConvictionsDetails || '').trim().length >= 10}
                  placeholder="Please provide details..."
                  rows={4}
                />
              </FormField>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard title="More About You" icon={<User className="w-6 h-6" />}>
        <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6">
          <FormField
            label="Occupation"
            required
            error={err('proposer.occupation')}
            fieldKey="proposer.occupation"
          >
            <Input
              {...register('proposer.occupation')}
              error={!!err('proposer.occupation')}
              showValid
              placeholder="Your occupation"
            />
          </FormField>

          <FormField
            label="Where did you hear about us?"
            required
            error={err('proposer.whereDidYouHear')}
            fieldKey="proposer.whereDidYouHear"
          >
            <Select
              {...register('proposer.whereDidYouHear')}
              error={!!err('proposer.whereDidYouHear')}
              showValid
              options={whereDidYouHearOptions}
            />
          </FormField>
        </div>
      </SectionCard>
    </div>
  );
}
