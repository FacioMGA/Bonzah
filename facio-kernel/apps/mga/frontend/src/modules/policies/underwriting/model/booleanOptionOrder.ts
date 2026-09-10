export type BooleanSelectOption = {
  value: 'true' | 'false';
  label: 'Yes' | 'No';
};

const NEGATIVE_RISK_BOOLEAN_KEYS = new Set([
  'hasClaims',
  'hasConvictions',
  'hasMajorConvictionLast5Years',
  'otherDriversClaims',
  'otherDriversConvictions',
  'modified',
]);

const YES_NO_OPTIONS: BooleanSelectOption[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

const NO_YES_OPTIONS: BooleanSelectOption[] = [
  { value: 'false', label: 'No' },
  { value: 'true', label: 'Yes' },
];

export function getBooleanSelectOptions(fieldKey: string): BooleanSelectOption[] {
  return NEGATIVE_RISK_BOOLEAN_KEYS.has(String(fieldKey || '').trim()) ? NO_YES_OPTIONS : YES_NO_OPTIONS;
}
