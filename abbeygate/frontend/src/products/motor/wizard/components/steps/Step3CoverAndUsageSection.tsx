import { ShieldCheck } from 'lucide-react';
import { FileUpload, FormField, RadioGroup, SectionCard, WizardInput as Input, WizardSelect as Select } from '@/src/shared/ui';
import { vehicleUseOptions } from '../../utils/vehicleUse';
import { kmsOptions, ncbOptions, parkingOptions } from './step3VehicleCover.config';
import type { QuoteData } from '../../types';

type Props = {
  data: QuoteData;
  errors: Record<string, string>;
  isMotorcycleOver200cc: boolean;
  isMotorcycle: boolean;
  onChange: <K extends keyof QuoteData & string>(field: K, value: QuoteData[K]) => void;
};

export function Step3CoverAndUsageSection({ data, errors, isMotorcycleOver200cc, isMotorcycle, onChange }: Props) {
  // ABY-323 — motorbikes are only offered on Social, Domestic & Pleasure
  // use; business / haulage classes are not available on the scheme.
  const usageOptions = isMotorcycle
    ? vehicleUseOptions.filter((opt) => opt.value === 'SD&P')
    : vehicleUseOptions;

  return (
    <SectionCard title="Cover & Usage" icon={<ShieldCheck className="w-6 h-6" />}>
      <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6">
        <FormField label="KMs per Year" required error={errors.kmsPerYear} fieldKey="kmsPerYear">
          <Select
            value={data.kmsPerYear}
            onChange={(e) => onChange('kmsPerYear', e.target.value)}
            error={!!errors.kmsPerYear}
            showValid={!errors.kmsPerYear && Boolean(data.kmsPerYear)}
            options={[{ value: '', label: 'Please Select' }, ...kmsOptions]}
          />
        </FormField>

        <FormField label="Parking (Drive, Garage or Road)" required error={errors.parking} fieldKey="parking">
          <Select
            value={data.parking}
            onChange={(e) => {
              const nextParking = e.target.value;
              onChange('parking', nextParking);
              if (nextParking !== 'Other') {
                onChange('parkingOther', '');
              }
            }}
            error={!!errors.parking}
            options={parkingOptions}
          />
        </FormField>
      </div>

      {data.parking === 'Other' && (
        <FormField label="Please specify parking location" required error={errors.parkingOther} fieldKey="parkingOther">
          <Input
            value={data.parkingOther}
            onChange={(e) => onChange('parkingOther', e.target.value)}
            error={!!errors.parkingOther}
            placeholder="Describe parking location"
          />
        </FormField>
      )}

      <FormField
        label="No Claims Bonus (NCB)"
        required
        error={errors.ncb}
        tooltip="No Claims Bonus is a discount earned for claim-free driving"
        fieldKey="ncb"
      >
        <Select
          value={data.ncb}
          onChange={(e) => onChange('ncb', e.target.value)}
          error={!!errors.ncb}
          showValid={!errors.ncb && Boolean(data.ncb)}
          options={ncbOptions}
        />
      </FormField>

      <FormField label="Vehicle Use" required error={errors.vehicleUse} fieldKey="vehicleUse">
        <RadioGroup
          name="vehicleUse"
          value={data.vehicleUse}
          onChange={(value) => onChange('vehicleUse', value)}
          options={usageOptions.map((opt) => ({ value: opt.value, label: opt.label, tooltip: opt.tooltip }))}
          error={!!errors.vehicleUse}
        />
      </FormField>

      {isMotorcycleOver200cc && (
        <FormField
          label="No Claims Discount evidence upload (optional)"
          tooltip="If omitted for motorcycles over 200cc, this quote is referred to underwriting."
          fieldKey="ncdProofUpload"
        >
          <FileUpload
            label="Upload document"
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            className="mt-1"
            fileName={String(data.ncdProofUpload || '')}
            onFileSelect={(f) => {
              if (f[0]) onChange('ncdProofUpload', f[0].name);
            }}
          />
        </FormField>
      )}
    </SectionCard>
  );
}
