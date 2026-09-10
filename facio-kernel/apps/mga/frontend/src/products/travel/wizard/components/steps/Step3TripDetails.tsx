import { useEffect, useRef } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { Phone, Plane, RefreshCw } from 'lucide-react';
import { FormField, Input, MultiSearchableSelect, PhoneInputField, RadioGroup, SearchableSelect, SectionCard } from '@/src/shared/ui';
import {
  annualTravelPolicyEndDateFromStart,
  countries,
  TRAVEL_DESTINATION_AREAS,
  TRAVEL_PLAN_TYPE_OPTIONS,
  TRAVEL_PREVIOUS_CLAIM_BAND_OPTIONS,
} from '@facio/products';
import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';
import { REGION_CONFIG } from '@/src/shared/config/region';
import { formatDateInputValueLocal } from '@/src/shared/lib/format';

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

const PLAN_TYPE_TOOLTIP =
  'Single Trip\n' +
  'Cover for one trip or journey starting when you leave home and ending when you return to your home. During your journey you can travel between as many cities and even countries as you wish, provided you have chosen the correct territory.\n\n' +
  'You can purchase a single trip policy if you have already left your country of residence, provided that your country of residence is in the EU, EEA or Monaco. The cover has limitations: There will be no cooling off period; there will be no cover for any pre-existing medical condition from which you have ever suffered; If the period during which you have not had insurance is 7 days or more, there will be no cover under the medical section of the policy for 14 days; the policy must be for the whole remaining period of your trip until you arrive back in your country of residence and the full period of your trip away from your country of residence, including this already travelled policy must not exceed the policy maximums for your age. Full details are in Definition 21 of the full policy wording.\n\n' +
  'Annual multi-trip\n' +
  'Cover for multiple trips during a 12 month period, subject to residency requirement, provided no individual trip lasts longer than the maximum number of days per individual trip that you choose when buying the policy. During your journey you can travel between as many cities and even countries as you wish, provided you have chosen the correct territory.';

const DESTINATIONS_TOOLTIP =
  'Europe\n' +
  'The following countries are classed as Europe for travel purposes: Albania, Andorra, Austria, Azores, Balearic Islands, Belgium, Bosnia Herzegovina, Bulgaria, Canary Islands, Corsica, Croatia, Cyprus, Czech Republic, Denmark, Egypt, Estonia, Finland, France, Germany, Georgia, Gibraltar, Greece, Hungary, Iceland, Irish Republic, Italy, Latvia, Liechtenstein, Lithuania, Luxembourg, Madeira, Malta, Moldova, Monaco, Montenegro, Morocco, Netherlands, North Macedonia, Norway, Poland, Portugal, Romania, San Marino, Serbia, Slovakia, Slovenia, Spain, Sweden, Switzerland, Tunisia, Turkey, United Kingdom (including Channel Islands and Isle of Man), Vatican City.\n\n' +
  'Worldwide excluding the USA and Canada\n' +
  'Cover anywhere in the world but excluding Cuba, Iran, North Korea and the USA and Canada.\n\n' +
  'Worldwide including USA and Canada\n' +
  'Cover anywhere in the world except Cuba, Iran and North Korea.';

const END_DATE_TOOLTIP =
  'Cover for the cancellation of your trip starts on the date we receive your premium.';

const YES_NO_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

const PLAN_TYPE_OPTIONS = [
  ...TRAVEL_PLAN_TYPE_OPTIONS.map((option) => ({
    ...option,
    icon: option.value === 'annual_multi_trip'
      ? <RefreshCw className="w-5 h-5" />
      : <Plane className="w-5 h-5" />,
  })),
];

const DESTINATION_OPTIONS = TRAVEL_DESTINATION_AREAS.map(({ value, label }) => ({ value, label }));

