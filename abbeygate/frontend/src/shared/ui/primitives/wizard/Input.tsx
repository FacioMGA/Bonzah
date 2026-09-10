import { ChangeEvent, forwardRef, InputHTMLAttributes, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { DateInput } from '@/src/shared/ui/primitives/DateInput';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type?: React.HTMLInputTypeAttribute;
  error?: boolean;
  icon?: React.ReactNode;
  showValid?: boolean;
  onValueChange?: (value: string, name: string) => void;
}

function hasNonEmptyValue(v: unknown) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

// ABY-68 — when consumers ask for `type="date"`, delegate to the
// canonical hybrid `DateInput` primitive (typing UX + calendar affordance).
// This branch lives in its own sub-component so the surrounding `Input`
// hooks (`useRef`, `useImperativeHandle`, `useState`, `useEffect`,
// `useLayoutEffect`) are always called in the same order for non-date
// inputs and never called at all for date inputs — keeping
// `react-hooks/rules-of-hooks` honest.
const WizardDateInput = forwardRef<HTMLInputElement, InputProps & { showValid: boolean }>(
  function WizardDateInput({ error, showValid, className = '', ...props }, ref) {
    const value = props.value ?? props.defaultValue ?? '';
    return (
      <DateInput
        ref={ref}
        value={String(value ?? '')}
        onChange={(next) => props.onValueChange?.(next, props.name || '')}
        onBlur={props.onBlur as never}
        onFocus={props.onFocus as never}
        min={props.min as string | undefined}
        max={props.max as string | undefined}
        disabled={props.disabled}
        error={!!error}
        placeholder={props.placeholder}
        name={props.name}
        id={props.id}
        autoComplete={props.autoComplete}
        aria-label={(props as { 'aria-label'?: string })['aria-label']}
        showValid={showValid}
        variant="wizard"
        className={className}
      />
    );
  },
);

// Standard non-date wizard input. All hooks live here and are always
// invoked unconditionally.
const WizardTextInput = forwardRef<HTMLInputElement, InputProps & { showValid: boolean }>(
  function WizardTextInput({ error, icon, showValid, onValueChange: _onValueChange, className = '', ...props }, ref) {
    const innerRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);
    const isControlled = props.value !== undefined;
    const [liveValue, setLiveValue] = useState<string>(() =>
      String(props.value ?? props.defaultValue ?? ''),
    );

    // Sync liveValue from `value` (controlled) and `defaultValue` (uncontrolled).
    // The defaultValue branch matters because RHF sometimes re-mounts inputs
    // with a fresh defaultValue after `form.reset(...)`; without this we'd
    // keep the stale "" from the initial render.
    useEffect(() => {
      if (isControlled) {
        setLiveValue(String(props.value ?? ''));
        return;
      }
      if (props.defaultValue !== undefined) {
        setLiveValue(String(props.defaultValue ?? ''));
      }
    }, [isControlled, props.value, props.defaultValue]);

    // Reconcile with whatever value the DOM input actually has after render.
    // RHF's `form.reset(qd)` writes via the registered ref directly to the
    // DOM input, bypassing React props — so for uncontrolled inputs the
    // React-side `liveValue` would otherwise stay at "" and the green-check
    // (and any consumer that reads our state) would silently disagree with
    // the DOM. useLayoutEffect so the sync happens before paint.
    useLayoutEffect(() => {
      if (isControlled) return;
      const domValue = innerRef.current?.value;
      if (typeof domValue === 'string' && domValue !== liveValue) {
        setLiveValue(domValue);
      }
    }, [isControlled, liveValue]);

    const currentValue = isControlled ? props.value : liveValue;
    const valid = Boolean(showValid && !error && !props.disabled && hasNonEmptyValue(currentValue));

    const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
      if (!isControlled) setLiveValue(e.target.value);
      props.onChange?.(e);
    };

    return (
      <div className="brand-input-wrap relative group transition-all duration-300 ease-out w-full min-w-0 overflow-hidden">
        {icon && (
          <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none flex items-center text-slate-400">
            {icon}
          </div>
        )}

        {valid && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-200">
            <div className="bg-emerald-50 rounded-full p-1">
              <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        )}

        <input
          {...props}
          ref={innerRef}
          onChange={handleInputChange}
          className={`ui-input !h-controlLg !py-0 text-[15px] min-w-0 max-w-full ${icon ? 'pl-12' : ''} ${valid ? 'pr-12' : ''} ${error ? 'border-red-500/70 !important ring-4 ring-red-500/10' : 'group-hover:border-gray-300 group-hover:shadow-lg'} ${className}`}
        />
      </div>
    );
  },
);

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { error, icon, showValid = false, className = '', ...props }: InputProps,
  ref,
) {
  if (props.type === 'date') {
    return (
      <WizardDateInput
        ref={ref}
        error={error}
        showValid={showValid}
        className={className}
        {...props}
      />
    );
  }

  return (
    <WizardTextInput
      ref={ref}
      error={error}
      icon={icon}
      showValid={showValid}
      className={className}
      {...props}
    />
  );
});
