import { useState } from 'react';
import { AlertTriangle, Car } from 'lucide-react';
import { FormField, RadioGroup, SectionCard, WizardInput as Input, WizardSelect as Select, WizardTextarea as Textarea } from '@/src/shared/ui';
import {
  cabrioOptions,
  countryOfRegistrationOptions,
} from './step3VehicleCover.config';
import type { QuoteData } from '../../types';

type Props = {
  data: QuoteData;
  errors: Record<string, string>;
  fmtInt: Intl.NumberFormat;
  parseDigitsInt: (raw: string) => number;
  specAutofillHighlights: Partial<Record<string, boolean>>;
  effectiveFuelTypeOptions: { value: string; label: string }[];
  effectiveSeatsOptions: { value: string; label: string }[];
  filteredVehicleTypeOptions: { value: string; label: string }[];
  canUseTrimLookup: boolean;
  isElectric: boolean;
  isCaravan: boolean;
  isMotorcycle: boolean;
  isCabrioApplicable: boolean;
  onChange: <K extends keyof QuoteData & string>(field: K, value: QuoteData[K]) => void;
  onUserChange: <K extends keyof QuoteData & string>(field: K, value: QuoteData[K]) => void;
};

export function Step3VehicleSpecsSection({
  data, errors, fmtInt, parseDigitsInt,
  specAutofillHighlights, effectiveFuelTypeOptions, effectiveSeatsOptions: _effectiveSeatsOptions,
  filteredVehicleTypeOptions, canUseTrimLookup, isElectric, isCaravan, isMotorcycle, isCabrioApplicable,
  onChange, onUserChange,
}: Props) {
  const [engineSizeEditing, setEngineSizeEditing] = useState(false);
  const [engineSizeUi, setEngineSizeUi] = useState('');
  const [electricPowerKwEditing, setElectricPowerKwEditing] = useState(false);
  const [electricPowerKwUi, setElectricPowerKwUi] = useState('');
  const [vehicleValueEditing, setVehicleValueEditing] = useState(false);
  const [vehicleValueUi, setVehicleValueUi] = useState('');

  return (
    <SectionCard title="" icon={<Car className="w-6 h-6" />}>
      <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6">
        <div className={specAutofillHighlights.fuelType ? 'step3-autofill-flash' : ''}>
          <FormField label="Fuel Type" required error={errors.fuelType} fieldKey="fuelType">
            <Select value={data.fuelType} onChange={(e) => onUserChange('fuelType', e.target.value)} error={!!errors.fuelType} options={effectiveFuelTypeOptions} />
          </FormField>
        </div>
        {isCabrioApplicable && (
          <FormField label="Cabrio" required error={errors.cabrio} fieldKey="cabrio">
            <Select value={data.cabrio} onChange={(e) => onUserChange('cabrio', e.target.value)} error={!!errors.cabrio} options={cabrioOptions} />
          </FormField>
        )}
      </div>

      <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6">
        <div className={specAutofillHighlights.numberOfSeats ? 'step3-autofill-flash' : ''}>
          <FormField label="No. of Seats" required error={errors.numberOfSeats} fieldKey="numberOfSeats">
            {/* ABY-336 — motorbikes cap at 2 seats (rider + pillion). */}
            <Input type="number" min={isCaravan ? 0 : 1} max={isMotorcycle ? 2 : 15} inputMode="numeric"
              value={data.numberOfSeats ? String(data.numberOfSeats) : ''}
              onChange={(e) => {
                const parsed = parseInt(e.target.value, 10) || 0;
                const clamped = isMotorcycle ? Math.min(parsed, 2) : parsed;
                onUserChange('numberOfSeats', clamped);
              }}
              error={!!errors.numberOfSeats}
              showValid={!errors.numberOfSeats && Boolean(data.numberOfSeats)}
              placeholder={isMotorcycle ? 'e.g. 2' : 'e.g. 5'} />
          </FormField>
        </div>
        <div className={(isElectric ? specAutofillHighlights.electricPowerKw : specAutofillHighlights.engineSize) ? 'step3-autofill-flash' : ''}>
          {isElectric ? (
            <FormField label="Manufacturer Maximum Combined Power (kW)" required error={errors.electricPowerKw} tooltip="Enter the manufacturer's maximum combined power in kilowatts (kW). Battery capacity is not the rating input." fieldKey="electricPowerKw">
              <Input type="text" inputMode="numeric"
                value={electricPowerKwEditing ? electricPowerKwUi : (data.electricPowerKw != null ? String(data.electricPowerKw) : '')}
                onFocus={() => { setElectricPowerKwEditing(true); setElectricPowerKwUi(data.electricPowerKw != null ? String(data.electricPowerKw) : ''); }}
                onBlur={() => { setElectricPowerKwEditing(false); setElectricPowerKwUi(data.electricPowerKw != null ? String(data.electricPowerKw) : ''); }}
                onChange={(e) => { const v = String(e.target.value || '').replace(/[^\d]/g, '').slice(0, 4); setElectricPowerKwUi(v); const n = parseInt(v, 10); onUserChange('electricPowerKw', Number.isFinite(n) ? n : null); }}
                error={!!errors.electricPowerKw} showValid={!errors.electricPowerKw && data.electricPowerKw != null && Number(data.electricPowerKw) > 0} placeholder="e.g. 160" />
            </FormField>
          ) : (
            <FormField label="Engine Size (cc)" required={!isCaravan} error={errors.engineSize} fieldKey="engineSize">
              <Input type="text" inputMode="numeric" min={isMotorcycle ? 50 : isCaravan ? 0 : 300} max={isMotorcycle ? 1500 : 6000}
                value={engineSizeEditing ? engineSizeUi : (data.engineSize ? fmtInt.format(Number(data.engineSize)) : '')}
                onFocus={() => { setEngineSizeEditing(true); setEngineSizeUi(data.engineSize ? String(data.engineSize) : ''); }}
                onBlur={() => { setEngineSizeEditing(false); setEngineSizeUi(data.engineSize ? fmtInt.format(Number(data.engineSize)) : ''); }}
                onChange={(e) => { const v = String(e.target.value || '').replace(/[^\d]/g, '').slice(0, 4); setEngineSizeUi(v); onUserChange('engineSize', parseDigitsInt(v)); }}
                error={!!errors.engineSize} showValid={!errors.engineSize && Boolean(data.engineSize)} placeholder={isMotorcycle ? 'e.g. 125' : isCaravan ? '0 if towed' : '1,650'} />
            </FormField>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6">
        <div className={specAutofillHighlights.countryOfRegistration ? 'step3-autofill-flash' : ''}>
          <FormField label="Country of Registration" required error={errors.countryOfRegistration} fieldKey="countryOfRegistration">
            <Select value={data.countryOfRegistration} onChange={(e) => onUserChange('countryOfRegistration', e.target.value)} error={!!errors.countryOfRegistration} options={countryOfRegistrationOptions} />
          </FormField>
        </div>
        {!canUseTrimLookup ? (
          <FormField label="Vehicle Type" required error={errors.vehicleType} fieldKey="vehicleType">
            <Select value={data.vehicleType} onChange={(e) => onUserChange('vehicleType', e.target.value)} error={!!errors.vehicleType} showValid={!errors.vehicleType && Boolean(data.vehicleType)} options={filteredVehicleTypeOptions} />
          </FormField>
        ) : null}
      </div>

      {String(data.vehicleType || '').toLowerCase().includes('classic') && (
        <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6">
          <FormField label="Classic: Genuine classic vehicle?" required error={errors.classicIsGenuine} fieldKey="classicIsGenuine">
            <RadioGroup name="classicIsGenuine" value={data.classicIsGenuine === true ? 'yes' : data.classicIsGenuine === false ? 'no' : ''} onChange={(v) => onChange('classicIsGenuine', v === 'yes')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} error={!!errors.classicIsGenuine} />
          </FormField>
          <FormField label="Classic: Secondary vehicle in household?" required error={errors.classicIsSecondaryVehicle} fieldKey="classicIsSecondaryVehicle">
            <RadioGroup name="classicIsSecondaryVehicle" value={data.classicIsSecondaryVehicle === true ? 'yes' : data.classicIsSecondaryVehicle === false ? 'no' : ''} onChange={(v) => onChange('classicIsSecondaryVehicle', v === 'yes')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} error={!!errors.classicIsSecondaryVehicle} />
          </FormField>
        </div>
      )}

      <FormField label="Modified?" required error={errors.modified} fieldKey="modified">
        <RadioGroup name="modified" value={data.modified === true ? 'yes' : (data.modified === false ? 'no' : '')} onChange={(v) => onChange('modified', v === 'yes')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} error={!!errors.modified} />
      </FormField>

      {data.modified && (
        <>
          <FormField label="Please describe modifications" required error={errors.modificationsDetails} fieldKey="modificationsDetails">
            <Textarea value={data.modificationsDetails} onChange={(e) => onChange('modificationsDetails', e.target.value)} error={!!errors.modificationsDetails} placeholder="Please provide details of modifications..." rows={3} />
          </FormField>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-gray-700">Modified vehicles may require referral – we&apos;ll review your details.</p>
          </div>
        </>
      )}

      <FormField label="Vehicle Value (Euros)" required error={errors.vehicleValue} fieldKey="vehicleValue">
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black pointer-events-none">€</span>
          <Input type="text" inputMode="numeric" min={1000} max={200000} className="pl-10"
            value={vehicleValueEditing ? vehicleValueUi : (data.vehicleValue ? fmtInt.format(Number(data.vehicleValue)) : '')}
            onFocus={() => { setVehicleValueEditing(true); setVehicleValueUi(data.vehicleValue ? String(data.vehicleValue) : ''); }}
            onBlur={() => { setVehicleValueEditing(false); setVehicleValueUi(data.vehicleValue ? fmtInt.format(Number(data.vehicleValue)) : ''); }}
            onChange={(e) => { const v = String(e.target.value || '').replace(/[^\d]/g, '').slice(0, 7); setVehicleValueUi(v); onUserChange('vehicleValue', parseDigitsInt(v)); }}
            error={!!errors.vehicleValue} placeholder="e.g. 32,984" />
        </div>
      </FormField>
    </SectionCard>
  );
}
