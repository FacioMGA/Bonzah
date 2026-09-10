import { forwardRef, SelectHTMLAttributes, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  options: Array<{ value: string; label: string }>;
  showValid?: boolean;
  placeholder?: string;
}

function hasNonEmptyValue(v: unknown) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { error, options, showValid = false, className = '', defaultValue, ...props },
  ref,
) {
  const selectRef = useRef<HTMLSelectElement | null>(null);
  useImperativeHandle(ref, () => selectRef.current as HTMLSelectElement);
  const isControlled = typeof props.value !== 'undefined';
  const [uncontrolledValue, setUncontrolledValue] = useState<string>(() => String(defaultValue ?? ''));
  useEffect(() => {
    if (isControlled) return;
    if (defaultValue !== undefined) setUncontrolledValue(String(defaultValue ?? ''));
  }, [defaultValue, isControlled]);
  useLayoutEffect(() => {
    if (isControlled) return;
    const domValue = selectRef.current?.value;
    if (typeof domValue === 'string' && domValue !== uncontrolledValue) {
      setUncontrolledValue(domValue);
    }
  }, [isControlled, uncontrolledValue]);
  const selectedValue = isControlled
    ? String(props.value ?? '')
    : uncontrolledValue;

  const normalizedOptions = useMemo(
    () => options.filter((option) => String(option.value ?? '').trim() !== ''),
    [options],
  );
  const placeholderLabel = useMemo(() => {
    const provided = options.find((option) => String(option.value ?? '').trim() === '')?.label;
    return String(provided || props.placeholder || 'Please Select');
  }, [options, props.placeholder]);

  const valid = Boolean(showValid && !error && !props.disabled && hasNonEmptyValue(selectedValue));
  const placeholderSelected = !hasNonEmptyValue(selectedValue) || selectedValue === '';

  return (
    <div className="relative group transition-all duration-300 ease-out hover:-translate-y-px">
      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-200 flex items-center gap-2">
        {valid && (
          <div className="bg-emerald-50 rounded-full p-1">
            <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </div>
      <select
        {...props}
        ref={selectRef}
        value={selectedValue}
        onChange={(e) => {
          if (!isControlled) {
            setUncontrolledValue(String(e.target.value ?? ''));
          }
          props.onChange?.(e);
        }}
        className={`ui-select !h-controlLg !py-0 text-[15px] group-hover:border-gray-300 group-hover:shadow-lg ${placeholderSelected ? 'text-slate-300' : 'text-slate-700'} ${valid ? 'pr-16' : 'pr-12'} ${error ? 'border-red-500/70 !important ring-4 ring-red-500/10' : ''
          } ${className}`}
      >
        <option value="" disabled hidden={!placeholderSelected} className="text-slate-400">
          {placeholderLabel}
        </option>
        {normalizedOptions.map((option) => (
          <option key={option.value} value={option.value} className="text-slate-700">
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
});
