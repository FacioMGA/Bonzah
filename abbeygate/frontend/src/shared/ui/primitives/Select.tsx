import * as React from 'react';
import { cn } from '@/src/shared/lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  /**
   * `default` uses semantic Tailwind tokens (new UI).
   * `ui` keeps the legacy look, but is fully token-driven.
   */
  variant?: 'default' | 'ui';
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, children, variant = 'default', ...props }, ref) => {
    const showChevron = !props.multiple && typeof props.size === 'undefined';
    const selectValue = props.value;
    const isPlaceholderSelection = !props.multiple
      && (selectValue === '' || (typeof selectValue === 'undefined' && props.defaultValue === ''));
    return (
      <div className="relative w-full">
        <select
          ref={ref}
          className={cn(
            variant === 'ui'
              ? cn(
                  'w-full rounded-xl px-5 py-4 font-semibold',
                  'bg-control-bg border border-control-border text-control-text',
                  'outline-none transition-[border-color,box-shadow,transform,background-color] duration-200',
                  showChevron ? 'appearance-none pr-11' : '',
                  isPlaceholderSelection ? 'text-control-placeholder' : '',
                  'enabled:hover:border-ui-border enabled:hover:-translate-y-px enabled:hover:shadow-md',
                  'enabled:focus:-translate-y-px enabled:focus:shadow-md',
                  'focus:bg-ui-surface focus:!border-ui-focus',
                  'disabled:cursor-not-allowed disabled:bg-transparent disabled:text-control-disabledText disabled:opacity-100',
                )
              : cn(
                  'flex h-control w-full rounded-control border bg-ui-surface px-3 py-2 text-sm text-ui-text',
                  'outline-none transition-shadow duration-200',
                  showChevron ? 'appearance-none pr-9' : '',
                  isPlaceholderSelection ? 'text-control-placeholder' : '',
                  'focus:!border-ui-focus',
                  'disabled:cursor-not-allowed disabled:text-control-disabledText disabled:opacity-100',
                ),
            error
              ? 'border-ui-danger'
              : variant === 'ui'
                ? ''
                : 'border-ui-border',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        {showChevron && (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-y-0 right-0 flex items-center text-slate-400',
              variant === 'ui' ? 'pr-4' : 'pr-3',
            )}
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none">
              <path d="M5.5 7.5L10 12l4.5-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
      </div>
    );
  },
);

Select.displayName = 'Select';