function travelPhoneDefaultCountry(value: string): 'CY' | 'PT' | 'GR' | 'ES' | undefined {
  switch (value) {
    case 'CY':
    case 'PT':
    case 'GR':
    case 'ES':
      return value;
    default:
      return undefined;
  }
}

// ABY-254 — Single-trip destinations are a country multi-select. The
// rating layer (`backend/products/travel/pricing/travelCalculator.ts`
// `mapDestinationsToArea`) already accepts an array of canonical
// country names and maps them to the three rate areas (Europe /
// Worldwide excl / WorldwideInc) via its `EUROPE` and `US_LIKE` sets.
// So the wizard can persist country names directly and the rater
// keeps working unchanged — no backend coupling needed for this
// surface change.
const COUNTRY_OPTIONS = countries.map((country) => ({ value: country, label: country }));

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Step3TripDetails() {
  const { control, register, formState: { errors }, setValue, watch } = useFormContext();
  const err = (path: string) => getNestedError(errors as Record<string, unknown>, path);
  const planType = String(watch('trip.planType') ?? '');
  const startDate = String(watch('trip.startDate') ?? '');
  const isAnnual = planType === 'annual_multi_trip';
  const hasPreviousTravelClaim = watch('risk.hasPreviousTravelClaim');
  const prevPlanWasAnnualRef = useRef(isAnnual);
  const minTripStartDate = formatDateInputValueLocal(new Date());

  useEffect(() => {
    if (isAnnual) {
      if (!startDate) return;
      const endDate = annualTravelPolicyEndDateFromStart(startDate);
      if (endDate) setValue('trip.endDate', endDate, { shouldDirty: true, shouldValidate: true });
    } else if (prevPlanWasAnnualRef.current) {
      // ABY-273 — only clear when leaving annual_multi_trip. Clearing on
      // every startDate change (or on mount) wiped a customer-entered
      // single-trip return date while DateInput still showed the draft
      // (ABY-404: screenshot had both dates, server trip.endDate was empty).
      setValue('trip.endDate', '', { shouldDirty: true, shouldValidate: false });
    }
    prevPlanWasAnnualRef.current = isAnnual;
  }, [isAnnual, setValue, startDate]);


  // When plan type changes to AMT, initialise quote.maxTripDays to 17 so the
  // /rate call at step 3→4 always has a valid value. Only set it when there is
  // no existing value — this prevents overwriting a choice the user already
  // made in Step4 (31 or 45 days) when they navigate back to this step.
  // When switching away from AMT, clear the field so single-trip rate calls
  // never receive a stale maxTripDays.
  const currentMaxTripDays = watch('quote.maxTripDays');
  useEffect(() => {
    if (!isAnnual) {
      setValue('quote.maxTripDays', undefined, { shouldDirty: true });
    } else if (!currentMaxTripDays) {
      setValue('quote.maxTripDays', 17, { shouldDirty: true });
    }
  }, [isAnnual, currentMaxTripDays, setValue]);

  return (
    <div className="space-y-4">
      <SectionCard title="Your contact details" icon={<Phone className="w-5 h-5" />}>
        <p className="mb-4 text-sm text-slate-600">
          We need these details before showing plans so the workspace team can follow up if you need help completing the quote.
        </p>
        <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6">
          <FormField label="First name" required error={err('proposer.firstName')} fieldKey="proposer.firstName">
            <Input
              {...register('proposer.firstName')}
              error={!!err('proposer.firstName')}
              placeholder="Enter your first name"
            />
          </FormField>
          <FormField label="Last name" required error={err('proposer.lastName')} fieldKey="proposer.lastName">
            <Input
              {...register('proposer.lastName')}
              error={!!err('proposer.lastName')}
              placeholder="Enter your last name"
            />
          </FormField>
          <FormField label="Email" required error={err('proposer.email')} fieldKey="proposer.email">
            <Input
              type="email"
              {...register('proposer.email')}
              error={!!err('proposer.email')}
              placeholder="your.email@example.com"
            />
          </FormField>
          <FormField label="Phone" required error={err('proposer.phone')} fieldKey="proposer.phone">
            <Controller
              name="proposer.phone"
              control={control}
              render={({ field }) => (
                <PhoneInputField
                  value={String(field.value || '')}
                  onChange={(value: string | undefined) => field.onChange(value || '')}
                  defaultCountry={travelPhoneDefaultCountry(REGION_CONFIG.defaultPhoneRegionCode)}
                />
              )}
            />
          </FormField>
        </div>
      </SectionCard>

      <SectionCard title="Trip Details" icon={<Plane className="w-5 h-5" />}>

      {/* Plan type — icon radio */}
      <FormField
        label="What type of plan do you need?"
        tooltip={PLAN_TYPE_TOOLTIP}
        error={err('trip.planType')}
        fieldKey="trip.planType"
      >
        <Controller
          name="trip.planType"
          control={control}
          render={({ field }) => (
            <RadioGroup
              name="trip.planType"
              value={String(field.value ?? '')}
              onChange={field.onChange}
              options={PLAN_TYPE_OPTIONS}
              error={!!err('trip.planType')}
            />
          )}
        />
      </FormField>

      {/*
        ABY-61 + ABY-254 — destinations rendering is per planType:

        * Annual multi-trip: a SINGLE territory choice (Europe / Worldwide
          excl. USA & Canada / Worldwide incl. USA & Canada). Annual
          policies cover trips inside the chosen territory bucket; the
          rater treats it as one area of cover.
        * Single trip: a multi-select over the full canonical country
          list (`countries` from @facio/products). The customer picks
          every country they plan to visit; the rater maps the array
          to the appropriate area via `mapDestinationsToArea` (which
          handles country-name arrays AND territory slugs).

        Both shapes write `trip.destinations` as `string[]`, so the
        validation profile (`rule: 'nonEmptyStringArray'`), downstream
        Step6 area derivation, and the rater inputs all keep working
        without parallel code paths.

        ABY-62: pass `fieldKey` so the shared error-summary scroll-to
        helper can locate the wrapper via `[data-field=...]` / `#field-…`.
      */}
      <div>
        <FormField
          label="Where are you travelling to?"
          tooltip={DESTINATIONS_TOOLTIP}
          error={err('trip.destinations')}
          fieldKey="trip.destinations"
        >
          <Controller
            name="trip.destinations"
            control={control}
            render={({ field }) => {
              const current = Array.isArray(field.value) ? (field.value as string[]) : [];
              if (isAnnual) {
                const single = current[0] ?? '';
                return (
                  <SearchableSelect
                    value={single}
                    onChange={(next) => field.onChange(next ? [next] : [])}
                    onBlur={field.onBlur}
                    options={DESTINATION_OPTIONS}
                    error={!!err('trip.destinations')}
                    placeholder="Select territory…"
                    searchPlaceholder="Type Europe or Worldwide…"
                    showValidTick
                    isValid={Boolean(single)}
                  />
                );
              }
              return (
                <MultiSearchableSelect
                  values={current}
                  onChange={(next) => field.onChange(next)}
                  onBlur={field.onBlur}
                  options={COUNTRY_OPTIONS}
                  error={!!err('trip.destinations')}
                  placeholder="Add the countries you will visit…"
                  searchPlaceholder="Search countries…"
                />
              );
            }}
          />
        </FormField>

        {/* Lloyd's-approved destination policy text */}
        <div className="mt-3 space-y-2 text-sm text-slate-500 leading-relaxed">
          <p>Please select the territory that covers every country you will visit during your trip.</p>
          <p>
            We regret that we are unable to offer cover if you are travelling to Cuba, Iran or
            North Korea or any country or area to which the government of Your Country of
            Residence has advised against all or all but, essential travel.
          </p>
          <p>
            There is no cover under Section 2 - Medical Expenses and Repatriation, whilst you
            are travelling within your Country of Residence. Cover under all other sections
            applies if your trip is away from your home and involves at least two night&apos;s
            stay in pre-booked accommodation, or travel arrangements that have been pre-booked
            with a commercial carrier.
          </p>
        </div>
      </div>

      {/* Dates — hybrid text + picker */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label={isAnnual ? 'Policy start date' : 'Trip start date'} error={err('trip.startDate')} fieldKey="trip.startDate">
          <Controller
            name="trip.startDate"
            control={control}
            render={({ field }) => (
              <Input
                type="date"
                variant="ui"
                error={!!err('trip.startDate')}
                value={String(field.value ?? '')}
                onValueChange={(next) => field.onChange(next)}
                onBlur={field.onBlur}
                min={minTripStartDate}
                aria-label={isAnnual ? 'Policy start date' : 'Trip start date'}
              />
            )}
          />
        </FormField>

        {/*
          ABY-63: for single-trip cover the end date is genuinely the trip's
          last day and MUST be customer-editable — the previous label said
          just "End date" with a tooltip about cancellation cover, which
          made it look like an auto-generated "policy end date" the
          customer couldn't influence. Renamed to "Trip end date" so the
          intent is unambiguous. For annual multi-trip the end date is
          the 12-month policy expiry (auto-derived) so we keep the
          "Policy end date" label and the disabled treatment.
        */}
        <FormField
          label={isAnnual ? 'Policy end date' : 'Trip end date'}
          tooltip={isAnnual ? undefined : END_DATE_TOOLTIP}
          error={err('trip.endDate')}
          fieldKey="trip.endDate"
        >
          <Controller
            name="trip.endDate"
            control={control}
            render={({ field }) => (
              <>
                <Input
                  type="date"
                  variant="ui"
                  disabled={isAnnual}
                  error={!!err('trip.endDate')}
                  value={String(field.value ?? '')}
                  onValueChange={(next) => field.onChange(next)}
                  onBlur={field.onBlur}
                />
                {isAnnual ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Annual multi-trip cover runs for 12 months from the start date.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    Pick the day you return home — cover ends at midnight on this date.
                  </p>
                )}
              </>
            )}
          />
        </FormField>
      </div>

      {/*
        ADR-0054 — prior travel-claims history. The premium load (15% for a
        claim up to €500) and the referral (claim over €500) are decided
        server-side by the rater and `travelUwAutomation`; the wizard only
        collects the answers and validates them via the @facio/products
        travel profile. No load/referral logic is re-derived here.
      */}
      <FormField
        label="Have you previously claimed on a travel insurance policy?"
        error={err('risk.hasPreviousTravelClaim')}
        fieldKey="risk.hasPreviousTravelClaim"
      >
        <Controller
          name="risk.hasPreviousTravelClaim"
          control={control}
          render={({ field }) => (
            <RadioGroup
              name="risk.hasPreviousTravelClaim"
              value={field.value === true ? 'yes' : field.value === false ? 'no' : ''}
              onChange={(v) => field.onChange(v === 'yes')}
              options={YES_NO_OPTIONS}
              error={!!err('risk.hasPreviousTravelClaim')}
            />
          )}
        />
      </FormField>

      {hasPreviousTravelClaim === true && (
        <FormField
          label="How much did you claim in total?"
          error={err('risk.previousTravelClaimBand')}
          fieldKey="risk.previousTravelClaimBand"
        >
          <Controller
            name="risk.previousTravelClaimBand"
            control={control}
            render={({ field }) => (
              <RadioGroup
                name="risk.previousTravelClaimBand"
                value={String(field.value ?? '')}
                onChange={field.onChange}
                options={TRAVEL_PREVIOUS_CLAIM_BAND_OPTIONS}
                error={!!err('risk.previousTravelClaimBand')}
              />
            )}
          />
        </FormField>
      )}
      </SectionCard>
    </div>
  );
}
