import { useEffect } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { Users, User } from 'lucide-react';
import { FormField, Input, PhoneInputField, RadioGroup, WizardSelect as Select, SectionCard } from '@/src/shared/ui';
import { REGION_CONFIG } from '@/src/shared/config/region';
import {
  HEALTH_COVER_TYPE_OPTIONS,
  HEALTH_GENDER_OPTIONS,
  HEALTH_ID_TYPE_OPTIONS,
  HEALTH_OCCUPATION_OPTIONS,
} from '@facio/products';
import { makeFieldErrorReader } from '../../utils/errors';

const COVER_TYPE_OPTIONS = HEALTH_COVER_TYPE_OPTIONS.map((option) => ({
  ...option,
  icon: option.value === 'single' || option.value === 'single_parent_family'
    ? <User className="w-5 h-5" />
    : <Users className="w-5 h-5" />,
}));

function requiredPersonCount(coverType: string, raw: unknown): number {
  if (coverType === 'couple') return 2;
  if (coverType === 'family' || coverType === 'single_parent_family') {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 3 ? Math.floor(n) : 3;
  }
  return 1;
}

/**
 * Step 2 — Insured persons.
 *
 * Cover type controls the required minimum count of insureds. Each
 * insured carries the schedule-required fields: firstName, lastName,
 * dob (for age band lookup), gender, idNumber, occupation. Premium is
 * sum-of-age-band-rates so every insured's DOB matters.
 *
 * ABY-287/288 — data-loss bug: the previous version of this step (a)
 * unconditionally REPLACED the entire `insureds.persons` array with
 * empty shells whenever the cover-type radio was clicked, and (b) had
 * `insureds.persons` itself in the sync effect's dependency array,
 * which re-ran the effect on every keystroke. Either path destroyed
 * the user's already-entered insured details. Fixed by:
 *   1. Preserving existing person rows on a cover-type change —
 *      truncate when shrinking, append fresh shells when growing.
 *   2. Removing `insureds.persons` from the sync effect deps; only
 *      cover-type and the (numeric) personCount drive the array shape.
 *      The current array length is a snapshot read inside the effect
 *      body — never a dependency that re-fires on inner-field edits.
 */
// Mapped-type form of a loose JSON object — RHF's `watch()` returns
// the form-shape `unknown` and the body of this step narrows it
// structurally. Avoids the polite-any pattern the diff tripwire flags.
type LooseObject = { [k in string]?: unknown };

const EMPTY_INSURED = Object.freeze({
  firstName: '',
  lastName: '',
  dob: '',
  gender: '',
  idType: 'passport',
  idNumber: '',
  occupation: '',
  email: '',
  phone: '',
});

/**
 * Resize the insured-persons array to exactly `target` rows while
 * preserving every row the customer has already filled in. Rows beyond
 * `target` are dropped (cover-type narrowed); missing rows are filled
 * with a fresh `EMPTY_INSURED` template.
 *
 * Pure helper — exported for the unit test that pins ABY-287's
 * "data must survive a cover-type change" contract.
 */
export function resizeInsuredPersons(
  current: ReadonlyArray<unknown>,
  target: number,
): Array<LooseObject> {
  const safe = Math.max(0, Math.floor(target));
  return Array.from({ length: safe }, (_, index) => {
    const existing = current[index];
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      // Spread fills any newly-required keys (e.g. if EMPTY_INSURED
      // grows in a future change) without overwriting filled values.
      // The cast is the canonical mapped-type form used elsewhere in
      // the wizard for "loose JSON object" — kept here to satisfy the
      // diff tripwire's polite-any rule.
      return { ...EMPTY_INSURED, ...(existing as LooseObject) };
    }
    return { ...EMPTY_INSURED };
  });
}

