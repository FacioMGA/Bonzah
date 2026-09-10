import { useEffect } from 'react';
import { Controller, useFieldArray, useFormContext } from 'react-hook-form';
import { Coins, Plus, Trash2 } from 'lucide-react';
import { BooleanRadio, FormField, MoneyInput, SectionCard } from '@/src/shared/ui';
import { WizardButton as Button, WizardInput as Input } from '@/src/shared/ui';
import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';
import { getOperatingCountryName } from '@/src/shared/lib/tenant/operatingCountry';
import { REGION_CONFIG } from '@/src/shared/config/region';
import { hasHomeSolarPanelDefault, resolveHomeSolarPanelCoverAmount } from '@facio/products';
import { holidayHomeOnlyForDomicile } from '../../holidayHomeOnly';

export function Step4SumsInsured() {
  const { register, control, setValue, watch, formState: { errors } } = useFormContext();
  const { fields: specifiedItemFields, append, remove, replace } = useFieldArray({
    control,
    name: 'coverage.specifiedItems',
  });
  const getErrorMessage = (path: string): string | undefined =>
    getNestedError(errors as Record<string, unknown>, path);

  // Abbeygate rule: a proposer domiciled outside the operating country can
  // only insure a HOLIDAY home — `usage.permanentHome` is the canonical
  // field the rater/UW read (`toHomePricingQuoteData`), so lock it to
  // "holiday" (false) here too. See `holidayHomeOnlyForDomicile`.
  const holidayHomeOnly = holidayHomeOnlyForDomicile(watch('proposer.domicileCountry'));
  const isHolidayHome = watch('usage.permanentHome') === false;
  const operatingCountryName = getOperatingCountryName() ?? REGION_CONFIG.defaultCountry;
  useEffect(() => {
    if (holidayHomeOnly) {
      setValue('usage.permanentHome', false, { shouldDirty: true, shouldValidate: true });
    }
  }, [holidayHomeOnly, setValue]);

  // ABY-449 / ABY-454 / ABY-455 — optional accidental-damage and
  // all-risks/high-risk-item covers are not offered on holiday homes.
  // Clear stale selections as soon as the usage changes so back/forward
  // navigation cannot carry a permanent-home premium into a holiday quote.
  useEffect(() => {
    if (!isHolidayHome) return;
    setValue('coverage.accidentalDamageBuildings', false, { shouldDirty: true, shouldValidate: true });
    setValue('coverage.accidentalDamageContents', false, { shouldDirty: true, shouldValidate: true });
    setValue('coverage.allRiskJewellery', 0, { shouldDirty: true, shouldValidate: true });
    setValue('coverage.allRiskOther', 0, { shouldDirty: true, shouldValidate: true });
    replace([]);
  }, [isHolidayHome, replace, setValue]);

  // ABY-58: render every monetary sum-insured field through the canonical
  // `MoneyInput` so the customer sees `€500,000` while typing instead of
  // raw `500000`. The persisted form value remains a plain numeric string
  // (no separators) so the existing `positiveMoney` / Zod schema rules
  // still validate and the rater receives the same numeric premium base.
  const renderMoneyField = (path: string, label: string, required = false) => (
    <FormField
      label={label}
      required={required}
      error={getErrorMessage(path)}
      fieldKey={path}
    >
      <Controller
        name={path}
        control={control}
        render={({ field }) => (
          <MoneyInput
            value={String(field.value ?? '')}
            onValueChange={(next) => {
              const numeric = next === '' ? undefined : Number(next);
              const parsed = Number.isFinite(numeric) ? numeric : (next || undefined);
              const isMandatorySolarCover = path === 'coverage.solarPanelCover'
                && hasHomeSolarPanelDefault(REGION_CONFIG.defaultRegionCode);
              field.onChange(isMandatorySolarCover
                ? resolveHomeSolarPanelCoverAmount(REGION_CONFIG.defaultRegionCode, parsed)
                : parsed);
            }}
            onBlur={field.onBlur}
            error={!!getErrorMessage(path)}
            currencySymbol="€"
            allowNegative={false}
            maxDecimals={0}
            formatOnBlurOnly
            align="left"
          />
        )}
      />
    </FormField>
  );

  // ABY-90 / ABY-92 / ABY-93 — `BooleanRadio` two-tile picker replaces
  // the old dropdown. Saves three taps per question on mobile and the
  // boolean wire format is unchanged.
  const renderBooleanRadio = (path: string, label: string) => (
    <FormField label={label} required error={getErrorMessage(path)} fieldKey={path}>
      <Controller
        name={path}
        control={control}
        render={({ field }) => (
          <BooleanRadio
            name={field.name}
            value={typeof field.value === 'boolean' ? field.value : undefined}
            onChange={(next) => field.onChange(next)}
            error={!!getErrorMessage(path)}
          />
        )}
      />
    </FormField>
  );

  return (
    <SectionCard title="Sums insured & cover" icon={<Coins className="w-5 h-5" />}>
      <p className="text-sm font-semibold text-slate-500 -mt-4 mb-2">Set the values you want insured.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {renderMoneyField('coverage.buildings', 'Buildings sum insured', true)}
        {renderMoneyField('coverage.contents', 'Contents sum insured', true)}
      </div>
      {!isHolidayHome ? (
        <p className="text-xs font-semibold text-amber-800 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          Please be aware that High Risk Items cannot exceed 20% of the total contents sum insured. If you insure any Specified High Risk Items, you must have a safe at the premises (we will ask you to confirm this in the next step) and the safe condition is added to your policy.
        </p>
      ) : null}

      {!isHolidayHome ? (
        <fieldset className="space-y-3">
          <legend className="text-sm font-black text-slate-800">Accidental damage</legend>
          <label className="flex items-start gap-3">
            <input type="checkbox" {...register('coverage.accidentalDamageBuildings')} className="mt-1 h-4 w-4 rounded" />
            <span className="text-sm">Include accidental damage for buildings</span>
          </label>
          <label className="flex items-start gap-3">
            <input type="checkbox" {...register('coverage.accidentalDamageContents')} className="mt-1 h-4 w-4 rounded" />
            <span className="text-sm">Include accidental damage for contents</span>
          </label>
        </fieldset>
      ) : null}

      {/*
        ABY — align the three inputs on a common bottom baseline. The
        "High Risk Items (…)" label wraps to two lines while the other two
        are single-line, which previously pushed its box lower than its
        neighbours. `items-end` bottom-aligns each cell so the input boxes
        line up regardless of label height.
      */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        {!isHolidayHome ? renderMoneyField('coverage.allRiskJewellery', 'High Risk Items (e.g., jewellery, watches, electronic devices, etc.)') : null}
        {!isHolidayHome ? renderMoneyField('coverage.allRiskOther', 'All Risks Unspecified') : null}
        {renderMoneyField(
          'coverage.solarPanelCover',
          hasHomeSolarPanelDefault(REGION_CONFIG.defaultRegionCode)
            ? 'Solar panel cover (included from €2,000)'
            : 'Solar panel cover',
        )}
      </div>

      {!isHolidayHome ? <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4" open={specifiedItemFields.length > 0}>
        <summary className="cursor-pointer text-sm font-black text-slate-800">
          List high risk items
        </summary>
        <p className="mt-2 text-xs font-semibold text-slate-600">
          Add any high risk item you want specified, including make, model, serial number, and value. If any item is valued over €3,000, a recent valuation or receipt is required.
        </p>
        <div className="mt-4 space-y-4">
          {specifiedItemFields.map((field, idx) => (
            <div key={field.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">High risk item {idx + 1}</div>
                <Button
                  type="button"
                  variant="secondary"
                  className="text-slate-500 hover:text-red-600"
                  onClick={() => remove(idx)}
                  aria-label={`Remove high risk item ${idx + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <FormField
                  label="Item description"
                  error={getErrorMessage(`coverage.specifiedItems.${idx}.description`)}
                  fieldKey={`coverage.specifiedItems.${idx}.description`}
                >
                  <Input
                    {...register(`coverage.specifiedItems.${idx}.description`)}
                    placeholder="e.g. diamond ring, watch, laptop"
                    error={!!getErrorMessage(`coverage.specifiedItems.${idx}.description`)}
                    showValid
                  />
                </FormField>
                <FormField
                  label="Make"
                  error={getErrorMessage(`coverage.specifiedItems.${idx}.make`)}
                  fieldKey={`coverage.specifiedItems.${idx}.make`}
                >
                  <Input
                    {...register(`coverage.specifiedItems.${idx}.make`)}
                    placeholder="Make"
                    error={!!getErrorMessage(`coverage.specifiedItems.${idx}.make`)}
                    showValid
                  />
                </FormField>
                <FormField
                  label="Model"
                  error={getErrorMessage(`coverage.specifiedItems.${idx}.model`)}
                  fieldKey={`coverage.specifiedItems.${idx}.model`}
                >
                  <Input
                    {...register(`coverage.specifiedItems.${idx}.model`)}
                    placeholder="Model"
                    error={!!getErrorMessage(`coverage.specifiedItems.${idx}.model`)}
                    showValid
                  />
                </FormField>
                <FormField
                  label="Serial number"
                  error={getErrorMessage(`coverage.specifiedItems.${idx}.serialNumber`)}
                  fieldKey={`coverage.specifiedItems.${idx}.serialNumber`}
                >
                  <Input
                    {...register(`coverage.specifiedItems.${idx}.serialNumber`)}
                    placeholder="Serial number"
                    error={!!getErrorMessage(`coverage.specifiedItems.${idx}.serialNumber`)}
                    showValid
                  />
                </FormField>
                <FormField
                  label="Value"
                  error={getErrorMessage(`coverage.specifiedItems.${idx}.sumInsured`)}
                  fieldKey={`coverage.specifiedItems.${idx}.sumInsured`}
                >
                  <Controller
                    name={`coverage.specifiedItems.${idx}.sumInsured`}
                    control={control}
                    render={({ field: itemValueField }) => (
                      <MoneyInput
                        value={String(itemValueField.value ?? '')}
                        onValueChange={(next) => {
                          const numeric = next === '' ? undefined : Number(next);
                          itemValueField.onChange(Number.isFinite(numeric) ? numeric : (next || undefined));
                        }}
                        onBlur={itemValueField.onBlur}
                        error={!!getErrorMessage(`coverage.specifiedItems.${idx}.sumInsured`)}
                        currencySymbol="€"
                        allowNegative={false}
                        maxDecimals={0}
                        formatOnBlurOnly
                        align="left"
                      />
                    )}
                  />
                </FormField>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            className="inline-flex items-center justify-center rounded-full border border-[#0d4b7f] px-4 py-2 text-sm font-semibold text-[#0d4b7f] hover:bg-white"
            onClick={() => append({ description: '', make: '', model: '', serialNumber: '', sumInsured: undefined })}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add high risk item
          </Button>
        </div>
      </details> : null}

      <div className="space-y-3">
        <div className="text-sm font-black text-slate-800">Use of property</div>
        {/*
          ABY — bottom-align the Yes/No pickers. The middle question
          ("Used for any business, trade or professional purpose") wraps to
          two lines, so without `items-end` its Yes/No tiles sat lower than
          the "Permanent Home" and "Rented out or sub-let" tiles.
        */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          {holidayHomeOnly ? (
            <FormField label="Permanent Home" fieldKey="usage.permanentHome">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3" data-field="usage.permanentHome">
                <span className="text-sm font-semibold text-slate-800">Holiday home</span>
                <p className="mt-1 text-xs text-slate-500">
                  Domiciled outside {operatingCountryName} — holiday home only.
                </p>
              </div>
            </FormField>
          ) : (
            renderBooleanRadio('usage.permanentHome', 'Permanent Home')
          )}
          {renderBooleanRadio('usage.businessUse', 'Used for any business, trade or professional purpose')}
          {renderBooleanRadio('usage.rentedOut', 'Rented out or sub-let')}
        </div>
      </div>
    </SectionCard>
  );
}
