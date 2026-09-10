import {
  CABRIO_OPTIONS,
  ENRICHMENT_TARGET_FIELDS as CANONICAL_ENRICHMENT_TARGET_FIELDS,
  MOTOR_BEST_TIME_TO_CALL_OPTIONS,
  MOTOR_COUNTRY_OF_REGISTRATION_OPTIONS,
  MOTOR_FUEL_TYPE_OPTIONS,
  MOTOR_KMS_PER_YEAR_OPTIONS,
  MOTOR_NCB_OPTIONS,
  MOTOR_PARKING_OPTIONS,
  MOTOR_VEHICLE_TYPE_OPTIONS,
} from '@facio/products';

export const coverOptions = [
  { value: 'Comprehensive', label: 'Comprehensive' },
  { value: 'Third Party Liability', label: 'Third Party Liability' },
];

export const vehicleKeptInOptions = [
  { value: 'Cyprus', label: 'Cyprus' },
  { value: 'Spain', label: 'Spain' },
  { value: 'Portugal', label: 'Portugal' },
  { value: 'Greece', label: 'Greece' },
];

export const countryOfRegistrationOptions = MOTOR_COUNTRY_OF_REGISTRATION_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

export const vehicleTypeOptions = [
  { value: '', label: 'Please Select' },
  ...MOTOR_VEHICLE_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
];

export const cabrioOptions = [
  { value: '', label: 'Please Select' },
  ...CABRIO_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
];

export const fuelTypeOptions = [
  { value: '', label: 'Please Select' },
  ...MOTOR_FUEL_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
];

export const parkingOptions = MOTOR_PARKING_OPTIONS;

export const ncbOptions = [
  { value: '', label: 'Please Select' },
  ...MOTOR_NCB_OPTIONS,
];

export const bestTimeOptions = MOTOR_BEST_TIME_TO_CALL_OPTIONS;

export const kmsOptions = MOTOR_KMS_PER_YEAR_OPTIONS;

export const seatsOptions = [
  { value: '', label: 'Please Select' },
  ...Array.from({ length: 9 }, (_, i) => {
    const v = String(i + 1);
    return { value: v, label: v };
  }),
];

export const ENRICHMENT_TARGET_FIELDS = CANONICAL_ENRICHMENT_TARGET_FIELDS;

export const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{11,17}$/;
export const VARIANT_LOADING_HINT_DELAY_MS = 2000;

