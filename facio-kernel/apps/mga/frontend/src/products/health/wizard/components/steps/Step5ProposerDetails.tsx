import { useEffect } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { UserCircle } from 'lucide-react';
import {
  FormField,
  Input,
  PhoneInputField,
  WizardSelect as Select,
  SectionCard,
} from '@/src/shared/ui';
import AddressAutocomplete from '@/src/shared/components/AddressAutocomplete';
import { getOperatingCountryFromHost } from '@/src/shared/lib/tenant/operatingCountry';
import { REGION_CONFIG } from '@/src/shared/config/region';
import { countries } from '@facio/products';
import { HEALTH_GENDER_OPTIONS, HEALTH_ID_TYPE_OPTIONS, HEALTH_OCCUPATION_OPTIONS } from '@facio/products';
import { makeFieldErrorReader } from '../../utils/errors';

const COUNTRY_OPTIONS = countries.map((country) => ({ value: country, label: country }));

const YES_NO_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export type HealthProposerDetailsSection = 'details' | 'declarations' | 'all';

/**
 * Proposer details + Lloyd's-approved declarations.
 *
 * Reuses the shared `Input`, `Select`, `PhoneInputField`, and
 * `SectionCard` primitives — no new components. Mirrors the Travel
 * Step 6 declarations pattern (the same five mustAccept checkboxes).
 *
 * ABY-518: `section` splits the combined step so contact details can
 * open the journey (`details`) while declarations stay immediately
 * before payment (`declarations`).
 *
 * ABY-292: when the lead insured (`insureds.persons[0]`) is the same
 * person as the proposer (the typical single-cover case), pre-fill
 * the proposer fields with the lead insured's values to remove the
 * busy-work re-typing. Strict rules:
 *
 *   - Empty proposer fields get filled from the lead insured.
 *   - If the proposer already matches the lead insured's identity,
 *     counterpart fields stay synced when the lead insured is edited
 *     later (for example Student -> Retired on Step 2).
 *   - Pre-filled values are dirty + editable (the operator can adjust).
 *   - The lead insured's `dob` field maps to the proposer's
 *     `dateOfBirth` (different shape on either side, see
 *     `packages/products/src/health/profile.ts`).
 *   - Fields without a counterpart on the insured (address) stay
 *     user-entered. Email and phone are captured on the lead insured
 *     step (ABY-517) and synced here when empty or when the proposer
 *     still matches the lead insured identity.
 */
