import { MOTOR_VEHICLE_USE_OPTIONS } from '@facio/products';

const VEHICLE_USE_TOOLTIPS: Record<string, string> = {
  'SD&P': 'Social, domestic, and pleasure use.',
  'Class 1': 'Own business use without employees.',
  'Class 2': 'Own business use and use by employees.',
  'Class 3': 'Business use including haulage. Not including car rental or taxis.',
};

export const vehicleUseOptions = MOTOR_VEHICLE_USE_OPTIONS.map((option) => ({
  ...option,
  tooltip: VEHICLE_USE_TOOLTIPS[option.value] || '',
}));

export function formatVehicleUse(value: string): string {
  const v = String(value || '').trim();
  const match = vehicleUseOptions.find((o) => o.value === v);
  return match?.label ?? value;
}

