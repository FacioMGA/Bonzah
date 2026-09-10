import React, { useMemo } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import {
  Checkbox,
  DateInput,
  FormField,
  SectionCard,
  WizardInput as Input,
  WizardSelect as Select,
  WizardSearchableSelect as SearchableSelect,
  PhoneInputField,
} from '@/src/shared/ui';
import AddressAutocomplete from '@/src/shared/components/AddressAutocomplete';
import { User, Phone, Shield, BadgeCheck } from 'lucide-react';
import { countries } from '@facio/products';
import { addFlagsToCountryOptions } from '@/src/shared/lib/utils/countryOptions';
import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';
import { postcodeInputHintForCountry } from '@/src/shared/lib/wizard/utils/postcodeInput';
import { taxIdentifierFieldCopy } from '@/src/shared/lib/wizard/utils/taxIdentifierLabel';
import { getOperatingCountryFromHost } from '@/src/shared/lib/tenant/operatingCountry';

const TODAY_ISO = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const COUNTRY_OPTIONS_WITH_FLAGS = addFlagsToCountryOptions(
  countries.map((c) => ({ value: c, label: c })),
);

/**
 * Universal PolicyHolder step.
 *
 * Used by every product wizard's personal-details block. Phase 6k
 * (2026-04-28) absorbed motor's Step1YourDetails into this component;
 * motor's autofill pulses, phone-checkmark, and per-country postcode
 * normalisation were intentionally dropped — UX cues that don't
 * generalise are not a reason to maintain a 371-LOC parallel
 * implementation. Phase 6j extends this with idTypeOptions +
 * include.addressLine2 + a removed outer wrapper so Travel's Step6
 * personal-details JSX can collapse onto a single mount.
 *
 * Expected RHF form field paths (default pathPrefix = 'proposer'):
 *   proposer.firstName, proposer.lastName, proposer.email,
 *   proposer.confirmEmail (when `include.confirmEmail`),
 *   proposer.phone, proposer.dateOfBirth, proposer.nationality,
 *   proposer.nif, proposer.occupation,
 *   proposer.address.line1, proposer.address.line2 (when
 *   `include.addressLine2`), proposer.address.city,
 *   proposer.address.province, proposer.address.postcode,
 *   proposer.address.country, proposer.marketingConsent,
 *   proposer.privacyPolicyAccepted (when `include.privacyPolicyAccepted`),
 *   proposer.idType, proposer.idNumber.
 */
export interface PolicyHolderStepProps {
  /** Default: 'proposer'. Every product uses 'proposer'. */
  pathPrefix?: string;
  /**
   * Product-specific content that belongs after primary policyholder contact
   * fields but before declarations / marketing copy.
   */
  afterContactSlot?: React.ReactNode;
  /** Which optional fields to include. */
  include?: {
    dateOfBirth?: boolean;
    nationality?: boolean;
    domicileCountry?: boolean;
    nif?: boolean;
    occupation?: boolean;
    marketingConsent?: boolean;
    /** Motor-style explicit privacy-policy acknowledgement checkbox. */
    privacyPolicyAccepted?: boolean;
    idType?: boolean;
    /**
     * Render a second "Confirm email" input next to email.
     * The product owns the Zod/RHF rule that requires the two values to
     * match — this prop just renders the input.
     */
    confirmEmail?: boolean;
    /** Render an optional second address line between line 1 and city. */
    addressLine2?: boolean;
  };
  /**
   * Custom ID-type options when `include.idType` is true. Defaults to
   * `[passport, id_card]`. Travel passes its 3-option list.
   */
  idTypeOptions?: Array<{ value: string; label: string }>;
  defaultCountry?: string;
  defaultNationality?: string;
  defaultPhoneRegion?: string;
}

function p(prefix: string, path: string): string {
  return `${prefix}.${path}`;
}

const DEFAULT_ID_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'passport', label: 'Passport' },
  { value: 'id_card', label: 'ID card' },
];

