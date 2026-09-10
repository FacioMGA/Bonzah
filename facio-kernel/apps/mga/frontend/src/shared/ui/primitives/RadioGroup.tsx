import type { ReactNode } from 'react';

interface RadioOption {
  value: string;
  label: string;
  tooltip?: string;
  /** Optional icon rendered above the label inside the tile. */
  icon?: ReactNode;
}

interface RadioGroupProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: RadioOption[];
  error?: boolean;
}

export function RadioGroup({ name, value, onChange, options, error }: RadioGroupProps) {
  const hasIcons = options.some((o) => o.icon !== undefined);
  // Show error state only when nothing is selected — once the user picks an
  // option the field is no longer in an error state.
  const showError = Boolean(error) && !value;
  return (
    <div className="grid grid-cols-2 gap-3 md:flex md:flex-nowrap">
      {options.map((option) => (
        <label
          key={option.value}
          className={`group relative min-w-0 md:flex-1 flex ${hasIcons ? 'flex-col items-center justify-center gap-1.5 py-4' : 'flex-row items-center justify-center gap-2 py-3'} cursor-pointer px-4 min-h-controlLg rounded-2xl border transition-all duration-300 ease-out hover:-translate-y-px ${value === option.value
              ? 'border-brand-primary bg-brand-primary/10'
              : showError
              ? 'border-red-300 bg-red-50/30 hover:border-red-400 hover:shadow-md'
              : 'border-slate-200/70 bg-white hover:border-slate-300 hover:shadow-md'
            }`}
        >
          {option.tooltip && (
            <span className="brand-radio-tooltip pointer-events-none hidden group-hover:block absolute left-1/2 top-0 -translate-x-1/2 -translate-y-[110%] bg-slate-900 text-white text-xs rounded-lg px-3 py-2 z-20 shadow-lg max-w-[min(320px,calc(100vw-2rem))] whitespace-normal text-center">
              {option.tooltip}
            </span>
          )}
          {option.icon && (
            <span className={`${value === option.value ? 'text-brand-primary' : 'text-slate-400'} transition-colors`}>
              {option.icon}
            </span>
          )}
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={(e) => onChange(e.target.value)}
            className="sr-only"
          />
          <span className="text-[15px] text-slate-900 font-semibold text-center leading-snug break-words min-w-0">
            {option.label}
          </span>
          {value === option.value && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-emerald-50 p-1">
              <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </span>
          )}
        </label>
      ))}
    </div>
  );
}
