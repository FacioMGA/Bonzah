import * as React from 'react';
import PhoneInput from 'react-phone-number-input';
import flags from 'react-phone-number-input/flags';
import 'react-phone-number-input/style.css';

import { clampE164Phone } from '@/src/shared/lib/phone';
import { cn } from '@/src/shared/lib/utils';

type BaseProps = React.ComponentProps<typeof PhoneInput>;

type PhoneInputProps = Omit<BaseProps, 'flags'> & {
  error?: boolean;
  changed?: boolean;
};

const phoneInputFlags: NonNullable<BaseProps['flags']> = flags;

export function PhoneInputField({
  className,
  disabled,
  error,
  changed,
  value,
  onChange,
  international = true,
  defaultCountry,
  ...props
}: PhoneInputProps) {
  const isDisabled = Boolean(disabled);

  return (
    <PhoneInput
      {...props}
      flags={phoneInputFlags}
      disabled={disabled}
      international={international}
      defaultCountry={defaultCountry}
      countryCallingCodeEditable={false}
      limitMaxLength
      value={value}
      onChange={(next) => onChange?.(next ? clampE164Phone(String(next)) : undefined)}
      className={cn(
        'ui-input w-full text-[15px] rounded-xl px-5 py-4 font-semibold',
        'border text-control-text border-control-border',
        'outline-none transition-[border-color,box-shadow,transform,background-color] duration-200',
        isDisabled
          ? 'cursor-not-allowed bg-transparent text-control-disabledText opacity-100'
          : 'bg-control-bg cursor-text hover:border-ui-border',
        !isDisabled && 'hover:-translate-y-px hover:shadow-md focus-within:-translate-y-px focus-within:shadow-md',
        !isDisabled && 'focus-within:bg-ui-surface focus-within:border-ui-focus',
        error && 'border-ui-danger ring-4 ring-red-500/10',
        !error && changed && 'border-amber-300',
        '[&_.PhoneInputInput]:flex-1 [&_.PhoneInputInput]:min-w-0 [&_.PhoneInputInput]:w-0 [&_.PhoneInputInput]:font-semibold [&_.PhoneInputInput]:text-slate-700',
        '[&_.PhoneInputCountry]:mr-2 [&_.PhoneInputCountry]:shrink-0',
        '[&_.PhoneInputCountrySelect]:ring-0',
        className,
      )}
    />
  );
}
