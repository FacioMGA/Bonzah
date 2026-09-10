import { RadioGroup } from '../primitives/RadioGroup';

/**
 * BooleanRadio — single-source Yes/No control for product wizards.
 *
 * ABY-90 / ABY-92 / ABY-93 — every Yes/No question used to render as
 * a `<Select>` dropdown, costing the customer a tap to OPEN the menu
 * + a tap to CHOOSE Yes/No (4 redundant clicks across a typical home
 * questionnaire). The two visible options fit comfortably in the
 * field width, so the canonical UX is two side-by-side tiles via
 * `RadioGroup`. We keep the boolean wire format unchanged: the
 * consumer-facing onChange emits `true | false | undefined` so
 * existing zod / RHF schemas (`property.permanentHome`,
 * `usage.businessUse`, `security.doorsFiveLeverLocks`, …) continue
 * to validate without modification.
 *
 * Why a tiny wrapper instead of inlining `RadioGroup` everywhere:
 *   - Boolean ↔ string serialization happens in ONE place, so a future
 *     change (e.g. adding a "Not sure" tile) lands in one file rather
 *     than the four wizard step files that previously duplicated
 *     `renderBooleanSelect`.
 *   - Keeps `RadioGroup` UI-agnostic; product-side semantics (boolean
 *     domain, undefined-on-clear) live in this file.
 */
export interface BooleanRadioProps {
  /** RHF field name; forwarded to RadioGroup so radio inputs share a name. */
  name: string;
  value: boolean | undefined;
  onChange: (next: boolean | undefined) => void;
  /** Render the field in the error state (red border, ARIA-flag handled by FormField). */
  error?: boolean;
  /** Optional override of the labels — defaults to "Yes" / "No". */
  yesLabel?: string;
  noLabel?: string;
}

export function BooleanRadio({
  name,
  value,
  onChange,
  error,
  yesLabel = 'Yes',
  noLabel = 'No',
}: BooleanRadioProps) {
  const stringValue = typeof value === 'boolean' ? (value ? 'yes' : 'no') : '';
  return (
    <RadioGroup
      name={name}
      value={stringValue}
      onChange={(next) => {
        if (next === 'yes') onChange(true);
        else if (next === 'no') onChange(false);
        else onChange(undefined);
      }}
      options={[
        { value: 'yes', label: yesLabel },
        { value: 'no', label: noLabel },
      ]}
      error={error}
    />
  );
}
