import { useEffect } from 'react';
import { useFormContext, Controller } from 'react-hook-form';
import { Home as HomeIcon } from 'lucide-react';
import { BooleanRadio, FormField, SectionCard, WizardInput as Input, WizardSelect as Select } from '@/src/shared/ui';
import { PropertyUseSelect } from '../PropertyUseSelect';
import AddressAutocomplete from '@/src/shared/components/AddressAutocomplete';
import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';
import { postcodeInputHintForCountry } from '@/src/shared/lib/wizard/utils/postcodeInput';
import { HOME_PROPERTY_TYPE_OPTIONS } from '@facio/products';
import { getOperatingCountryFromHost, getOperatingCountryName } from '@/src/shared/lib/tenant/operatingCountry';
import { REGION_CONFIG } from '@/src/shared/config/region';
import { holidayHomeOnlyForDomicile } from '../../holidayHomeOnly';

const BEDROOM_OPTIONS = Array.from({ length: 20 }, (_, index) => {
  const value = String(index + 1);
  return { value, label: value };
});

export function Step2Property() {
  const { control, register, setValue, watch, formState: { errors } } = useFormContext();
  const sameAsProposer = watch('property.sameAsProposer');
  const urbanArea = watch('property.urbanArea');
  const propertyType = watch('property.propertyType');
  // Abbeygate rule: a proposer domiciled outside the operating country can
  // only insure a HOLIDAY home. When that applies we lock the permanent/
  // holiday choice to "holiday" (permanentHome = false). See
  // `holidayHomeOnlyForDomicile`.
  const holidayHomeOnly = holidayHomeOnlyForDomicile(watch('proposer.domicileCountry'));
  const operatingCountryName = getOperatingCountryName() ?? REGION_CONFIG.defaultCountry;
  useEffect(() => {
    if (holidayHomeOnly) {
      setValue('property.permanentHome', false, { shouldDirty: true, shouldValidate: true });
    }
  }, [holidayHomeOnly, setValue]);
  const getErrorMessage = (path: string): string | undefined =>
    getNestedError(errors as Record<string, unknown>, path);
  // ABY-299: HOME property addresses must be in the operating tenant's
  // jurisdiction by definition (we cannot insure a property abroad
  // from this binder). Constraining the autocomplete to that country
  // removes USA / international suggestions that previously polluted
  // the dropdown for operators on `abbeygate-{cy,pt,gr,es}`.
  const operatingCountry = getOperatingCountryFromHost();
  const addressRestrictions = operatingCountry ? [operatingCountry] : undefined;
  // ABY-341 — postcode keyboard is country-aware. Prefer the address country
  // captured on the form, falling back to the operating tenant country.
  const postcodeCountry = String(watch('property.address.country') || operatingCountry || '');
  const postcodeHint = postcodeInputHintForCountry(postcodeCountry);

  return (
    <SectionCard title="Your property" icon={<HomeIcon className="w-5 h-5" />}>
      <p className="text-sm font-semibold text-slate-500 -mt-4 mb-2">Tell us about the property to insure.</p>

      <label className="flex items-start gap-3">
        <input type="checkbox" {...register('property.sameAsProposer')} className="mt-1 h-4 w-4 rounded" />
        <span className="text-sm">Property address is the same as my postal address</span>
      </label>

      {!sameAsProposer && (
        <>
          <FormField label="Property address">
            <Controller
              name="property.address.line1"
              control={control}
              render={({ field }) => (
                <AddressAutocomplete
                  value={String(field.value || '')}
                  onChange={(v) => field.onChange(v)}
                  onAddressSelect={(data) => {
                    setValue('property.address.line1', data.address || '');
                    setValue('property.address.city', data.city || '');
                    setValue('property.address.province', data.state || '');
                    setValue('property.address.postcode', data.zip || '');
                    setValue('property.address.country', data.country || REGION_CONFIG.defaultCountry);
                  }}
                  placeholder="Start typing the property address..."
                  componentRestrictions={addressRestrictions}
                />
              )}
            />
          </FormField>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField label="City"><Input {...register('property.address.city')} /></FormField>
            <FormField label="Postal code">
              {/* ABY-55 / ABY-341: country-aware keyboard (see PolicyHolderStep). */}
              <Input
                {...register('property.address.postcode')}
                inputMode={postcodeHint.inputMode}
                pattern={postcodeHint.pattern}
                autoComplete="postal-code"
              />
            </FormField>
            <FormField label="Country"><Input {...register('property.address.country')} /></FormField>
          </div>
        </>
      )}

      <FormField label="Property type" error={(errors.property as Record<string, { message?: string }> | undefined)?.propertyType?.message}>
        <Select
          {...register('property.propertyType')}
          options={HOME_PROPERTY_TYPE_OPTIONS}
          placeholder="Select property type"
        />
      </FormField>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FormField label="Bedrooms">
          <Select
            aria-label="Bedrooms"
            {...register('property.bedrooms')}
            options={BEDROOM_OPTIONS}
            placeholder="Select bedrooms"
          />
        </FormField>
        <FormField label="Covered area (sqm)"><Input type="number" min={10} {...register('property.floorAreaSqm')} /></FormField>
        <FormField label="Area of land (sqm)" required={propertyType !== 'Apartment'} error={getErrorMessage('property.landAreaSqm')}>
          <Input type="number" min={0} {...register('property.landAreaSqm')} />
        </FormField>
      </div>

      {/* ABY-90 / ABY-92 / ABY-93 — Yes/No → two-tile RadioGroup. */}
      <FormField label="Is the property in an urban area?" required error={getErrorMessage('property.urbanArea')} fieldKey="property.urbanArea">
        <Controller
          name="property.urbanArea"
          control={control}
          render={({ field }) => (
            <BooleanRadio
              name={field.name}
              value={typeof field.value === 'boolean' ? field.value : undefined}
              onChange={(next) => field.onChange(next)}
              error={!!getErrorMessage('property.urbanArea')}
            />
          )}
        />
      </FormField>

      {/* Only relevant for non-urban properties; a non-urban property that is
          not within 20 minutes of a fire station is referred to underwriting. */}
      {urbanArea === false && (
        <FormField label="Is the property within 20 minutes of a fire station?" required error={getErrorMessage('property.within20MinFireStation')} fieldKey="property.within20MinFireStation">
          <Controller
            name="property.within20MinFireStation"
            control={control}
            render={({ field }) => (
              <BooleanRadio
                name={field.name}
                value={typeof field.value === 'boolean' ? field.value : undefined}
                onChange={(next) => field.onChange(next)}
                error={!!getErrorMessage('property.within20MinFireStation')}
              />
            )}
          />
        </FormField>
      )}

      {holidayHomeOnly ? (
        <FormField label="Property use" fieldKey="property.permanentHome">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3" data-field="property.permanentHome">
            <span className="text-sm font-semibold text-slate-800">Holiday home</span>
            <p className="mt-1 text-xs text-slate-500">
              Because your country of domicile is outside {operatingCountryName}, this property can only be insured as a holiday home.
            </p>
          </div>
        </FormField>
      ) : (
        <FormField label="Property use" required error={getErrorMessage('property.permanentHome')} fieldKey="property.permanentHome">
          <Controller
            name="property.permanentHome"
            control={control}
            render={({ field }) => (
              <PropertyUseSelect
                name={field.name}
                value={typeof field.value === 'boolean' ? field.value : undefined}
                onChange={(next) => field.onChange(next)}
                error={!!getErrorMessage('property.permanentHome')}
              />
            )}
          />
        </FormField>
      )}
    </SectionCard>
  );
}
