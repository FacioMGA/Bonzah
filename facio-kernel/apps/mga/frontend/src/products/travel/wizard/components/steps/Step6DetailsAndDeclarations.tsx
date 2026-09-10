import { useFormContext, Controller } from 'react-hook-form';
import { useEffect, useMemo } from 'react';
import { FileText, Bell, ClipboardCheck, Heart } from 'lucide-react';
import { TRAVEL_ID_TYPE_OPTIONS, travelDestinationAreaLabel } from '@facio/products';
import { TravelQuoteSidebar } from '../TravelQuoteSidebar';
import { Checkbox, Input, RadioGroup, SectionCard, Select } from '@/src/shared/ui';
import { PolicyHolderStep } from '@/src/shared/lib/wizard/steps/PolicyHolderStep';
import { REGION_CONFIG } from '@/src/shared/config/region';
import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';
import { formatTravelDateForDisplay } from '../../formatTravelDateForDisplay';
import { readTravelBreakdownLines } from '../../travelAddons';
import { getTravelTermsOfBusinessDocument } from '../../travelTermsOfBusiness';

const US_LIKE = new Set(['USA', 'United States', 'Canada', 'Mexico', 'Caribbean']);
const EUROPE = new Set([
  'Cyprus', 'Greece', 'Spain', 'Portugal', 'Italy', 'France', 'Germany', 'Belgium',
  'Netherlands', 'Austria', 'Switzerland', 'UK', 'United Kingdom', 'Ireland', 'Sweden',
  'Norway', 'Denmark', 'Finland', 'Malta', 'Poland', 'Czechia',
]);

function destinationAreaLabel(destinations: string[]): string {
  if (!destinations.length) return '—';
  const explicitArea = destinations.map(travelDestinationAreaLabel).find((label): label is string => Boolean(label));
  if (explicitArea) return explicitArea;
  if (destinations.some((d) => US_LIKE.has(d))) return 'Worldwide including the USA and Canada';
  if (destinations.every((d) => EUROPE.has(d))) return 'Europe';
  return 'Worldwide excluding the USA and Canada';
}

function planTypeLabel(planType: string): string {
  return planType === 'annual_multi_trip' ? 'Annual Multi-Trip' : 'Single Trip';
}

function coverTypeDisplayLabel(ct: string): string {
  if (ct === 'couple') return 'a Couple';
  if (ct === 'family') return 'a Family';
  if (ct === 'single_parent_family') return 'a Single Parent Family';
  return 'a Single Person';
}

function coveringLabel(ct: string): string {
  if (ct === 'couple') return 'A Couple';
  if (ct === 'family') return 'A Family';
  if (ct === 'single_parent_family') return 'Single Parent Family';
  return 'Individual';
}

function travellerCountForDetails(travellers: Record<string, unknown>): number {
  const coverType = String(travellers.coverType || 'single');
  const raw = Number(travellers.travellerCount);
  if (coverType === 'couple') return 2;
  if (coverType === 'family' || coverType === 'single_parent_family') {
    return Number.isFinite(raw) && raw >= 3 ? Math.floor(raw) : 3;
  }
  return 1;
}

// ABY-239 — this step used to carry its own `new Date(iso) +
// toLocaleDateString('en-GB')` formatter which dropped a calendar
// day for any user west of UTC (`1975-04-20` → `19/04/1975`).
// Step4 and Step5 had already been hardened against this; Step6
// silently lagged. Now all three import the same canonical owner
// at `../../formatTravelDateForDisplay`. Local alias is just for
// minimum-diff to the surrounding read sites.
const formatIsoDate = formatTravelDateForDisplay;

// ABY-241 — `ADDON_LABELS` removed. It used to duplicate the
// catalogue exported by Step5 (now `../../travelAddons.ts`).
// The canonical helper `buildSelectedTravelAddonSummary` already
// returns the display labels in catalogue order, so this lookup
// became dead code.

export interface Step6DetailsAndDeclarationsProps {
  quoteResponse: Record<string, unknown> | null;
  onSave?: () => Promise<void>;
}

