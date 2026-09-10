import { Calendar, CheckCircle } from 'lucide-react';
import { Checkbox, FormField, SectionCard, WizardSelect as Select } from '@/src/shared/ui';
import type { UseFormSetValue } from 'react-hook-form';
import { QuoteData } from '../../types';
import { bestTimeOptions } from './step3VehicleCover.config';

type ContactAndDeclarationsProps = {
  data: QuoteData;
  errors: Record<string, string>;
  setValue: UseFormSetValue<QuoteData>;
  onChange: <K extends keyof QuoteData & string>(field: K, value: QuoteData[K]) => void;
};

export function Step3ContactAndDeclarationsSection({
  data,
  errors,
  setValue,
  onChange,
}: ContactAndDeclarationsProps) {
  return (
    <>
      <SectionCard title="Contact Preferences" icon={<Calendar className="w-6 h-6" />}>
        <FormField
          label="When is the best time to telephone you regarding this quote?"
          required
          error={errors['proposer.bestTimeToCall']}
          fieldKey="proposer.bestTimeToCall"
        >
          <Select
            value={data.proposer?.bestTimeToCall || ''}
            onChange={(e) => setValue(
              'proposer.bestTimeToCall',
              e.target.value,
              { shouldDirty: true, shouldTouch: true, shouldValidate: true }
            )}
            error={!!errors['proposer.bestTimeToCall']}
            options={bestTimeOptions}
          />
        </FormField>
      </SectionCard>

      <SectionCard title="Declarations" icon={<CheckCircle className="w-6 h-6" />}>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-5">
          <p className="text-sm text-gray-700">
            Please read and confirm the following declarations before proceeding to your quote.
          </p>
        </div>

        <div className="space-y-4">
          {errors.infoTrueAndAccurate && (
            <p className="text-red-500 text-sm">{errors.infoTrueAndAccurate}</p>
          )}

          <div data-field="infoTrueAndAccurate" id="field-infoTrueAndAccurate">
            <Checkbox
              label="I confirm that the information I have provided is true and complete to the best of my knowledge. I understand that providing inaccurate information may result in a claim being rejected or my policy being cancelled."
              checked={data.infoTrueAndAccurate}
              onChange={(e) => onChange('infoTrueAndAccurate', e.target.checked)}
              error={!!errors.infoTrueAndAccurate}
            />
          </div>

          {errors.fairProcessingAccepted && (
            <p className="text-red-500 text-sm">{errors.fairProcessingAccepted}</p>
          )}

          <div data-field="fairProcessingAccepted" id="field-fairProcessingAccepted">
            <Checkbox
              label="I understand that this information will be used to obtain a quotation from insurers including Lloyd's underwriters, and that they may use it to carry out checks for underwriting, fraud prevention and sanctions screening."
              checked={data.fairProcessingAccepted}
              onChange={(e) => onChange('fairProcessingAccepted', e.target.checked)}
              error={!!errors.fairProcessingAccepted}
            />
          </div>
        </div>
      </SectionCard>
    </>
  );
}
