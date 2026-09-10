import { Controller, useFormContext, useWatch } from 'react-hook-form';
import {
  BooleanRadio,
  FormField,
  WizardSelect as Select,
  WizardSearchableSelect as SearchableSelect,
  SectionCard,
} from '@/src/shared/ui';
import { Globe } from 'lucide-react';
import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';
import {
  TRAVEL_NATIONALITY_OPTIONS,
  TRAVEL_RESIDENCE_COUNTRY_OPTIONS,
  TRAVEL_RESIDENCE_DURATION_OPTIONS,
  TRAVEL_RESIDENCY_STATUS_OPTIONS,
} from '@facio/products';

/**
 * Step 1 — Objective expat eligibility (ADR-0025).
 *
 * The wizard collects the seven objective answers Peter / Jack defined
 * in the BRIT BAA expansion (2026-04-20 → 2026-05-16). The customer is
 * NOT asked whether they are an expat; that flag is derived server-side
 * by `travelUwAutomation.deriveIsExpat` from these answers.
 *
 * Boolean answers use the canonical `BooleanRadio` primitive (ABY-285 /
 * Health parity) so discretionary fields never render a pre-selected No.
 * The Lloyd's declaration block and both must-accept checkboxes follow
 * the legacy abbeygatetravel.com journey: policy text first, then the
 * accuracy + legal confirmations (ABY-519).
 */
export function Step1Eligibility() {
  const { register, control, formState: { errors } } = useFormContext();
  const err = (path: string) => getNestedError(errors as Record<string, unknown>, path);
  const hasOtherNationality = useWatch({ control, name: 'eligibility.hasOtherNationality' });

  return (
    <SectionCard title="Eligibility" icon={<Globe className="w-5 h-5" />}>
      <FormField
        label="What is your current country of residence?"
        error={err('eligibility.countryOfResidence')}
      >
        <Controller
          name="eligibility.countryOfResidence"
          control={control}
          render={({ field }) => (
            <SearchableSelect
              value={String(field.value || '')}
              onChange={field.onChange}
              options={TRAVEL_RESIDENCE_COUNTRY_OPTIONS}
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
              options={TRAVEL_NATIONALITY_OPTIONS}
              placeholder="Select nationality"
              searchPlaceholder="Search nationality..."
              error={!!err('eligibility.nationality')}
            />
          )}
        />
      </FormField>

      <FormField
        label="Do you hold any other nationality?"
        error={err('eligibility.hasOtherNationality')}
      >
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
        <FormField
          label="Please select your other nationality"
          error={err('eligibility.otherNationality')}
        >
          <Controller
            name="eligibility.otherNationality"
            control={control}
            render={({ field }) => (
              <SearchableSelect
                value={String(field.value || '')}
                onChange={field.onChange}
                options={TRAVEL_NATIONALITY_OPTIONS}
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
          options={TRAVEL_RESIDENCE_DURATION_OPTIONS}
          placeholder="Please select"
          error={!!err('eligibility.residenceDuration')}
        />
      </FormField>

      <FormField
        label="For the duration of your policy, please confirm that you will remain a resident of your current country of residence"
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
          options={TRAVEL_RESIDENCY_STATUS_OPTIONS}
          placeholder="Please select"
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

      {/* Lloyd's-approved declaration block — informational text must appear verbatim. */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-3 text-sm text-slate-600 leading-relaxed">
        <p>
          Your policy is insured by Lloyd's Insurance Company S.A., an insurance company registered in Belgium
          and subject to the supervision of the National Bank of Belgium. It is issued by Abbeygate Insurance
          Brokers Limited as Coverholder and agent for the insurer.
        </p>
        <p>The policy is governed exclusively by the law and jurisdiction of your country of residence.</p>
        <p className="font-bold text-slate-800">
          I confirm that all persons to be insured are resident in the above country for 6 months or more in
          any consecutive 12 month period.
        </p>
        <p className="font-bold text-slate-800">
          I understand that all information and policy documentation will be in the English language.
          I confirm that I understand the terms and conditions of the contract in English and agree to be
          bound by them.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              {...register('eligibility.informationAccurate')}
              className="mt-0.5 h-4 w-4 rounded accent-brand-primary"
            />
            <span className="text-sm font-semibold text-slate-800">
              I confirm that the information provided is accurate and that any incorrect declaration may
              affect cover or claims validation.
            </span>
          </label>
          {err('eligibility.informationAccurate') && (
            <p className="mt-1.5 ml-7 text-xs font-semibold text-red-600">
              {err('eligibility.informationAccurate')}
            </p>
          )}
        </div>

        <div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              {...register('eligibility.legalAgreement')}
              className="mt-0.5 h-4 w-4 rounded accent-brand-primary"
            />
            <span className="text-sm font-semibold text-slate-800">
              I Confirm That I Have Read, Understood And Agree To This Statement
            </span>
          </label>
          {err('eligibility.legalAgreement') && (
            <p className="mt-1.5 ml-7 text-xs font-semibold text-red-600">
              {err('eligibility.legalAgreement')}
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
