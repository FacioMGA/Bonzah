import { useEffect } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { Hammer } from 'lucide-react';
import { BooleanRadio, FormField, SectionCard, WizardSelect as Select } from '@/src/shared/ui';
import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';

// ABY-334 — the proposer's "aged 45+" flag is derived from their date of
// birth, never asked. Boundary is age ≥ 45 to match the canonical home
// pricing step ("Proposer age 45+"). Returns null when DOB is absent so
// we don't pin a value before the proposer has entered their details.
function deriveProposerOver45(dateOfBirth: unknown): boolean | null {
  const dob = String(dateOfBirth || '').trim();
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age >= 45;
}
import {
  HOME_INCREASED_EXCESS_OPTIONS,
  HOME_NO_CLAIMS_DISCOUNT_LABEL,
  HOME_NO_CLAIMS_DISCOUNT_OPTIONS,
  HOME_PREVIOUS_CLAIMS_OPTIONS,
  HOME_YEAR_BUILT_OPTIONS,
  HOME_YES_NO_OPTIONS,
} from '@facio/products';

export function Step3ConstructionRisk() {
  const { register, control, watch, setValue, formState: { errors } } = useFormContext();
  const getErrorMessage = (path: string): string | undefined =>
    getNestedError(errors as Record<string, unknown>, path);

  // Keep the derived over-45 flag in sync with the proposer's DOB so the
  // required `risk.proposerOver45` field is populated without asking.
  const dateOfBirth = watch('proposer.dateOfBirth');
  useEffect(() => {
    const derived = deriveProposerOver45(dateOfBirth);
    if (derived === null) return;
    setValue('risk.proposerOver45', derived, { shouldDirty: true, shouldValidate: true });
  }, [dateOfBirth, setValue]);

  // ABY-90 / ABY-92 / ABY-93 — Yes/No now renders as the canonical
  // two-tile radio group instead of a dropdown, so the customer
  // answers in 1 tap instead of 3.
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
    <SectionCard title="Construction & risk" icon={<Hammer className="w-5 h-5" />}>
      <p className="text-sm font-semibold text-slate-500 -mt-4 mb-2">Help us understand the property and any history.</p>

      <div className="grid grid-cols-1 gap-4">
        {renderBooleanRadio('property.woodenConstruction', 'The property has combustible (wooden) construction')}
        {renderBooleanRadio('property.nonCombustibleMaterial', 'The property is primarily built of non-combustible material (brick, concrete)')}
        {/* ABY-334 — "proposer aged 45+" is derived from the date of birth
            captured on the policyholder step, not asked here. */}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Alarm installed" required error={getErrorMessage('property.alarm')}>
          <Select
            {...register('property.alarm')}
            options={HOME_YES_NO_OPTIONS}
            error={!!getErrorMessage('property.alarm')}
            showValid
            placeholder="Select"
          />
        </FormField>
        <FormField label="Year built" required error={getErrorMessage('property.yearBuilt')}>
          <Select
            {...register('property.yearBuilt')}
            options={HOME_YEAR_BUILT_OPTIONS}
            error={!!getErrorMessage('property.yearBuilt')}
            showValid
            placeholder="Select"
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FormField label="Previous claims" required error={getErrorMessage('risk.previousClaims')}>
          <Select
            {...register('risk.previousClaims')}
            options={HOME_PREVIOUS_CLAIMS_OPTIONS}
            error={!!getErrorMessage('risk.previousClaims')}
            showValid
            placeholder="Select"
          />
        </FormField>
        <FormField label={HOME_NO_CLAIMS_DISCOUNT_LABEL} required error={getErrorMessage('risk.noClaimsDiscount')}>
          <Select
            {...register('risk.noClaimsDiscount')}
            options={HOME_NO_CLAIMS_DISCOUNT_OPTIONS}
            error={!!getErrorMessage('risk.noClaimsDiscount')}
            showValid
            placeholder="Select"
          />
        </FormField>
        <FormField label="Excess" required error={getErrorMessage('risk.increasedExcess')}>
          <Select
            {...register('risk.increasedExcess')}
            options={HOME_INCREASED_EXCESS_OPTIONS}
            error={!!getErrorMessage('risk.increasedExcess')}
            showValid
            placeholder="Select"
          />
        </FormField>
      </div>
    </SectionCard>
  );
}
