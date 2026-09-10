import React from 'react';
import { Button } from '@/src/shared/ui';

export function IconButton({
  title,
  onClick,
  children,
  variant = 'neutral',
  className = '',
  disabled,
  type = 'button',
}: {
  title?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  children: React.ReactNode;
  variant?: 'neutral' | 'primary' | 'danger' | 'ghost';
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
}) {
  const variantClasses =
    variant === 'primary'
      ? 'bg-brand-primary text-white shadow-lg shadow-brand-primary/20 hover:bg-brand-secondary'
      : variant === 'danger'
        ? 'bg-white text-slate-400 border border-slate-200/60 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-100'
        : variant === 'ghost'
          ? 'bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'
          : 'bg-white text-slate-500 border border-slate-200/60 hover:bg-slate-50 hover:text-slate-700';

  return (
    <Button
      type={type as 'button' | 'submit'}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`w-11 h-11 inline-flex items-center justify-center rounded-2xl transition-all shadow-sm [&_svg]:shrink-0 [&_svg]:text-current [&_svg]:opacity-100 [&_svg]:pointer-events-none [&_svg_*]:stroke-current ${variantClasses} disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      aria-label={title}
    >
      {children}
    </Button>
  );
}
