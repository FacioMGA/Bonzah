import * as React from 'react';
import { cn } from '@/src/shared/lib/utils';
import { DateInput } from './DateInput';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type?: React.HTMLInputTypeAttribute;
  error?: boolean;
  onValueChange?: (value: string, name: string) => void;
  /**
   * `default` uses semantic Tailwind tokens (new UI).
   * `ui` keeps the legacy look, but is fully token-driven (no `.ui-input` dependency).
   */
  variant?: 'default' | 'ui';
  'data-automation'?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      error,
      variant = 'default',
      onChange,
      onValueChange,
      onBlur,
      onFocus,
      inputMode,
      placeholder,
      pattern,
      value,
      defaultValue,
      disabled,
      min,
      max,
      'data-automation': dataAutomation,
      'aria-label': ariaLabel,
      ...props
    },
    ref,
  ) => {
    const isCheckable = type === 'checkbox' || type === 'radio';
    const isDateInput = type === 'date';
    const inferredDateLabel =
      isDateInput && !ariaLabel && typeof props.name === 'string'
        ? props.name.replace(/([A-Z])/g, ' $1').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim()
        : undefined;

    // ABY-68 — defer date entry to the canonical hybrid `DateInput`
    // primitive so this `Input` and the parallel `WizardInput` share
    // the same typing-first + calendar-icon implementation. Without
    // this delegation each `Input` flavour reimplemented date entry
    // and silently drifted (ABY-51 → ABY-68 regression). See
    // `shared/ui/primitives/DateInput.tsx`.
    if (isDateInput) {
      const fieldName = typeof props.name === 'string' ? props.name : '';
      return (
        <DateInput
          ref={ref}
          value={String(value ?? defaultValue ?? '')}
          onChange={(next) => {
            onValueChange?.(next, fieldName);
            // Reporting pages (and other BO forms) pass a DOM-style onChange.
            // DateInput emits a string, so we bridge it — otherwise picking a
            // date never updates React state (ABY-415 / ABY-427).
            if (onChange) {
              const syntheticEvent = {
                target: { value: next, name: fieldName },
                currentTarget: { value: next, name: fieldName },
              };
              onChange(syntheticEvent as React.ChangeEvent<HTMLInputElement>);
            }
          }}
          onBlur={onBlur}
          onFocus={onFocus}
          min={typeof min === 'string' ? min : undefined}
          max={typeof max === 'string' ? max : undefined}
          disabled={disabled}
          error={!!error}
          placeholder={placeholder}
          name={typeof props.name === 'string' ? props.name : undefined}
          id={typeof props.id === 'string' ? props.id : undefined}
          autoComplete={typeof props.autoComplete === 'string' ? props.autoComplete : undefined}
          aria-label={ariaLabel ?? inferredDateLabel}
          variant={variant === 'ui' ? 'ui' : 'default'}
          className={className}
        />
      );
    }

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(event);
    };

    const base = isCheckable
      ? cn(
          'h-4 w-4',
          type === 'radio' ? 'rounded-full' : 'rounded',
          'border border-ui-border bg-ui-surface text-ui-focus',
          'outline-none transition-shadow duration-200',
          'focus:border-ui-focus',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )
      : variant === 'ui'
        ? cn(
            'w-full rounded-xl px-5 py-4 font-semibold',
            'bg-control-bg border border-control-border text-control-text',
            'placeholder:text-control-placeholder',
            'outline-none transition-[border-color,box-shadow,transform,background-color] duration-200',
            'focus:bg-ui-surface focus:!border-ui-focus',
            'disabled:cursor-not-allowed disabled:bg-transparent disabled:text-control-disabledText disabled:opacity-100',
            'enabled:hover:border-ui-border enabled:hover:-translate-y-px enabled:hover:shadow-md',
            'enabled:focus:-translate-y-px enabled:focus:shadow-md',
          )
        : cn(
            'flex h-control w-full rounded-control border bg-ui-surface px-3 py-2 text-sm text-ui-text',
            'placeholder:text-control-placeholder',
            'outline-none transition-shadow duration-200',
            'focus:!border-ui-focus',
            'disabled:cursor-not-allowed disabled:text-control-disabledText disabled:opacity-100',
          );

    return (
      <input
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        pattern={pattern}
        data-automation={dataAutomation}
        aria-label={ariaLabel ?? inferredDateLabel}
        onChange={handleChange}
        onBlur={onBlur}
        onFocus={onFocus}
        disabled={disabled}
        value={value}
        defaultValue={defaultValue}
        min={min}
        max={max}
        className={cn(
          base,
          error
            ? 'border-ui-danger'
            : isCheckable
              ? ''
              : variant === 'ui'
                ? ''
                : 'border-ui-border',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);

Input.displayName = 'Input';
