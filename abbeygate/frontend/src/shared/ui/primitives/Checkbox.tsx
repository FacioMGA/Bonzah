import { forwardRef, InputHTMLAttributes, ReactNode } from 'react';

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  error?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, error, className = '', ...props },
  ref,
) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <input
        ref={ref}
        type="checkbox"
        {...props}
        className={`mt-1 h-4 w-4 rounded border-slate-300 cursor-pointer accent-brand-primary focus:ring-2 focus:ring-brand-primary/20 ${
          error ? 'border-red-500' : ''
        } ${className}`}
      />
      <span className="text-[15px] text-slate-700 leading-normal flex-1">{label}</span>
    </label>
  );
});
