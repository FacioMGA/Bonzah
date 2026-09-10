import { forwardRef, TextareaHTMLAttributes, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  showValid?: boolean;
}

function hasNonEmptyValue(value: unknown): boolean {
  return String(value ?? '').trim().length > 0;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { error, showValid = false, className = '', ...props },
  ref,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);
  const isControlled = props.value !== undefined;
  const [liveValue, setLiveValue] = useState(() => String(props.value ?? props.defaultValue ?? ''));
  useEffect(() => {
    if (isControlled) {
      setLiveValue(String(props.value ?? ''));
      return;
    }
    if (props.defaultValue !== undefined) setLiveValue(String(props.defaultValue ?? ''));
  }, [isControlled, props.value, props.defaultValue]);
  useLayoutEffect(() => {
    if (isControlled) return;
    const domValue = innerRef.current?.value;
    if (typeof domValue === 'string' && domValue !== liveValue) setLiveValue(domValue);
  }, [isControlled, liveValue]);
  const currentValue = isControlled ? props.value : liveValue;
  const valid = Boolean(showValid && !error && !props.disabled && hasNonEmptyValue(currentValue));

  return (
    <span className="relative block w-full">
      {valid && (
        <span className="absolute right-4 top-4 pointer-events-none rounded-full bg-emerald-50 p-1">
          <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
      <textarea
        {...props}
        ref={innerRef}
        onChange={(event) => {
          if (!isControlled) setLiveValue(event.currentTarget.value);
          props.onChange?.(event);
        }}
        className={`ui-input text-[15px] resize-none ${valid ? 'pr-12' : ''} ${
          error ? 'border-red-500/70 !important ring-4 ring-red-500/10' : ''
        } ${className}`}
      />
    </span>
  );
});
