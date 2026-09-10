import { WizardSelect as Select } from '@/src/shared/ui';

export const HOME_PROPERTY_USE_OPTIONS = [
  { value: 'permanent', label: 'Permanent home' },
  { value: 'holiday', label: 'Holiday home' },
] as const;

export interface PropertyUseSelectProps {
  value: boolean | undefined;
  onChange: (next: boolean | undefined) => void;
  error?: boolean;
  name?: string;
}

/**
 * ABY-485 — property use is a single mutually-exclusive choice (permanent vs
 * holiday). A dropdown with explicit labels is clearer than separate Yes/No
 * tiles on a "Permanent Home?" question. Wire format stays boolean so
 * existing RHF + zod schemas (`property.permanentHome`, `usage.permanentHome`)
 * validate unchanged.
 */
export function PropertyUseSelect({ value, onChange, error, name }: PropertyUseSelectProps) {
  const selected =
    typeof value === 'boolean' ? (value ? 'permanent' : 'holiday') : '';

  return (
    <Select
      name={name}
      value={selected}
      onChange={(e) => {
        const next = String(e.target.value || '').trim();
        if (!next) onChange(undefined);
        else onChange(next === 'permanent');
      }}
      options={[...HOME_PROPERTY_USE_OPTIONS]}
      error={error}
      showValid
      placeholder="Select property use"
    />
  );
}
