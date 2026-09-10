import { useEffect } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { CalendarDays, HeartPulse } from 'lucide-react';
import { FormField, Input, RadioGroup, SectionCard } from '@/src/shared/ui';
import { makeFieldErrorReader } from '../../utils/errors';

const YES_NO_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

function addOneYear(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const year = Number(m[1]) + 1;
  const month = m[2];
  const day = m[3];
  // Subtract one day so the period is exactly one year inclusive (matches sample schedule).
  const expiry = new Date(Date.UTC(year, Number(month) - 1, Number(day)));
  expiry.setUTCDate(expiry.getUTCDate() - 1);
  return expiry.toISOString().slice(0, 10);
}

/**
 * Step 3 — Period of insurance + GHS toggle.
 *
 * Policy term is always one year (matches the BRIT BAA Immigration
 * Medical policy). Expiry is derived from inception (+1 year - 1 day).
 *
 * GHS beneficiary toggle drives the MBE `HEALTH-GHS-EXTENSION`
 * selectedWhen rule — when `true`, the wizard's cover summary and the
 * schedule PDF render the Extended Cover block at no premium impact.
 */
export function Step3PeriodAndGhs() {
  const { control, watch, setValue, formState: { errors } } = useFormContext();
  const err = makeFieldErrorReader(errors);
  const inception = String((watch('period.inceptionDate') as string) || '');
  const expiry = String((watch('period.expiryDate') as string) || '');

  useEffect(() => {
    if (!inception) return;
    const derived = addOneYear(inception);
    if (derived && derived !== expiry) {
      setValue('period.expiryDate', derived, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
    }
  }, [inception, expiry, setValue]);

  return (
    <SectionCard title="Period & GESY" icon={<CalendarDays className="w-5 h-5" />}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Policy inception date" error={err('period.inceptionDate')}>
          <Controller
            name="period.inceptionDate"
            control={control}
            render={({ field }) => (
              <Input
                type="date"
                variant="ui"
                error={!!err('period.inceptionDate')}
                value={String(field.value ?? '')}
                onValueChange={(next) => field.onChange(next)}
                onBlur={field.onBlur}
              />
            )}
          />
        </FormField>
        <FormField label="Policy expiry date (auto: +1 year)" error={err('period.expiryDate')}>
          <Input type="date" variant="ui" value={expiry} readOnly disabled />
        </FormField>
      </div>

      <div className="mt-4 p-4 rounded-lg bg-emerald-50/40 border border-emerald-200">
        <div className="flex items-start gap-3">
          <HeartPulse className="w-5 h-5 text-emerald-600 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-900">General Healthcare System (GESY) of Cyprus</div>
            <div className="text-xs text-slate-600 mt-1 mb-3">
              GESY beneficiaries unlock the no-premium Outpatient + Repatriation extension on this policy.
            </div>
            <FormField
              label="Is the proposer / lead insured a beneficiary of GESY in Cyprus?"
              error={err('ghs.isBeneficiary')}
            >
              <Controller
                name="ghs.isBeneficiary"
                control={control}
                render={({ field }) => (
                  <RadioGroup
                    name="ghs.isBeneficiary"
                    value={field.value === true ? 'yes' : field.value === false ? 'no' : ''}
                    onChange={(v) => field.onChange(v === 'yes')}
                    options={YES_NO_OPTIONS}
                    error={!!err('ghs.isBeneficiary')}
                  />
                )}
              />
            </FormField>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
