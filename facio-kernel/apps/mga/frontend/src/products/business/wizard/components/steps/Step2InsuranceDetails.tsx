import { useFormContext } from 'react-hook-form';
import { Building2 } from 'lucide-react';
import { FormField, SectionCard, WizardInput as Input, WizardSelect as Select } from '@/src/shared/ui';
import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';
import {
  BUSINESS_COVER_TIMING_OPTIONS,
  BUSINESS_PREMISES_STATUS_OPTIONS,
  BUSINESS_YES_NO_OPTIONS,
} from '@facio/products';
import { Step3Coverages } from './Step3Coverages';
import { Step4RiskSecurity } from './Step4RiskSecurity';

export function Step2InsuranceDetails() {
  const { register, formState: { errors } } = useFormContext();
  const err = (path: string): string | undefined =>
    getNestedError(errors as Record<string, unknown>, path);

  return (
    <>
      <SectionCard title="About your business" icon={<Building2 className="w-5 h-5" />}>
        <p className="text-sm font-semibold text-slate-500 -mt-4 mb-2">
          Help us understand the business you'd like to insure.
        </p>

        <FormField label="Type of business / trade" required error={err('business.typeOfBusiness')} fieldKey="business.typeOfBusiness">
          <Input
            {...register('business.typeOfBusiness')}
            error={!!err('business.typeOfBusiness')}
            placeholder="e.g. Restaurant, retail shop, office, workshop"
          />
        </FormField>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Number of employees" required error={err('business.numberOfEmployees')} fieldKey="business.numberOfEmployees">
            <Input type="number" min={0} {...register('business.numberOfEmployees')} error={!!err('business.numberOfEmployees')} />
          </FormField>
          <FormField label="When do you require cover?" required error={err('business.coverTiming')} fieldKey="business.coverTiming">
            <Select
              {...register('business.coverTiming')}
              options={BUSINESS_COVER_TIMING_OPTIONS}
              placeholder="Please select"
              error={!!err('business.coverTiming')}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Year premises constructed" error={err('business.yearPremisesConstructed')} fieldKey="business.yearPremisesConstructed">
            <Input type="number" min={1800} max={2100} {...register('business.yearPremisesConstructed')} error={!!err('business.yearPremisesConstructed')} />
          </FormField>
          <FormField label="Size of premises (sqm)" error={err('business.sizeOfPremisesSqm')} fieldKey="business.sizeOfPremisesSqm">
            <Input type="number" min={0} {...register('business.sizeOfPremisesSqm')} error={!!err('business.sizeOfPremisesSqm')} />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Is the business registered for tax?" error={err('business.registeredForTax')} fieldKey="business.registeredForTax">
            <Select
              {...register('business.registeredForTax')}
              options={BUSINESS_YES_NO_OPTIONS}
              placeholder="Please select"
              error={!!err('business.registeredForTax')}
            />
          </FormField>
          <FormField label="Premises status" error={err('business.premisesStatus')} fieldKey="business.premisesStatus">
            <Select
              {...register('business.premisesStatus')}
              options={BUSINESS_PREMISES_STATUS_OPTIONS}
              placeholder="Please select"
              error={!!err('business.premisesStatus')}
            />
          </FormField>
        </div>
      </SectionCard>
      <Step3Coverages />
      <Step4RiskSecurity />
    </>
  );
}
