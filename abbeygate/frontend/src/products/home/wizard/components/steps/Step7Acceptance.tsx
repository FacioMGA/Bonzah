import { useFormContext } from 'react-hook-form';
import { CheckCircle2 } from 'lucide-react';
import { Checkbox, FormField, SectionCard, WizardInput as Input, WizardTextarea as Textarea } from '@/src/shared/ui';
import { getOperatingCountryFromHost } from '@/src/shared/lib/tenant/operatingCountry';
import { taxIdentifierFieldCopy } from '@/src/shared/lib/wizard/utils/taxIdentifierLabel';

function todayIsoLocal(): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Home wizard step 7 — Acceptance.
 *
 * Restores the fields that the backend issue-readiness contract already
 * requires: the customer's truth/accuracy confirmation and the policy
 * start date. Without this step, payment is guaranteed to 422.
 */
export function Step7Acceptance() {
  const { register, setValue, watch } = useFormContext();
  const startDate = register('policy.startDate');
  const hasMortgage = Boolean(watch('mortgage.hasMortgage'));
  const minPolicyStartDate = todayIsoLocal();
  const taxIdCopy = taxIdentifierFieldCopy(getOperatingCountryFromHost());
  const nifValue = String(watch('proposer.nif') ?? '');

  return (
    <SectionCard title="Acceptance" icon={<CheckCircle2 className="w-5 h-5" />}>
      <p className="text-sm font-semibold text-slate-500 -mt-4 mb-2">Confirm the information and choose when you want the policy to start.</p>

      <FormField label="Policy start date" fieldKey="policy.startDate">
        <Input
          type="date"
          name={startDate.name}
          aria-label="Policy start date"
          min={minPolicyStartDate}
          ref={startDate.ref}
          onBlur={startDate.onBlur}
          value={String(watch('policy.startDate') ?? '')}
          onValueChange={(next) => setValue('policy.startDate', next, { shouldDirty: true, shouldValidate: true })}
        />
      </FormField>

      <FormField label={taxIdCopy.label} fieldKey="proposer.nif">
        <Input
          {...register('proposer.nif')}
          placeholder={taxIdCopy.placeholder}
          showValid={Boolean(nifValue.trim())}
        />
        <p className="mt-2 text-xs text-slate-500">
          Optional for now — you can continue without it. Our team may contact you to collect your passport or ID number later if needed.
        </p>
      </FormField>

      <Checkbox
        {...register('eligibility.confirmation')}
        label="I confirm the information provided is true and accurate, and I understand that inaccurate information may invalidate my policy."
      />

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        <Checkbox
          {...register('mortgage.hasMortgage')}
          label="There is a bank, lender, or mortgage interest in this property."
        />
        {hasMortgage ? (
          <div className="mt-4 space-y-4">
            <FormField label="Mortgage lender / bank name" required fieldKey="mortgage.lenderName">
              <Input
                {...register('mortgage.lenderName')}
                placeholder="Enter bank or lender name"
                showValid={Boolean(String(watch('mortgage.lenderName') || '').trim())}
              />
            </FormField>
            <FormField label="Mortgage lender / bank address" required fieldKey="mortgage.lenderAddress">
              <Textarea
                {...register('mortgage.lenderAddress')}
                placeholder="Enter the bank or lender address"
                rows={3}
                showValid={String(watch('mortgage.lenderAddress') || '').trim().length > 5}
              />
            </FormField>
            <FormField label="Bank / mortgage reference" fieldKey="mortgage.lenderReference">
              <Input
                {...register('mortgage.lenderReference')}
                placeholder="Enter reference if known"
                showValid={Boolean(String(watch('mortgage.lenderReference') || '').trim())}
              />
            </FormField>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