export function PolicyHolderStep({
  pathPrefix = 'proposer',
  afterContactSlot,
  include = { dateOfBirth: true, nationality: true, domicileCountry: false, nif: true, occupation: false, marketingConsent: true },
  idTypeOptions = DEFAULT_ID_TYPE_OPTIONS,
  defaultCountry = 'Cyprus',
  defaultNationality = 'United Kingdom',
  defaultPhoneRegion = 'CY',
}: PolicyHolderStepProps) {
  // ABY-299: limit Google Places suggestions to the operating tenant's
  // country on customer-facing wizards. The operator's tenant is
  // derived from the host; on localhost / dev / unknown hosts the
  // helper returns null and the dropdown stays unrestricted (so dev
  // and BO-style usage remain unaffected).
  const operatingCountry = getOperatingCountryFromHost();
  const addressRestrictions = operatingCountry ? [operatingCountry] : undefined;
  // ABY / Theo 2026-07-21: the personal tax/identity field is
  // jurisdiction-specific — CY expats give a passport number, GR calls it
  // the AFM, PT/ES the NIF. Drive the label + placeholder off the operating
  // tenant instead of a single hardcoded "NIF / Tax ID".
  const taxIdCopy = taxIdentifierFieldCopy(operatingCountry);
  const { control, register, setValue, watch, formState: { errors } } = useFormContext();
  const getErrorMessage = (path: string): string | undefined =>
    getNestedError(errors as Record<string, unknown>, path);

  const showIdSection = Boolean(include.idType);
  const showMarketingPrivacy = Boolean(include.marketingConsent || include.privacyPolicyAccepted);
  const maxDob = useMemo(() => TODAY_ISO(), []);

  // Watch autofilled fields so inputs become controlled and re-render
  // immediately when setValue is called from onAddressSelect. Without
  // this, WizardTextInput's internal liveValue stays stale after an
  // autocomplete selection and the valid checkmark never shows (ABY-164/165).
  const watchedCity = watch(p(pathPrefix, 'address.city'));
  const watchedPostcode = watch(p(pathPrefix, 'address.postcode'));
  const watchedCountry = watch(p(pathPrefix, 'address.country'));

  // ABY-67 — every FormField in this universal personal-details mount
  // declares its `fieldKey`, which is what the wizard's `scrollToField`
  // helper looks up via `[data-field=...]` / `#field-...`. Without
  // these the helper falls back to `[name=key]` only — which works
  // for fields registered directly via `register(...)` but FAILS for
  // fields wrapped in a `<Controller>` (address line1, nationality,
  // domicile, phone), and inconsistently for `<Input>` primitives that
  // don't forward the `name` attribute. Setting fieldKey here is the
  // single change that makes the validation-summary scroll-to-error
  // work across motor / home / travel because all three mount this
  // exact component.
  return (
    <>
      <SectionCard title="Personal Details" icon={<User className="w-5 h-5" />}>
        <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6">
          <FormField label="First name" required error={getErrorMessage(p(pathPrefix, 'firstName'))} fieldKey={p(pathPrefix, 'firstName')}>
            <Input
              {...register(p(pathPrefix, 'firstName'))}
              error={!!getErrorMessage(p(pathPrefix, 'firstName'))}
              showValid
              placeholder="Enter your first name"
            />
          </FormField>
          <FormField label="Last name" required error={getErrorMessage(p(pathPrefix, 'lastName'))} fieldKey={p(pathPrefix, 'lastName')}>
            <Input
              {...register(p(pathPrefix, 'lastName'))}
              error={!!getErrorMessage(p(pathPrefix, 'lastName'))}
              showValid
              placeholder="Enter your last name"
            />
          </FormField>
        </div>

        <FormField label="Address" required error={getErrorMessage(p(pathPrefix, 'address.line1'))} fieldKey={p(pathPrefix, 'address.line1')}>
          <Controller
            name={p(pathPrefix, 'address.line1')}
            control={control}
            render={({ field }) => (
              <AddressAutocomplete
                value={String(field.value || '')}
                onChange={(v) => field.onChange(v)}
                onAddressSelect={(data) => {
                  setValue(p(pathPrefix, 'address.line1'), data.address || '', { shouldDirty: true, shouldValidate: false });
                  setValue(p(pathPrefix, 'address.city'), data.city || '', { shouldDirty: true, shouldValidate: false });
                  setValue(p(pathPrefix, 'address.province'), data.state || '', { shouldDirty: true, shouldValidate: false });
                  setValue(p(pathPrefix, 'address.postcode'), data.zip || '', { shouldDirty: true, shouldValidate: false });
                  setValue(p(pathPrefix, 'address.country'), data.country || defaultCountry, { shouldDirty: true, shouldValidate: false });
                }}
                placeholder="Start typing your address..."
                inputVariant="ui"
                componentRestrictions={addressRestrictions}
              />
            )}
          />
        </FormField>

        {include.addressLine2 && (
          <FormField label="Address Line 2" error={getErrorMessage(p(pathPrefix, 'address.line2'))} fieldKey={p(pathPrefix, 'address.line2')}>
            <Input
              {...register(p(pathPrefix, 'address.line2'))}
              error={!!getErrorMessage(p(pathPrefix, 'address.line2'))}
              showValid
              placeholder="Apartment, suite, building (optional)"
            />
          </FormField>
        )}

        <div className="grid grid-cols-1 gap-0 md:grid-cols-3 md:gap-6">
          <FormField label="City" required error={getErrorMessage(p(pathPrefix, 'address.city'))} fieldKey={p(pathPrefix, 'address.city')}>
            <Input
              {...register(p(pathPrefix, 'address.city'))}
              value={String(watchedCity ?? '')}
              error={!!getErrorMessage(p(pathPrefix, 'address.city'))}
              showValid
              placeholder="City"
            />
          </FormField>
          <FormField label="Postal code" error={getErrorMessage(p(pathPrefix, 'address.postcode'))} fieldKey={p(pathPrefix, 'address.postcode')}>
            {/*
              ABY-55 / ABY-341: the mobile keyboard hint is country-aware.
              CY / ES / MT / IE postcodes are all digits → numeric keypad.
              PT (NNNN-NNN) and GB (alphanumeric, e.g. SW1A 1AA) need the
              text keyboard, otherwise the hyphen key emits "." and letters
              can't be typed at all. `type="text"` is preserved so RHF still
              receives a string (the schema rule is `postalCode`).
            */}
            <Input
              {...register(p(pathPrefix, 'address.postcode'))}
              value={String(watchedPostcode ?? '')}
              error={!!getErrorMessage(p(pathPrefix, 'address.postcode'))}
              showValid
              inputMode={postcodeInputHintForCountry(String(watchedCountry ?? '')).inputMode}
              pattern={postcodeInputHintForCountry(String(watchedCountry ?? '')).pattern}
              autoComplete="postal-code"
              placeholder="Post code"
            />
          </FormField>
          <FormField label="Country" error={getErrorMessage(p(pathPrefix, 'address.country'))} fieldKey={p(pathPrefix, 'address.country')}>
            <Input
              {...register(p(pathPrefix, 'address.country'))}
              value={String(watchedCountry ?? '')}
              error={!!getErrorMessage(p(pathPrefix, 'address.country'))}
              showValid
              placeholder={defaultCountry}
            />
          </FormField>
        </div>

        {(include.dateOfBirth || include.nationality || include.domicileCountry || include.nif || include.occupation) && (
          <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
            {include.dateOfBirth && (
              <FormField label="Date of birth" required error={getErrorMessage(p(pathPrefix, 'dateOfBirth'))} fieldKey={p(pathPrefix, 'dateOfBirth')}>
                {/*
                  ABY-68: hybrid date input — left side is the smart text
                  field (DD/MM/YYYY autoformatting + validation), right
                  side is a calendar icon that opens the native date
                  picker. Renders as `<DateInput>` instead of the legacy
                  `<Input type="date">` so iOS / Android phones show a
                  natural typing-first surface like the marker.io report
                  asks for, while keeping the native picker one tap away.
                */}
                <Controller
                  name={p(pathPrefix, 'dateOfBirth')}
                  control={control}
                  render={({ field }) => (
                    <DateInput
                      // Forward the RHF field name to the inner `<input>`
                      // so screen readers, browser autofill, and our
                      // dob-hydration regression suite can find it via
                      // `input[name="proposer.dateOfBirth"]`. This was
                      // dropped accidentally when ABY-68 swapped from
                      // `<Input type="date">` to `<DateInput>`.
                      name={field.name}
                      value={String(field.value || '')}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      max={maxDob}
                      error={!!getErrorMessage(p(pathPrefix, 'dateOfBirth'))}
                      placeholder="DD/MM/YYYY"
                    />
                  )}
                />
              </FormField>
            )}
            {include.nationality && (
              <FormField label="Nationality" required error={getErrorMessage(p(pathPrefix, 'nationality'))} fieldKey={p(pathPrefix, 'nationality')}>
                <Controller
                  name={p(pathPrefix, 'nationality')}
                  control={control}
                  render={({ field }) => (
                    <SearchableSelect
                      value={String(field.value || '')}
                      onChange={(val) => field.onChange(val)}
                      error={!!getErrorMessage(p(pathPrefix, 'nationality'))}
                      showValid
                      options={COUNTRY_OPTIONS_WITH_FLAGS}
                      placeholder={`Search nationality (default: ${defaultNationality})…`}
                      searchPlaceholder="Type to search..."
                    />
                  )}
                />
              </FormField>
            )}
            {include.domicileCountry && (
              <FormField label="Country of domicile" required error={getErrorMessage(p(pathPrefix, 'domicileCountry'))} fieldKey={p(pathPrefix, 'domicileCountry')}>
                <Controller
                  name={p(pathPrefix, 'domicileCountry')}
                  control={control}
                  render={({ field }) => (
                    <SearchableSelect
                      value={String(field.value || '')}
                      onChange={(val) => field.onChange(val)}
                      error={!!getErrorMessage(p(pathPrefix, 'domicileCountry'))}
                      showValid
                      options={COUNTRY_OPTIONS_WITH_FLAGS}
                      placeholder={`Search country of domicile (default: ${defaultCountry})…`}
                      searchPlaceholder="Type to search..."
                    />
                  )}
                />
              </FormField>
            )}
            {include.nif && (
              <FormField label={taxIdCopy.label} error={getErrorMessage(p(pathPrefix, 'nif'))} fieldKey={p(pathPrefix, 'nif')}>
                <Input
                  {...register(p(pathPrefix, 'nif'))}
                  error={!!getErrorMessage(p(pathPrefix, 'nif'))}
                  showValid
                  placeholder={taxIdCopy.placeholder}
                />
              </FormField>
            )}
            {include.occupation && (
              <FormField label="Occupation" error={getErrorMessage(p(pathPrefix, 'occupation'))} fieldKey={p(pathPrefix, 'occupation')}>
                <Input
                  {...register(p(pathPrefix, 'occupation'))}
                  error={!!getErrorMessage(p(pathPrefix, 'occupation'))}
                  showValid
                  placeholder="e.g. Software engineer"
                />
              </FormField>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Contact Information" icon={<Phone className="w-5 h-5" />}>
        <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6">
          <FormField label="Email" required error={getErrorMessage(p(pathPrefix, 'email'))} fieldKey={p(pathPrefix, 'email')}>
            <Input
              type="email"
              {...register(p(pathPrefix, 'email'))}
              error={!!getErrorMessage(p(pathPrefix, 'email'))}
              showValid
              placeholder="your.email@example.com"
            />
          </FormField>
          {include.confirmEmail && (
            <FormField label="Confirm email" required error={getErrorMessage(p(pathPrefix, 'confirmEmail'))} fieldKey={p(pathPrefix, 'confirmEmail')}>
              <Input
                type="email"
                {...register(p(pathPrefix, 'confirmEmail'))}
                error={!!getErrorMessage(p(pathPrefix, 'confirmEmail'))}
                showValid
                placeholder="Re-enter your email"
              />
            </FormField>
          )}
          <FormField label="Phone" required error={getErrorMessage(p(pathPrefix, 'phone'))} fieldKey={p(pathPrefix, 'phone')}>
            <Controller
              name={p(pathPrefix, 'phone')}
              control={control}
              render={({ field }) => (
                <PhoneInputField
                  value={String(field.value || '')}
                  onChange={(v: string | undefined) => field.onChange(v || '')}
                  defaultCountry={defaultPhoneRegion as never}
                />
              )}
            />
          </FormField>
        </div>
      </SectionCard>

      {afterContactSlot}

      {showIdSection && (
        <SectionCard title="Identification" icon={<BadgeCheck className="w-5 h-5" />}>
          <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6">
            <FormField label="ID type" required error={getErrorMessage(p(pathPrefix, 'idType'))} fieldKey={p(pathPrefix, 'idType')}>
              <Select
                {...register(p(pathPrefix, 'idType'))}
                options={idTypeOptions}
                placeholder="Select ID type..."
              />
            </FormField>
            <FormField label="ID number" required error={getErrorMessage(p(pathPrefix, 'idNumber'))} fieldKey={p(pathPrefix, 'idNumber')}>
              <Input
                {...register(p(pathPrefix, 'idNumber'))}
                error={!!getErrorMessage(p(pathPrefix, 'idNumber'))}
                showValid
                placeholder="Enter ID number"
              />
            </FormField>
          </div>
        </SectionCard>
      )}

      {showMarketingPrivacy && (
        <SectionCard title="Marketing & Privacy" icon={<Shield className="w-5 h-5" />}>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-700">
              By completing the below you are agreeing for us to contact you to discuss your insurance needs.
            </p>
          </div>
          {include.marketingConsent && (
            <Checkbox
              {...register(p(pathPrefix, 'marketingConsent'))}
              label="I'm happy to receive product updates and offers by email."
            />
          )}
          {include.privacyPolicyAccepted && (
            <FormField label="" error={getErrorMessage(p(pathPrefix, 'privacyPolicyAccepted'))} fieldKey={p(pathPrefix, 'privacyPolicyAccepted')}>
              <Checkbox
                {...register(p(pathPrefix, 'privacyPolicyAccepted'))}
                label="I have read and accept the Privacy Policy."
              />
            </FormField>
          )}
        </SectionCard>
      )}
    </>
  );
}
