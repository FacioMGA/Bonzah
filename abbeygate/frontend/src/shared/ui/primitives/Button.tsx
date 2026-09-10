import React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/src/shared/lib/utils';

import { logger } from '@/src/shared/lib/logger';

type ActionId = string;

function actionNonce(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

const buttonVariants = cva(
  'inline-flex items-center justify-center font-bold tracking-tight transition-all duration-200 outline-none disabled:opacity-50 disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary:
          'bg-brand-primary text-white hover:bg-brand-primary-dark shadow-md hover:shadow-lg focus-visible:ring-2 focus-visible:ring-brand-primary/40 focus-visible:ring-offset-2 focus-visible:shadow-brand-glow',
        secondary:
          'bg-white text-slate-700 border border-slate-200/60 hover:bg-slate-50 hover:border-slate-300/80 shadow-sm focus-visible:ring-2 focus-visible:ring-slate-300/60 focus-visible:ring-offset-2',
        danger:
          'bg-red-50 text-red-700 border border-red-100 hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:ring-offset-2',
        ghost:
          'bg-transparent text-slate-500 hover:text-brand-primary hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-primary/30 focus-visible:ring-offset-2',
        link:
          'h-auto min-h-0 p-0 rounded-none bg-transparent text-current shadow-none hover:bg-transparent hover:shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
        outline:
          'border-2 border-brand-primary text-brand-primary hover:bg-brand-primary/10 focus-visible:ring-2 focus-visible:ring-brand-primary/30 focus-visible:ring-offset-2',
        tab:
          'bg-transparent border-transparent shadow-none hover:bg-transparent hover:shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
      },
      size: {
        none: 'p-0 rounded-none',
        sm: 'px-3 py-1.5 text-xs rounded-lg',
        md: 'px-5 py-2.5 text-sm rounded-xl',
        lg: 'px-6 py-3 text-base rounded-xl',
        tab: 'h-auto min-h-0 px-0 pt-4 pb-4 text-[11px] leading-none font-black tracking-[0.12em] rounded-none uppercase border-b-2 border-transparent',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> {
  actionId?: ActionId | string;
  isLoading?: boolean;
  asChild?: boolean;
  children: React.ReactNode;
  'data-testid'?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      actionId,
      variant,
      size,
      isLoading,
      asChild,
      className,
      onClick,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp: React.ElementType = asChild ? Slot : 'button';
    const loadingIcon = isLoading ? (
      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    ) : null;

    let testId = props['data-testid'];
    if (!testId && actionId) {
      testId = actionId.toLowerCase().replace(/\./g, '-');
    }

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (actionId) {
        const correlationId = `ui-${Date.now()}-${actionNonce()}`;

        window.__FACIO_ACTION_CONTEXT__ = {
          actionId,
          correlationId,
          timestamp: Date.now(),
        };

        setTimeout(() => {
          const current = window.__FACIO_ACTION_CONTEXT__;
          if (current && current.correlationId === correlationId) {
            delete window.__FACIO_ACTION_CONTEXT__;
          }
        }, 5000);

        logger.debug(`[Button] Action triggered: ${actionId} (Corr: ${correlationId})`);
      }

      if (onClick) onClick(e);
    };

    return (
      <Comp
        ref={ref}
        data-testid={testId}
        data-action-id={actionId}
        className={cn(buttonVariants({ variant, size }), className)}
        onClick={handleClick}
        disabled={disabled || isLoading}
        {...props}
      >
        {asChild ? (
          <span className="inline-flex items-center justify-center">
            {loadingIcon}
            {children}
          </span>
        ) : (
          <>
            {loadingIcon}
            {children}
          </>
        )}
      </Comp>
    );
  },
);

Button.displayName = 'Button';
