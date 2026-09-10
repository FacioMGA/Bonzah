import * as React from 'react';
import { cn } from '@/src/shared/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          'flex min-h-panel w-full rounded-control border bg-ui-surface px-3 py-2 text-sm text-ui-text',
          'placeholder:text-control-placeholder',
          'outline-none transition-shadow duration-200',
          'focus:border-ui-focus',
          'disabled:cursor-not-allowed disabled:text-control-disabledText disabled:opacity-100',
          error ? 'border-ui-danger' : 'border-ui-border',
          className,
        )}
        {...props}
      />
    );
  },
);

Textarea.displayName = 'Textarea';
