import { useEffect } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { User, Users } from 'lucide-react';
import { FormField, Input, RadioGroup, SectionCard } from '@/src/shared/ui';
import { TRAVEL_COVER_TYPE_OPTIONS } from '@facio/products';
import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';

const COVER_TYPE_TOOLTIP =
  'Single Person - One single person of any age up to 79 years of age who is named on the policy.\n\n' +
  'Couple - Any adult couple (including same sex) in a common-law relationship or who have co-habited for at least 6 months.\n\n' +
  'Family - Any adult couple (including same sex) in a common-law relationship or who have co-habited for at least 6 months and all dependent children up to and including 17 years of age.\n\n' +
  'Single Parent Family - One adult and all dependent children up to and including 17 years of age.';

const COVER_TYPE_OPTIONS = [
  ...TRAVEL_COVER_TYPE_OPTIONS.map((option) => ({
    ...option,
    icon: option.value === 'single' || option.value === 'single_parent_family'
      ? <User className="w-5 h-5" />
      : <Users className="w-5 h-5" />,
  })),
];

export function Step2Travellers() {
  const { control, watch, setValue, formState: { errors } } = useFormContext();
  const err = (path: string) => getNestedError(errors as Record<string, unknown>, path);
  const travellers = (watch('travellers') || {}) as Record<string, unknown>;
  const coverType = String(travellers.coverType || '');
  const travellerCount = (() => {
    const raw = Number(travellers.travellerCount);
    if (coverType === 'couple') return 2;
    if (coverType === 'family' || coverType === 'single_parent_family') {
      return Number.isFinite(raw) && raw >= 3 ? Math.floor(raw) : 3;
    }
    return 1;
  })();
  const additionalDobCount = Math.max(0, travellerCount - 1);
  const additionalDobValues = Array.isArray(travellers.additionalTravellerDOBs)
    ? travellers.additionalTravellerDOBs.map(String)
    : [];

  useEffect(() => {
    const minimum = coverType === 'couple' ? 2 : coverType === 'family' || coverType === 'single_parent_family' ? 3 : 1;
    const nextCount = coverType === 'family' || coverType === 'single_parent_family'
      ? Math.max(minimum, Number.isFinite(Number(travellers.travellerCount)) ? Math.floor(Number(travellers.travellerCount)) : minimum)
      : minimum;
    if (Number(travellers.travellerCount) !== nextCount) {
      setValue('travellers.travellerCount', nextCount, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
    }
    const current = Array.isArray(travellers.additionalTravellerDOBs)
      ? travellers.additionalTravellerDOBs.map(String)
      : [];
    const targetLength = Math.max(0, nextCount - 1);
    if (current.length !== targetLength) {
      setValue(
        'travellers.additionalTravellerDOBs',
        Array.from({ length: targetLength }, (_, index) => current[index] || ''),
        { shouldDirty: true, shouldTouch: true, shouldValidate: false },
      );
    }
  }, [coverType, setValue, travellers.additionalTravellerDOBs, travellers.travellerCount]);

  const updateAdditionalDob = (index: number, value: string) => {
    const next = Array.from({ length: additionalDobCount }, (_, idx) => additionalDobValues[idx] || '');
    next[index] = value;
    setValue('travellers.additionalTravellerDOBs', next, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
  };

  return (
    <SectionCard title="Travellers" icon={<Users className="w-5 h-5" />}>
      <FormField
        label="Who would you like the insurance to cover?"
        tooltip={COVER_TYPE_TOOLTIP}
        error={err('travellers.coverType')}
      >
        <Controller
          name="travellers.coverType"
          control={control}
          render={({ field }) => (
            <RadioGroup
              name="travellers.coverType"
              value={String(field.value ?? '')}
              onChange={(next) => {
                field.onChange(next);
                const nextCount = next === 'couple' ? 2 : next === 'family' || next === 'single_parent_family' ? 3 : 1;
                setValue('travellers.travellerCount', nextCount, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                setValue(
                  'travellers.additionalTravellerDOBs',
                  Array.from({ length: Math.max(0, nextCount - 1) }, () => ''),
                  { shouldDirty: true, shouldTouch: true, shouldValidate: false },
                );
              }}
              options={COVER_TYPE_OPTIONS}
              error={!!err('travellers.coverType')}
            />
          )}
        />
      </FormField>

      <FormField
        label="Lead Traveller's Date Of Birth (DD/MM/YYYY)"
        error={err('travellers.leadTravellerDOB')}
      >
        <Controller
          name="travellers.leadTravellerDOB"
          control={control}
          render={({ field }) => (
            <Input
              type="date"
              variant="ui"
              error={!!err('travellers.leadTravellerDOB')}
              value={String(field.value ?? '')}
              onValueChange={(next) => field.onChange(next)}
              onBlur={field.onBlur}
            />
          )}
        />
      </FormField>

      {(coverType === 'family' || coverType === 'single_parent_family') && (
        <FormField
          label="Number of travellers"
          error={err('travellers.travellerCount')}
        >
          <Input
            type="number"
            variant="ui"
            min={3}
            max={10}
            value={String(travellerCount)}
            onChange={(event) => {
              const next = Math.max(3, Math.min(10, Number(event.currentTarget.value) || 3));
              setValue('travellers.travellerCount', next, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
              setValue(
                'travellers.additionalTravellerDOBs',
                Array.from({ length: next - 1 }, (_, index) => additionalDobValues[index] || ''),
                { shouldDirty: true, shouldTouch: true, shouldValidate: false },
              );
            }}
          />
        </FormField>
      )}

      {additionalDobCount > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="mb-3 text-sm font-bold text-slate-900">
            Additional traveller dates of birth
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {Array.from({ length: additionalDobCount }, (_, index) => (
              <FormField
                key={index}
                label={`Traveller ${index + 2} Date Of Birth (DD/MM/YYYY)`}
                error={err(`travellers.additionalTravellerDOBs.${index}`) || (index === 0 ? err('travellers.additionalTravellerDOBs') : undefined)}
              >
                <Input
                  type="date"
                  variant="ui"
                  error={Boolean(err(`travellers.additionalTravellerDOBs.${index}`) || err('travellers.additionalTravellerDOBs'))}
                  value={additionalDobValues[index] || ''}
                  onValueChange={(next) => updateAdditionalDob(index, next)}
                />
              </FormField>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