export function Step6DetailsAndDeclarations({ quoteResponse, onSave }: Step6DetailsAndDeclarationsProps) {
  const terms = getTravelTermsOfBusinessDocument();
  const { register, control, watch, setValue, formState: { errors } } = useFormContext();

  const err = (path: string) => getNestedError(errors as Record<string, unknown>, path);

  const trip = (watch('trip') || {}) as Record<string, unknown>;
  const travellers = (watch('travellers') || {}) as Record<string, unknown>;
  const quote = (watch('quote') || {}) as Record<string, unknown>;

  const selectedPlan = String(quote.selectedPlan || 'silver');
  const tripType = String(trip.planType || 'single_trip');
  const destinations = Array.isArray(trip.destinations) ? (trip.destinations as string[]) : [];
  const ctValue = String(travellers.coverType || 'single');
  const leadDOB = formatIsoDate(String(travellers.leadTravellerDOB || ''));
  const travellerCount = travellerCountForDetails(travellers);
  const additionalTravellerCount = Math.max(0, travellerCount - 1);
  const additionalDobs = useMemo(
    () => Array.isArray(travellers.additionalTravellerDOBs)
      ? travellers.additionalTravellerDOBs.map(String)
      : [],
    [travellers.additionalTravellerDOBs],
  );
  const startDate = formatIsoDate(String(trip.startDate || ''));
  const endDate = formatIsoDate(String(trip.endDate || ''));

  const areaLabel = destinationAreaLabel(destinations);
  const planLabel = `${selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)} ${planTypeLabel(tripType)}`;

  // ABY-264 — order-summary sidebar consumes the canonical
  // `breakdown.lines` (base → addons → tax → admin fee → total)
  // emitted by the rate engine. Step5 and Step6 both read the same
  // shape so admin fee + addon detail are always shown identically
  // across the wizard, and the customer never sees a different
  // breakdown shape on the payment step than on earlier steps.
  const breakdownLines = readTravelBreakdownLines(quoteResponse);

  useEffect(() => {
    if (additionalTravellerCount <= 0) return;
    const current = Array.isArray(travellers.additionalTravellers)
      ? travellers.additionalTravellers as Array<Record<string, unknown>>
      : [];
    if (current.length === additionalTravellerCount) return;
    setValue(
      'travellers.additionalTravellers',
      Array.from({ length: additionalTravellerCount }, (_, index) => ({
        ...(current[index] || {}),
        dateOfBirth: additionalDobs[index] || '',
      })),
      { shouldDirty: true, shouldTouch: true, shouldValidate: false },
    );
  }, [additionalDobs, additionalTravellerCount, setValue, travellers.additionalTravellers]);

  return (
    <div className="lg:grid lg:grid-cols-[1fr_240px] lg:gap-6 lg:items-start">
      <div className="space-y-4">

        <SectionCard title="Your Demands and Needs" icon={<FileText className="w-3.5 h-3.5" />}>
          <p className="text-[13px] text-slate-600 leading-relaxed">
            This product is intended to provide cover for individuals who require insurance
            protection for risks relating to their future travel plans
          </p>
          <p className="text-[13px] text-slate-600 leading-relaxed">
            You have selected a <strong>{planTypeLabel(tripType)} Policy</strong> for{' '}
            <strong>{coverTypeDisplayLabel(ctValue)}</strong>
            {startDate && endDate && (
              <> with a Period of Cover of <strong>{startDate} to {endDate}</strong></>
            )}{' '}
            covering you in <strong>{areaLabel}</strong> with an Excess per person per section
            of cover of <strong>€ 100</strong> (except for Personal Liability where the Excess
            is <strong>€ 250</strong>)
          </p>
          <p className="text-[13px] text-slate-600 leading-relaxed">
            The policy includes cover for the standard benefits of Cancellation and Curtailment,
            Travel Disruption and Alternative Accommodation; Missed Departure and Travel Delay
            Inconvenience Benefit; Alteration of itinerary; Medical Expenses and Repatriation;
            Hospital Inconvenience Benefit; Funeral Expenses; Pet Care; Personal Accident;
            Baggage and Personal Effects; Delayed Baggage; Money, Documents and Fraudulent use of
            lost Credit/Debit cards; Personal Liability and Hijack.
          </p>
          <p className="text-[13px] text-slate-500 leading-relaxed">
            Please return to the{' '}
            <button type="button" className="text-brand-primary underline hover:no-underline font-medium">
              previous page
            </button>{' '}
            if you wish to amend any of this information.
          </p>
        </SectionCard>

        <SectionCard title="Very Important Notice" icon={<ClipboardCheck className="w-3.5 h-3.5" />}>
          <p className="text-[13px] font-semibold text-slate-700">
            Please read the following Medical Conditions statement carefully:
          </p>
          <p className="text-[13px] text-slate-600 leading-relaxed">
            These travel policies do not cover certain pre-existing medical conditions.
            Restrictions in cover may apply if a claim is made relating to a medical condition,
            illness, or injury, of the Insured Person(s), or any person who your travel depends
            on, which you or they knew about before you bought this insurance, or which develops
            before the travel to which this insurance applies begins. Some medical conditions are
            covered automatically and full details are available on the{' '}
            <a href="#" className="text-brand-primary underline hover:no-underline">Pre-Existing Medical Conditions</a>{' '}
            page here.
          </p>
          <p className="text-[13px] text-slate-600 leading-relaxed">
            It is very important that you review the information carefully to make sure you have
            understood what you are or are not covered for. Medical conditions which fall outside
            the criteria for cover which are explained in the policy cannot currently be covered.
            If you have any queries regarding cover, you should contact us or the insurance agent
            who arranged your insurance for help.
          </p>
          <div className="space-y-3 pt-1">
            <Checkbox
              {...register('declarations.medicalNotice')}
              label="Please click to Confirm You Have Read And Understand This Notice"
              error={Boolean(err('declarations.medicalNotice'))}
            />
            {err('declarations.medicalNotice') && (
              <p className="ml-7 text-[12px] font-semibold text-red-500">{err('declarations.medicalNotice')}</p>
            )}
            <Checkbox
              {...register('declarations.howToClaimReview')}
              label={
                <>
                  Before Proceeding To Purchase This Policy Please Also Confirm You Have
                  Reviewed The Information About{' '}
                  <a href="#" className="text-brand-primary underline hover:no-underline">How To Claim</a>,{' '}
                  <a href="#" className="text-brand-primary underline hover:no-underline">How To Complain</a>{' '}
                  And{' '}
                  <a href="#" className="text-brand-primary underline hover:no-underline">Your Privacy</a>
                </>
              }
              error={Boolean(err('declarations.howToClaimReview'))}
            />
            {err('declarations.howToClaimReview') && (
              <p className="ml-7 text-[12px] font-semibold text-red-500">{err('declarations.howToClaimReview')}</p>
            )}
            <Checkbox
              {...register('declarations.personalDataConsent')}
              label="All Persons Who Will Be Named On The Policy Have Given Permission For Us To Hold Their Personal Data"
              error={Boolean(err('declarations.personalDataConsent'))}
            />
            {err('declarations.personalDataConsent') && (
              <p className="ml-7 text-[12px] font-semibold text-red-500">{err('declarations.personalDataConsent')}</p>
            )}
            <Checkbox
              {...register('declarations.contractConsent')}
              label="I Confirm That I Wish To Enter Into A Contract Of Insurance."
              error={Boolean(err('declarations.contractConsent'))}
            />
            {err('declarations.contractConsent') && (
              <p className="ml-7 text-[12px] font-semibold text-red-500">{err('declarations.contractConsent')}</p>
            )}
          </div>
          <p className="text-[12px] text-slate-500 leading-relaxed border-t border-slate-100 pt-3">
            The personal data will be used to fulfil the contract of insurance, and will be
            shared with other stakeholders.{' '}
            {terms && <>Please see our{' '}
              <a href={terms.href} target="_blank" rel="noopener noreferrer" className="text-brand-primary underline hover:no-underline">Terms of Business</a>{' '}
              for more detail.{' '}</>}
            You have the right to request that we delete your personal data from
            our records, but in that case we will be unable to fulfil the contract of insurance
            and any policy we have issued will cease to be valid.
          </p>
        </SectionCard>

        {/*
          ABY-65: the previous "Your Details" SectionCard above
          PolicyHolderStep was an empty visual header that only repeated
          the lead traveller's DOB the customer just typed two steps
          ago, then immediately rendered the actual personal-details
          form below it. That made the page feel like the customer was
          being asked for the same data twice. We now keep DOB as a
          subtle inline reminder INSIDE the canonical PolicyHolderStep
          section (rendered just below it), removing the duplicate
          card and the redundant section title.
        */}
        <PolicyHolderStep
          pathPrefix="proposer"
          idTypeOptions={TRAVEL_ID_TYPE_OPTIONS}
          include={{
            idType: true,
            addressLine2: true,
            confirmEmail: true,
            dateOfBirth: false,
            nationality: false,
            nif: false,
            occupation: false,
            marketingConsent: false,
          }}
          defaultPhoneRegion={REGION_CONFIG.defaultRegionCode}
        />
        {leadDOB && (
          <p className="text-[12px] font-semibold text-slate-500 -mt-2 ml-1">
            Lead traveller&apos;s date of birth: <span className="text-slate-700">{leadDOB}</span>
          </p>
        )}

        {additionalTravellerCount > 0 && (
          <SectionCard title="Additional Traveller Details" icon={<FileText className="w-3.5 h-3.5" />}>
            <p className="text-[13px] text-slate-600 leading-relaxed">
              Please provide details for each additional traveller named on this policy.
            </p>
            <div className="space-y-5">
              {Array.from({ length: additionalTravellerCount }, (_, index) => {
                const base = `travellers.additionalTravellers.${index}`;
                const dob = formatIsoDate(additionalDobs[index] || '');
                return (
                  <div key={base} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="mb-4 text-sm font-black text-slate-900">
                      Traveller {index + 2}{dob ? ` — DOB ${dob}` : ''}
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div data-field={`${base}.firstName`} id={`field-${base}.firstName`}>
                        <label className="mb-2 block text-[12px] font-bold text-slate-700">First Name</label>
                        <Input
                          variant="ui"
                          placeholder="Enter first name"
                          error={Boolean(err(`${base}.firstName`))}
                          {...register(`${base}.firstName`)}
                        />
                        {err(`${base}.firstName`) && <p className="mt-1 text-[12px] font-semibold text-red-500">{err(`${base}.firstName`)}</p>}
                      </div>
                      <div data-field={`${base}.lastName`} id={`field-${base}.lastName`}>
                        <label className="mb-2 block text-[12px] font-bold text-slate-700">Last Name</label>
                        <Input
                          variant="ui"
                          placeholder="Enter last name"
                          error={Boolean(err(`${base}.lastName`))}
                          {...register(`${base}.lastName`)}
                        />
                        {err(`${base}.lastName`) && <p className="mt-1 text-[12px] font-semibold text-red-500">{err(`${base}.lastName`)}</p>}
                      </div>
                      <div data-field={`${base}.idType`} id={`field-${base}.idType`}>
                        <label className="mb-2 block text-[12px] font-bold text-slate-700">ID Proof</label>
                        <Select variant="ui" error={Boolean(err(`${base}.idType`))} {...register(`${base}.idType`)}>
                          <option value="">Please Select</option>
                          {TRAVEL_ID_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </Select>
                        {err(`${base}.idType`) && <p className="mt-1 text-[12px] font-semibold text-red-500">{err(`${base}.idType`)}</p>}
                      </div>
                      <div data-field={`${base}.idNumber`} id={`field-${base}.idNumber`}>
                        <label className="mb-2 block text-[12px] font-bold text-slate-700">ID Number</label>
                        <Input
                          variant="ui"
                          placeholder="Enter ID number"
                          error={Boolean(err(`${base}.idNumber`))}
                          {...register(`${base}.idNumber`)}
                        />
                        {err(`${base}.idNumber`) && <p className="mt-1 text-[12px] font-semibold text-red-500">{err(`${base}.idNumber`)}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}

        <SectionCard title="Your Contact Preferences" icon={<Bell className="w-3.5 h-3.5" />}>
          <div className="space-y-2" data-field="proposer.marketingConsent" id="field-proposer.marketingConsent">
            <p className="text-[13px] text-slate-700 leading-relaxed">
              We would like to keep in touch with you, from time to time, to bring you news or
              details of other products that might be of interest to you. Please select Yes if
              you would like to opt in to receive information from the operating organization
            </p>
            <Controller
              name="proposer.marketingConsent"
              control={control}
              render={({ field }) => (
                <RadioGroup
                  name="proposer.marketingConsent"
                  value={String(field.value || '')}
                  onChange={(v) => field.onChange(v)}
                  error={Boolean(err('proposer.marketingConsent'))}
                  options={[
                    { value: 'true', label: 'Yes' },
                    { value: 'false', label: 'No' },
                  ]}
                />
              )}
            />
            {err('proposer.marketingConsent') && (
              <p className="text-[12px] font-semibold text-red-500">{err('proposer.marketingConsent')}</p>
            )}
          </div>
          <div className="space-y-2" data-field="proposer.feedbackConsent" id="field-proposer.feedbackConsent">
            <p className="text-[13px] text-slate-700 leading-relaxed">
              We would like to ask about your experience today through our nominated Feedback
              partner. This will allow us to improve how we deal with you in the future. This
              information will ONLY be used for Feedback and will not be used elsewhere. Please
              select Yes if you are happy to assist us with this
            </p>
            <Controller
              name="proposer.feedbackConsent"
              control={control}
              render={({ field }) => (
                <RadioGroup
                  name="proposer.feedbackConsent"
                  value={String(field.value || '')}
                  onChange={(v) => field.onChange(v)}
                  options={[
                    { value: 'true', label: 'Yes' },
                    { value: 'false', label: 'No' },
                  ]}
                />
              )}
            />
          </div>
        </SectionCard>

        <SectionCard title="Declaration" icon={<ClipboardCheck className="w-3.5 h-3.5" />}>
          <p className="text-[13px] text-slate-600 leading-relaxed">
            You are about to proceed to the payment page which is hosted and secured by Stripe
            using secure encryption technology. I understand that my personal financial data may
            be stored in the UK. We do not collect any of your financial details ourselves.
          </p>
          <p className="text-[13px] text-slate-600 leading-relaxed">
            Once you have purchased the insurance you have 14 days to tell us if you do not want
            it and, provided certain conditions are met, obtain a full premium refund. Our full
            cancellation policy is{' '}
            <a href="#" className="text-brand-primary underline hover:no-underline">Here</a>.
          </p>
          <Checkbox
            {...register('declarations.contractAgreement')}
            label="I Confirm That I Have Read And Understood The Above Information And I Wish To Proceed To The Payment Portal To Purchase This Policy."
            error={Boolean(err('declarations.contractAgreement'))}
          />
          {err('declarations.contractAgreement') && (
            <p className="ml-7 text-[12px] font-semibold text-red-500">{err('declarations.contractAgreement')}</p>
          )}
        </SectionCard>

        <SectionCard title="Important information about cover for Pre-existing Medical Conditions" icon={<Heart className="w-3.5 h-3.5" />}>
          <p className="text-[13px] font-semibold text-slate-700">
            Please read the following Medical Conditions statement carefully before deciding to
            purchase this insurance.
          </p>
          <p className="text-[13px] text-slate-600 leading-relaxed">
            These travel policies do not cover certain pre-existing medical conditions.
            Restrictions in cover may apply if a claim is made relating to a medical condition,
            illness, or injury, of the Insured Person(s), or any person who your travel depends
            on, which you or they knew about before you bought this insurance, or which develops
            before the travel to which this insurance applies begins. Some medical conditions are
            covered automatically and full details are available on the Pre-Existing Medical
            Conditions page{' '}
            <a href="#" className="text-brand-primary underline hover:no-underline">here</a>
          </p>
          <p className="text-[13px] text-slate-600 leading-relaxed">
            It is very important that you review the information carefully to make sure you have
            understood what you are or are not covered for. Medical conditions which fall outside
            the criteria for cover which are explained in the policy cannot currently be covered.
            If you have any queries regarding cover, you should contact us or the insurance agent
            who arranged your insurance for help.
          </p>
          <p className="text-[13px] text-slate-600 leading-relaxed">
            You may wish to take some time to consider the cover, or you may not be ready to
            purchase the insurance. You can return to the Quick Quotation at any time during the
            next 30 days. When you are ready to purchase the insurance, the premium will be
            checked in case there have been any changes in your personal information, since the
            Quick Quotation was created, which might mean the premium could change.
          </p>
          {onSave && (
            <div className="pt-1 space-y-2">
              <button
                type="button"
                onClick={() => { void onSave(); }}
                className="rounded-lg bg-brand-primary px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-brand-primary/90 transition-colors"
              >
                Save Quote
              </button>
              <p className="text-[12px] text-slate-500">
                You can return to the quotation at any time during the next 30 days.
              </p>
              <p className="text-[13px] font-bold text-slate-800">
                If you wish to purchase the insurance please CONTINUE
              </p>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="hidden lg:block lg:sticky lg:top-6">
        <TravelQuoteSidebar
          planType={String(trip.planType || '')}
          areaLabel={areaLabel}
          coverLevelLabel={planLabel}
          coveringLabel={coveringLabel(ctValue)}
          startDate={startDate}
          endDate={endDate}
          breakdownLines={breakdownLines}
          showDocs
          showContact
        />
      </div>

      <div className="lg:hidden mt-4">
        <TravelQuoteSidebar
          planType={String(trip.planType || '')}
          areaLabel={areaLabel}
          coverLevelLabel={planLabel}
          coveringLabel={coveringLabel(ctValue)}
          startDate={startDate}
          endDate={endDate}
          breakdownLines={breakdownLines}
          showDocs
          showContact
        />
      </div>
    </div>
  );
}