export function Step5ProposerDetails({ section = 'all' }: { section?: HealthProposerDetailsSection }) {
  const showDetails = section === 'details' || section === 'all';
  const showDeclarations = section === 'declarations' || section === 'all';
  const { register, control, formState: { errors }, watch, setValue, getValues } = useFormContext();
  const err = makeFieldErrorReader(errors);
  const operatingCountry = getOperatingCountryFromHost();
  const addressRestrictions = operatingCountry ? [operatingCountry] : undefined;
  const watchedCity = watch('proposer.address.city');
  const watchedPostcode = watch('proposer.address.postcode');
  const watchedCountry = watch('proposer.address.country');

  const leadInsured = watch('insureds.persons.0') as
    | {
      firstName?: unknown;
      lastName?: unknown;
      dob?: unknown;
      gender?: unknown;
      idType?: unknown;
      idNumber?: unknown;
      occupation?: unknown;
      email?: unknown;
      phone?: unknown;
    }
    | undefined;

  useEffect(() => {
    if (!showDetails) return;
    const lead = leadInsured ?? {};
    const readTrimmed = (path: string): string => String(getValues(path) ?? '').trim();
    const trimLead = (leadValue: unknown): string => String(leadValue ?? '').trim();
    const leadIdentityPairs: Array<[string, unknown]> = [
      ['proposer.firstName', lead.firstName],
      ['proposer.lastName', lead.lastName],
      ['proposer.dateOfBirth', lead.dob],
      ['proposer.idNumber', lead.idNumber],
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
    syncLeadValue('proposer.firstName', lead.firstName);
    syncLeadValue('proposer.lastName', lead.lastName);
    syncLeadValue('proposer.dateOfBirth', lead.dob);
    syncLeadValue('proposer.gender', lead.gender);
    syncLeadValue('proposer.idType', lead.idType);
    syncLeadValue('proposer.idNumber', lead.idNumber);
    syncLeadValue('proposer.occupation', lead.occupation);
    syncLeadValue('proposer.email', lead.email);
    syncLeadValue('proposer.phone', lead.phone);
  }, [leadInsured, getValues, setValue, showDetails]);

  return (
    <div className="space-y-6">
      {showDetails && (
      <SectionCard title="Your details" icon={<UserCircle className="w-5 h-5" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="First name" error={err('proposer.firstName')}>
            <Input {...register('proposer.firstName')} variant="ui" error={!!err('proposer.firstName')} />
          </FormField>
          <FormField label="Last name" error={err('proposer.lastName')}>
            <Input {...register('proposer.lastName')} variant="ui" error={!!err('proposer.lastName')} />
          </FormField>
          <FormField label="Date of birth" error={err('proposer.dateOfBirth')}>
            <Controller
              name="proposer.dateOfBirth"
              control={control}
              render={({ field }) => (
                <Input
                  type="date"
                  variant="ui"
                  error={!!err('proposer.dateOfBirth')}
                  value={String(field.value ?? '')}
                  onValueChange={(next) => field.onChange(next)}
                  onBlur={field.onBlur}
                />
              )}
            />
          </FormField>
          <FormField label="Gender" error={err('proposer.gender')}>
            <Controller
              name="proposer.gender"
              control={control}
              render={({ field }) => (
                <Select
                  value={String(field.value || '')}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                  options={HEALTH_GENDER_OPTIONS}
                  placeholder="Select"
                  error={!!err('proposer.gender')}
                />
              )}
            />
          </FormField>
          <FormField label="ID type" error={err('proposer.idType')}>
            <Controller
              name="proposer.idType"
              control={control}
              render={({ field }) => (
                <Select
                  value={String(field.value || '')}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                  options={HEALTH_ID_TYPE_OPTIONS}
                  placeholder="Select"
                  error={!!err('proposer.idType')}
                />
              )}
            />
          </FormField>
          <FormField label="ID / Passport number" error={err('proposer.idNumber')}>
            <Input {...register('proposer.idNumber')} variant="ui" error={!!err('proposer.idNumber')} />
          </FormField>
          <FormField label="Occupation" error={err('proposer.occupation')}>
            <Controller
              name="proposer.occupation"
              control={control}
              render={({ field }) => (
                <Select
                  value={String(field.value || '')}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                  options={HEALTH_OCCUPATION_OPTIONS}
                  placeholder="Select"
                  error={!!err('proposer.occupation')}
                />
              )}
            />
          </FormField>
          <FormField label="Email" error={err('proposer.email')}>
            <Input type="email" {...register('proposer.email')} variant="ui" error={!!err('proposer.email')} />
          </FormField>
          <FormField label="Confirm email" error={err('proposer.confirmEmail')}>
            <Input type="email" {...register('proposer.confirmEmail')} variant="ui" error={!!err('proposer.confirmEmail')} />
          </FormField>
          <FormField label="Phone" error={err('proposer.phone')}>
            <Controller
              name="proposer.phone"
              control={control}
              render={({ field }) => (
                <PhoneInputField
                  value={String(field.value || '')}
                  onChange={(value: string | undefined) => field.onChange(value || '')}
                  defaultCountry={REGION_CONFIG.defaultRegionCode}
                  error={!!err('proposer.phone')}
                />
              )}
            />
          </FormField>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Address" error={err('proposer.address.line1')}>
            <Controller
              name="proposer.address.line1"
              control={control}
              render={({ field }) => (
                <AddressAutocomplete
                  value={String(field.value || '')}
                  onChange={(value) => field.onChange(value)}
                  onAddressSelect={(data) => {
                    setValue('proposer.address.line1', data.address || '', { shouldDirty: true, shouldValidate: false });
                    setValue('proposer.address.city', data.city || '', { shouldDirty: true, shouldValidate: false });
                    setValue('proposer.address.postcode', data.zip || '', { shouldDirty: true, shouldValidate: false });
                    setValue('proposer.address.country', data.country || REGION_CONFIG.defaultCountry, { shouldDirty: true, shouldValidate: false });
                  }}
                  placeholder="Start typing your address..."
                  inputVariant="ui"
                  componentRestrictions={addressRestrictions}
                />
              )}
            />
          </FormField>
          <FormField label="Address line 2" error={err('proposer.address.line2')}>
            <Input {...register('proposer.address.line2')} variant="ui" />
          </FormField>
          <FormField label="City" error={err('proposer.address.city')}>
            <Input
              {...register('proposer.address.city')}
              value={String(watchedCity ?? '')}
              variant="ui"
              error={!!err('proposer.address.city')}
            />
          </FormField>
          <FormField label="Post code" error={err('proposer.address.postcode')}>
            <Input
              {...register('proposer.address.postcode')}
              value={String(watchedPostcode ?? '')}
              variant="ui"
            />
          </FormField>
          <FormField label="Country" error={err('proposer.address.country')}>
            <Select
              value={String(watchedCountry ?? '')}
              onChange={(e) => setValue('proposer.address.country', e.target.value, { shouldDirty: true, shouldValidate: true })}
              options={COUNTRY_OPTIONS}
              placeholder="Select"
              error={!!err('proposer.address.country')}
            />
          </FormField>
        </div>
      </SectionCard>
      )}

      {showDetails && (
      <SectionCard title="Marketing preferences">
        <FormField label="May we contact you with offers and product updates?" error={err('proposer.marketingConsent')}>
          <Controller
            name="proposer.marketingConsent"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value === true ? 'yes' : field.value === false ? 'no' : ''}
                onChange={(e) => field.onChange(e.target.value === 'yes')}
                options={YES_NO_OPTIONS}
                placeholder="Select"
                error={!!err('proposer.marketingConsent')}
              />
            )}
          />
        </FormField>
      </SectionCard>
      )}

      {showDeclarations && (
      <SectionCard title="Declarations">
        <DeclarationCheck
          name="declarations.medicalNotice"
          label="I have read and acknowledge the Medical Notice — including pre-existing condition exclusions."
        />
        <DeclarationCheck
          name="declarations.howToClaimReview"
          label="I have reviewed the How to Claim, How to Complain and Privacy notices."
        />
        <DeclarationCheck
          name="declarations.personalDataConsent"
          label="I consent to the use of my personal data for the purposes of this insurance."
        />
        <DeclarationCheck
          name="declarations.contractConsent"
          label="I consent to receiving and signing the policy contract electronically."
        />
        <DeclarationCheck
          name="declarations.contractAgreement"
          label="I agree to proceed to the secure payment portal to bind this Immigration Medical Insurance."
        />
      </SectionCard>
      )}
    </div>
  );
}

function DeclarationCheck({ name, label }: { name: string; label: string }) {
  const { register, formState: { errors } } = useFormContext();
  const error = makeFieldErrorReader(errors)(name);
  return (
    <label className="flex items-start gap-3 py-2 text-sm text-slate-700">
      <input
        type="checkbox"
        {...register(name)}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary"
      />
      <div>
        <span>{label}</span>
        {error && <div className="text-xs text-rose-600 mt-1">{error}</div>}
      </div>
    </label>
  );
}
