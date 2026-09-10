import { useFormContext } from 'react-hook-form';
import { Lock } from 'lucide-react';
import { FormField, SectionCard, WizardInput as Input, WizardSelect as Select } from '@/src/shared/ui';
import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';
import {
  BUSINESS_FIRE_RESPONSE_OPTIONS,
  BUSINESS_THEFT_PREVENTION_OPTIONS,
  BUSINESS_YES_NO_OPTIONS,
} from '@facio/products';

export function Step4RiskSecurity() {
  const { register, watch, formState: { errors } } = useFormContext();
  const err = (path: string): string | undefined =>
    getNestedError(errors as Record<string, unknown>, path);
  const isOther = (path: string) => String(watch(path)) === 'other';

  return (
    <SectionCard title="Risk & security" icon={<Lock className="w-5 h-5" />}>
      <p className="text-sm font-semibold text-slate-500 -mt-4 mb-2">
        Tell us about the protection in place at the premises.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Rejas (grilles) on windows and doors" required error={err('security.rejasOnWindowsAndDoors')} fieldKey="security.rejasOnWindowsAndDoors">
          <Select
            {...register('security.rejasOnWindowsAndDoors')}
            options={BUSINESS_YES_NO_OPTIONS}
            placeholder="Please select"
            error={!!err('security.rejasOnWindowsAndDoors')}
          />
        </FormField>
        <FormField label="Alarm fitted" required error={err('security.alarm')} fieldKey="security.alarm">
          <Select
            {...register('security.alarm')}
            options={BUSINESS_YES_NO_OPTIONS}
            placeholder="Please select"
            error={!!err('security.alarm')}
          />
        </FormField>
      </div>

      <FormField label="Fire response equipment" required error={err('security.fireResponseEquipment')} fieldKey="security.fireResponseEquipment">
        <Select
          {...register('security.fireResponseEquipment')}
          options={BUSINESS_FIRE_RESPONSE_OPTIONS}
          placeholder="Please select"
          error={!!err('security.fireResponseEquipment')}
        />
      </FormField>
      {isOther('security.fireResponseEquipment') && (
        <FormField label="Please describe the fire response equipment" required error={err('security.fireResponseEquipmentOther')} fieldKey="security.fireResponseEquipmentOther">
          <Input {...register('security.fireResponseEquipmentOther')} error={!!err('security.fireResponseEquipmentOther')} />
        </FormField>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Main door protection" required error={err('security.mainDoor')} fieldKey="security.mainDoor">
          <Select
            {...register('security.mainDoor')}
            options={BUSINESS_THEFT_PREVENTION_OPTIONS}
            placeholder="Please select"
            error={!!err('security.mainDoor')}
          />
        </FormField>
        {isOther('security.mainDoor') && (
          <FormField label="Please describe the main door protection" required error={err('security.mainDoorOther')} fieldKey="security.mainDoorOther">
            <Input {...register('security.mainDoorOther')} error={!!err('security.mainDoorOther')} />
          </FormField>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Second door protection" error={err('security.secondDoor')} fieldKey="security.secondDoor">
          <Select
            {...register('security.secondDoor')}
            options={BUSINESS_THEFT_PREVENTION_OPTIONS}
            placeholder="Please select"
            error={!!err('security.secondDoor')}
          />
        </FormField>
        {isOther('security.secondDoor') && (
          <FormField label="Please describe the second door protection" required error={err('security.secondDoorOther')} fieldKey="security.secondDoorOther">
            <Input {...register('security.secondDoorOther')} error={!!err('security.secondDoorOther')} />
          </FormField>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Window protection" required error={err('security.windows')} fieldKey="security.windows">
          <Select
            {...register('security.windows')}
            options={BUSINESS_THEFT_PREVENTION_OPTIONS}
            placeholder="Please select"
            error={!!err('security.windows')}
          />
        </FormField>
        {isOther('security.windows') && (
          <FormField label="Please describe the window protection" required error={err('security.windowsOther')} fieldKey="security.windowsOther">
            <Input {...register('security.windowsOther')} error={!!err('security.windowsOther')} />
          </FormField>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Shop window protection" error={err('security.shopWindow')} fieldKey="security.shopWindow">
          <Select
            {...register('security.shopWindow')}
            options={BUSINESS_THEFT_PREVENTION_OPTIONS}
            placeholder="Please select"
            error={!!err('security.shopWindow')}
          />
        </FormField>
        {isOther('security.shopWindow') && (
          <FormField label="Please describe the shop window protection" required error={err('security.shopWindowOther')} fieldKey="security.shopWindowOther">
            <Input {...register('security.shopWindowOther')} error={!!err('security.shopWindowOther')} />
          </FormField>
        )}
      </div>
    </SectionCard>
  );
}
