import { Controller, useFormContext } from 'react-hook-form';
import { ShieldCheck } from 'lucide-react';
import { FormField, MoneyInput, SectionCard, WizardInput as Input, WizardSelect as Select } from '@/src/shared/ui';
import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';
import { BUSINESS_YES_NO_OPTIONS } from '@facio/products';

export function Step3Coverages() {
  const { control, register, watch, formState: { errors } } = useFormContext();
  const err = (path: string): string | undefined =>
    getNestedError(errors as Record<string, unknown>, path);

  const publicLiability = watch('coverage.publicLiability');
  const employersLiability = watch('coverage.employersLiability');
  const businessInterruption = watch('coverage.businessInterruption');
  const renderMoneyField = (path: string, label: string) => (
    <FormField label={label} error={err(path)} fieldKey={path}>
      <Controller
        name={path}
        control={control}
        render={({ field }) => (
          <MoneyInput
            value={String(field.value ?? '')}
            onValueChange={(next) => {
              const numeric = next === '' ? undefined : Number(next);
              field.onChange(Number.isFinite(numeric) ? numeric : (next || undefined));
            }}
            onBlur={field.onBlur}
            error={!!err(path)}
            currencySymbol="€"
            allowNegative={false}
            maxDecimals={0}
            align="left"
          />
        )}
      />
    </FormField>
  );

  return (
    <SectionCard title="The cover you need" icon={<ShieldCheck className="w-5 h-5" />}>
      <p className="text-sm font-semibold text-slate-500 -mt-4 mb-2">
        Tell us what to protect. Enter a sum insured for material damage and choose the liability covers you need.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {renderMoneyField('coverage.buildings', 'Buildings (EUR)')}
        {renderMoneyField('coverage.stock', 'Stock (EUR)')}
        {renderMoneyField('coverage.equipment', 'Contents & equipment (EUR)')}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Public liability cover" required error={err('coverage.publicLiability')} fieldKey="coverage.publicLiability">
          <Select
            {...register('coverage.publicLiability')}
            options={BUSINESS_YES_NO_OPTIONS}
            placeholder="Please select"
            error={!!err('coverage.publicLiability')}
          />
        </FormField>
        {String(publicLiability) === 'yes' && (
          renderMoneyField('coverage.publicLiabilityLimit', 'Public liability limit (EUR)')
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Employers' liability cover" required error={err('coverage.employersLiability')} fieldKey="coverage.employersLiability">
          <Select
            {...register('coverage.employersLiability')}
            options={BUSINESS_YES_NO_OPTIONS}
            placeholder="Please select"
            error={!!err('coverage.employersLiability')}
          />
        </FormField>
        {String(employersLiability) === 'yes' && (
          renderMoneyField('coverage.employersLiabilityLimit', "Employers' liability limit (EUR)")
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Business interruption cover" required error={err('coverage.businessInterruption')} fieldKey="coverage.businessInterruption">
          <Select
            {...register('coverage.businessInterruption')}
            options={BUSINESS_YES_NO_OPTIONS}
            placeholder="Please select"
            error={!!err('coverage.businessInterruption')}
          />
        </FormField>
        {String(businessInterruption) === 'yes' && (
          <>
            {renderMoneyField('coverage.businessInterruptionLimit', 'Business interruption limit (EUR)')}
            <FormField label="Indemnity period (months)" error={err('coverage.businessInterruptionIndemnityMonths')} fieldKey="coverage.businessInterruptionIndemnityMonths">
              <Input type="number" min={0} max={36} {...register('coverage.businessInterruptionIndemnityMonths')} error={!!err('coverage.businessInterruptionIndemnityMonths')} />
            </FormField>
          </>
        )}
      </div>

      <FormField label="Legal assistance cover" required error={err('coverage.legalAssistance')} fieldKey="coverage.legalAssistance">
        <Select
          {...register('coverage.legalAssistance')}
          options={BUSINESS_YES_NO_OPTIONS}
          placeholder="Please select"
          error={!!err('coverage.legalAssistance')}
        />
      </FormField>
    </SectionCard>
  );
}
