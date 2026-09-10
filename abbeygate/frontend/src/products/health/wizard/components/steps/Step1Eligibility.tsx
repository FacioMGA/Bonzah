import { Controller, useFormContext, useWatch } from 'react-hook-form';
import {
  BooleanRadio,
  FormField,
  WizardSelect as Select,
  WizardSearchableSelect as SearchableSelect,
  SectionCard,
} from '@/src/shared/ui';
import { Globe } from 'lucide-react';
import { makeFieldErrorReader } from '../../utils/errors';
import { getOperatingCountryName } from '@/src/shared/lib/tenant/operatingCountry';
import {
  HEALTH_NATIONALITY_OPTIONS,
  HEALTH_RESIDENCE_COUNTRY_OPTIONS,
  HEALTH_RESIDENCE_DURATION_OPTIONS,
  HEALTH_RESIDENCY_STATUS_OPTIONS,
} from '@facio/products';

function formatHealthResidencyDeclaration(countryName: string | null): string {
  const residencyCountry = countryName === 'Cyprus'
    ? 'the Republic of Cyprus'
    : countryName ?? 'the country selected above';
  const immigrationCountry = countryName ? ` in ${countryName}` : ' in that country';
  return [
    `I confirm that I am an expatriate legally resident in ${residencyCountry}`,
    `and that this insurance is being purchased in support of my immigration application${immigrationCountry}.`,
  ].join(' ');
}

/**
 * Step 1 — Objective expat eligibility (same shape as Travel ADR-0025).
 *
 * The seven objective answers (residence, nationality, duration,
 * "will remain resident", residency status, legally permitted,
 * information accurate) drive the server-side `isExpat` derivation in
 * `healthUwAutomation.ts` — the customer is never asked whether they
 * are an expat directly. Eligibility decline for non-CY residence is a
 * SERVER-side check via `allowedResidenceCountries`, NOT a frontend
 * dropdown restriction (ABY-284).
 *
 * Boolean answers are rendered via the canonical `BooleanRadio`
 * primitive (ABY-285). The previous inline `RadioGroup` mapping
 * `value === false ? 'no' : ''` rendered a "No" pre-selection whenever
 * the form's default for the field was `false` rather than `null/
 * undefined` — Lloyd's UX requires no pre-selection on discretionary
 * declarations.
 */
export function Step1Eligibility() {
  const { register, control, formState: { errors } } = useFormContext();
  const err = makeFieldErrorReader(errors);
  const hasOtherNationality = useWatch({ control, name: 'eligibility.hasOtherNationality' });
  const residencyDeclaration = formatHealthResidencyDeclaration(getOperatingCountryName());

  return (
    <SectionCard title="Eligibility" icon={<Globe className="w-5 h-5" />}>
      <FormField label="What is your current country of residence?" error={err('eligibility.countryOfResidence')}>
        <Controller
          name="eligibility.countryOfResidence"
          control={control}
          render={({ field }) => (
            <SearchableSelect
              value={String(field.value || '')}
              onChange={field.onChange}
              options={HEALTH_RESIDENCE_COUNTRY_OPTIONS}
              placeholder="Select country"
              searchPlaceholder="Search country..."
              error={!!err('eligibility.countryOfResidence')}
            />
          )}
        />
      </FormField>

      <FormField label="What is your nationality?" error={err('eligibility.nationality')}>
        <Controller
          name="eligibility.nationality"
          control={control}
          render={({ field }) => (
            <SearchableSelect
              value={String(field.value || '')}
              onChange={field.onChange}
              options={HEALTH_NATIONALITY_OPTIONS}
              placeholder="Select nationality"
              searchPlaceholder="Search nationality..."
              error={!!err('eligibility.nationality')}
            />
          )}
        />
      </FormField>

      <FormField label="Do you hold any other nationality?" error={err('eligibility.hasOtherNationality')}>
        <Controller
          name="eligibility.hasOtherNationality"
          control={control}
          render={({ field }) => (
            <BooleanRadio
              name="eligibility.hasOtherNationality"
              value={field.value === true ? true : field.value === false ? false : undefined}
              onChange={field.onChange}
              error={!!err('eligibility.hasOtherNationality')}
            />
          )}
        />
      </FormField>

      {hasOtherNationality === true && (
        <FormField label="Please select your other nationality" error={err('eligibility.otherNationality')}>
          <Controller
            name="eligibility.otherNationality"
            control={control}
            render={({ field }) => (
              <SearchableSelect
                value={String(field.value || '')}
                onChange={field.onChange}
                options={HEALTH_NATIONALITY_OPTIONS}
                placeholder="Select nationality"
                searchPlaceholder="Search nationality..."
                error={!!err('eligibility.otherNationality')}
              />
            )}
          />
        </FormField>
      )}

      <FormField
        label="How long have you been living in your current country of residence?"
        error={err('eligibility.residenceDuration')}
      >
        <Select
          {...register('eligibility.residenceDuration')}
          options={HEALTH_RESIDENCE_DURATION_OPTIONS}
          placeholder="Select duration"
          error={!!err('eligibility.residenceDuration')}
        />
      </FormField>

      <FormField
        label="For the duration of your policy, please confirm that you will remain a resident of your current country of residence."
        error={err('eligibility.willRemainResident')}
      >
        <Controller
          name="eligibility.willRemainResident"
          control={control}
          render={({ field }) => (
            <BooleanRadio
              name="eligibility.willRemainResident"
              value={field.value === true ? true : field.value === false ? false : undefined}
              onChange={field.onChange}
              error={!!err('eligibility.willRemainResident')}
            />
          )}
        />
      </FormField>

      <FormField
        label="What is your residency status in your current country of residence?"
        error={err('eligibility.residencyStatus')}
      >
        <Select
          {...register('eligibility.residencyStatus')}
          options={HEALTH_RESIDENCY_STATUS_OPTIONS}
          placeholder="Select residency status"
          error={!!err('eligibility.residencyStatus')}
        />
      </FormField>

      <FormField
        label="Are you legally permitted to reside in your current country of residence?"
        error={err('eligibility.legallyPermittedToReside')}
      >
        <Controller
          name="eligibility.legallyPermittedToReside"
          control={control}
          render={({ field }) => (
            <BooleanRadio
              name="eligibility.legallyPermittedToReside"
              value={field.value === true ? true : field.value === false ? false : undefined}
              onChange={field.onChange}
              error={!!err('eligibility.legallyPermittedToReside')}
            />
          )}
        />
      </FormField>

      <FormField
        label="I confirm that the information provided is accurate and that any incorrect declaration may affect cover or claims validation."
        error={err('eligibility.informationAccurate')}
      >
        <Controller
          name="eligibility.informationAccurate"
          control={control}
          render={({ field }) => (
            <BooleanRadio
              name="eligibility.informationAccurate"
              value={field.value === true ? true : field.value === false ? false : undefined}
              onChange={field.onChange}
              error={!!err('eligibility.informationAccurate')}
            />
          )}
        />
      </FormField>

      <FormField label="Lloyd's residency declaration" error={err('eligibility.legalAgreement')}>
        <label className="flex items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            {...register('eligibility.legalAgreement')}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary"
          />
          <span>
            {residencyDeclaration}
          </span>
        </label>
      </FormField>
    </SectionCard>
  );
}