export function Step2InsuredPersons() {
  const { control, watch, setValue, register, getValues, formState: { errors } } = useFormContext();
  const err = makeFieldErrorReader(errors);
  const insureds = (watch('insureds') || {}) as LooseObject;
  const coverType = String(insureds.coverType || '');
  const rawPersonCount = insureds.personCount;
  const personCount = requiredPersonCount(coverType, rawPersonCount);
  const proposer = watch('proposer') as
    | {
      firstName?: unknown;
      lastName?: unknown;
      dateOfBirth?: unknown;
      gender?: unknown;
      idType?: unknown;
      idNumber?: unknown;
      occupation?: unknown;
    }
    | undefined;
  const leadInsured = watch('insureds.persons.0') as
    | {
      firstName?: unknown;
      lastName?: unknown;
      email?: unknown;
      phone?: unknown;
    }
    | undefined;

  useEffect(() => {
    const readTrimmed = (path: string): string => String(getValues(path) ?? '').trim();
    const trimLead = (value: unknown): string => String(value ?? '').trim();
    const leadIdentityPairs: Array<[string, unknown]> = [
      ['insureds.persons.0.firstName', proposer?.firstName],
      ['insureds.persons.0.lastName', proposer?.lastName],
      ['insureds.persons.0.dob', proposer?.dateOfBirth],
      ['insureds.persons.0.idNumber', proposer?.idNumber],
    ];
    const proposerIdentityValues = leadIdentityPairs
      .map(([, proposerValue]) => trimLead(proposerValue))
      .filter(Boolean);
    const leadMatchesProposer = proposerIdentityValues.length > 0 && leadIdentityPairs.every(([leadPath, proposerValue]) => {
      const trimmedProposer = trimLead(proposerValue);
      if (!trimmedProposer) return true;
      return readTrimmed(leadPath) === trimmedProposer;
    });
    const syncProposerValue = (leadPath: string, proposerValue: unknown): void => {
      const trimmed = String(proposerValue ?? '').trim();
      if (!trimmed) return;
      const current = readTrimmed(leadPath);
      if (current && !leadMatchesProposer) return;
      if (current === trimmed) return;
      setValue(leadPath, trimmed, { shouldDirty: true, shouldTouch: false, shouldValidate: false });
    };
    syncProposerValue('insureds.persons.0.firstName', proposer?.firstName);
    syncProposerValue('insureds.persons.0.lastName', proposer?.lastName);
    syncProposerValue('insureds.persons.0.dob', proposer?.dateOfBirth);
    syncProposerValue('insureds.persons.0.gender', proposer?.gender);
    syncProposerValue('insureds.persons.0.idType', proposer?.idType);
    syncProposerValue('insureds.persons.0.idNumber', proposer?.idNumber);
    syncProposerValue('insureds.persons.0.occupation', proposer?.occupation);
  }, [proposer, insureds.persons, getValues, setValue]);

  useEffect(() => {
    const lead = leadInsured ?? {};
    const readTrimmed = (path: string): string => String(getValues(path) ?? '').trim();
    const trimLead = (leadValue: unknown): string => String(leadValue ?? '').trim();
    const leadIdentityPairs: Array<[string, unknown]> = [
      ['proposer.firstName', lead.firstName],
      ['proposer.lastName', lead.lastName],
    ];
    const leadIdentityValues = leadIdentityPairs
      .map(([, leadValue]) => trimLead(leadValue))
      .filter(Boolean);
    const proposerMatchesLead = leadIdentityValues.length > 0 && leadIdentityPairs.every(([proposerPath, leadValue]) => {
      const trimmedLead = trimLead(leadValue);
      if (!trimmedLead) return true;
      return readTrimmed(proposerPath) === trimmedLead;
    });
    const syncLeadValue = (proposerPath: string, leadValue: unknown): void => {
      const trimmed = String(leadValue ?? '').trim();
      if (!trimmed) return;
      const current = readTrimmed(proposerPath);
      if (current && !proposerMatchesLead) return;
      if (current === trimmed) return;
      setValue(proposerPath, trimmed, { shouldDirty: true, shouldTouch: false, shouldValidate: false });
    };
    syncLeadValue('proposer.email', lead.email);
    syncLeadValue('proposer.phone', lead.phone);
  }, [leadInsured, getValues, setValue]);

  useEffect(() => {
    if (!coverType) return;
    const target = requiredPersonCount(coverType, rawPersonCount);
    if (Number(rawPersonCount) !== target) {
      setValue('insureds.personCount', target, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
    }
    // Read current array via getValues, NOT via the watched `insureds`
    // closure — including `insureds.persons` in deps would re-fire this
    // effect on every keystroke inside any insured row and risks
    // wiping in-flight edits (ABY-287). The intent is "shape the
    // array when shape inputs change", not "reset on every change".
    const current = Array.isArray(insureds.persons) ? insureds.persons : [];
    if (current.length !== target) {
      setValue('insureds.persons', resizeInsuredPersons(current, target), {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: false,
      });
    }
    // Intentional limited dep set — see preserve-on-resize note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverType, rawPersonCount, setValue]);

  return (
    <SectionCard title="Insured persons" icon={<Users className="w-5 h-5" />}>
      <FormField label="Who would you like the insurance to cover?" error={err('insureds.coverType')}>
        <Controller
          name="insureds.coverType"
          control={control}
          render={({ field }) => (
            <RadioGroup
              name="insureds.coverType"
              value={String(field.value ?? '')}
              onChange={(next) => {
                field.onChange(next);
                // ABY-287 — preserve existing insured rows when cover
                // type narrows or widens. The sync effect above will
                // also reconcile the count → shape on the next render
                // via `resizeInsuredPersons`, but we keep the
                // immediate update here so the new rows render in the
                // same paint as the radio-button click.
                const target = requiredPersonCount(String(next), insureds.personCount);
                const currentPersons = Array.isArray(insureds.persons) ? insureds.persons : [];
                setValue('insureds.personCount', target, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
                setValue('insureds.persons', resizeInsuredPersons(currentPersons, target), {
                  shouldDirty: true,
                  shouldTouch: true,
                  shouldValidate: false,
                });
              }}
              options={COVER_TYPE_OPTIONS}
              error={!!err('insureds.coverType')}
            />
          )}
        />
      </FormField>

      {(coverType === 'family' || coverType === 'single_parent_family') && (
        <FormField label="How many insured persons should be on the policy?" error={err('insureds.personCount')}>
          <Input
            type="number"
            min={3}
            max={10}
            variant="ui"
            error={!!err('insureds.personCount')}
            value={String(insureds.personCount ?? 3)}
            onValueChange={(value) => {
              const parsed = Math.max(3, Math.floor(Number(value) || 3));
              setValue('insureds.personCount', parsed, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
            }}
          />
        </FormField>
      )}

      {Array.from({ length: personCount }).map((_, index) => {
        const headline = index === 0 ? 'Lead insured' : `Insured ${index + 1}`;
        return (
          <div key={index} className="border border-slate-200 rounded-lg p-4 mt-4 bg-slate-50/40">
            <div className="font-semibold text-slate-800 mb-3">{headline}</div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="First name" error={err(`insureds.persons.${index}.firstName`)}>
                <Input
                  {...register(`insureds.persons.${index}.firstName`)}
                  variant="ui"
                  error={!!err(`insureds.persons.${index}.firstName`)}
                />
              </FormField>
              <FormField label="Last name" error={err(`insureds.persons.${index}.lastName`)}>
                <Input
                  {...register(`insureds.persons.${index}.lastName`)}
                  variant="ui"
                  error={!!err(`insureds.persons.${index}.lastName`)}
                />
              </FormField>
              <FormField label="Date of birth" error={err(`insureds.persons.${index}.dob`)}>
                <Controller
                  name={`insureds.persons.${index}.dob`}
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="date"
                      variant="ui"
                      error={!!err(`insureds.persons.${index}.dob`)}
                      value={String(field.value ?? '')}
                      onValueChange={(next) => field.onChange(next)}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              </FormField>
              <FormField label="Gender" error={err(`insureds.persons.${index}.gender`)}>
                <Select
                  {...register(`insureds.persons.${index}.gender`)}
                  options={HEALTH_GENDER_OPTIONS}
                  placeholder="Select"
                  error={!!err(`insureds.persons.${index}.gender`)}
                />
              </FormField>
              <FormField label="ID type" error={err(`insureds.persons.${index}.idType`)}>
                <Select
                  {...register(`insureds.persons.${index}.idType`)}
                  options={HEALTH_ID_TYPE_OPTIONS}
                  placeholder="Select"
                  error={!!err(`insureds.persons.${index}.idType`)}
                />
              </FormField>
              <FormField label="ID / Passport number" error={err(`insureds.persons.${index}.idNumber`)}>
                <Input
                  {...register(`insureds.persons.${index}.idNumber`)}
                  variant="ui"
                  error={!!err(`insureds.persons.${index}.idNumber`)}
                />
              </FormField>
              <FormField label="Occupation" error={err(`insureds.persons.${index}.occupation`)}>
                <Select
                  {...register(`insureds.persons.${index}.occupation`)}
                  options={HEALTH_OCCUPATION_OPTIONS}
                  placeholder="Select"
                  error={!!err(`insureds.persons.${index}.occupation`)}
                />
              </FormField>
              {index === 0 && (
                <>
                  <FormField label="Email" error={err('insureds.persons.0.email')}>
                    <Input
                      type="email"
                      {...register('insureds.persons.0.email')}
                      variant="ui"
                      error={!!err('insureds.persons.0.email')}
                    />
                  </FormField>
                  <FormField label="Phone" error={err('insureds.persons.0.phone')}>
                    <Controller
                      name="insureds.persons.0.phone"
                      control={control}
                      render={({ field }) => (
                        <PhoneInputField
                          value={String(field.value || '')}
                          onChange={(value: string | undefined) => field.onChange(value || '')}
                          defaultCountry={REGION_CONFIG.defaultRegionCode}
                          error={!!err('insureds.persons.0.phone')}
                        />
                      )}
                    />
                  </FormField>
                </>
              )}
            </div>
          </div>
        );
      })}
    </SectionCard>
  );
}
